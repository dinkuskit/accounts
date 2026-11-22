import type { StorageCollection } from "emdash";
import { isRecord, normalizeEmail, randomSecret, randomSixDigitCode, sha256Hex, sortedKeys, timingSafeEqual } from "./shared.js";

/** The numbers DinkusKit Commerce uses today, carried over (accounts-v1-scope-20261121). */
export const CODE_LIFETIME_SECONDS = 600;
export const CODE_TRIES = 5;
export const CODE_COOLDOWN_SECONDS = 30;
export const SESSION_LIFETIME_SECONDS = 30 * 86400;

/** The store's server pages pass the shopper's session token in this header, read from their cookie. */
export const SESSION_HEADER = "x-dinkus-accounts-session";

export const SHOPPERS = "shoppers";
export const SIGN_IN_CODES = "sign_in_codes";
export const SESSIONS = "sessions";

export interface ShopperRecord {
  emailKey: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface SignInCodeRecord {
  emailKey: string;
  /** SHA-256 of "emailKey:code"; the code itself is never stored. */
  verifier: string;
  tries: number;
  issuedAt: number;
  expiresAt: number;
  used: boolean;
}

export interface SessionRecord {
  sessionId: string;
  emailKey: string;
  /** SHA-256 of "sessionId:emailKey:secret"; the secret is only in the shopper's cookie. */
  verifier: string;
  /** The store's origin when the session began; a session never works on another site. */
  site: string;
  createdAt: number;
  expiresAt: number;
}

type Collection<T> = Pick<StorageCollection<T>, "get" | "getVersioned" | "compareAndSet" | "delete">;

export interface SignInStore {
  shoppers: Collection<ShopperRecord>;
  codes: Collection<SignInCodeRecord>;
  sessions: Collection<SessionRecord>;
}

export interface SignInHost {
  /** The store's own origin, from EmDash's site settings. */
  site: string;
  storeName: string;
  send?: (message: { to: string; subject: string; text: string }) => Promise<void>;
  /** Test seams. */
  now?: () => number;
  newCode?: () => string;
  newSessionId?: () => string;
  newSecret?: () => string;
}

export type SignInErrorCode =
  | "CODE_EXHAUSTED" | "CODE_EXPIRED" | "CODE_INVALID" | "CONTENTION" | "EMAIL_INVALID" | "EMAIL_REQUIRED"
  | "EMAIL_UNAVAILABLE" | "INVALID_INPUT" | "ORIGIN_DENIED" | "RATE_LIMITED" | "SESSION_DENIED" | "UNAVAILABLE";

/** The message a shopper sees for each refusal. */
export const SIGN_IN_ERRORS: Record<SignInErrorCode, string> = {
  CODE_EXHAUSTED: "That code has had 5 tries. Ask for a new code.",
  CODE_EXPIRED: "That sign-in code has expired. Ask for a new one.",
  CODE_INVALID: "That sign-in code is not right. Check the latest email, or ask for a new code.",
  CONTENTION: "Something changed at the same moment. Please try again.",
  EMAIL_INVALID: "Enter a valid email address.",
  EMAIL_REQUIRED: "Enter your email address.",
  EMAIL_UNAVAILABLE: "This store cannot send sign-in emails right now. You can still check out as a guest.",
  INVALID_INPUT: "That request was not understood.",
  ORIGIN_DENIED: "That request did not come from this store.",
  RATE_LIMITED: "Please wait 30 seconds before asking for another code.",
  SESSION_DENIED: "You are not signed in.",
  UNAVAILABLE: "Shopper accounts are unavailable right now.",
};

export type Refusal = { ok: false; error: { code: SignInErrorCode; message: string } };
export const refusal = (code: SignInErrorCode): Refusal => ({ ok: false, error: { code, message: SIGN_IN_ERRORS[code] } });

class Refused extends Error {
  constructor(readonly code: SignInErrorCode) { super(code); }
}
function refuse(code: SignInErrorCode): never {
  throw new Refused(code);
}
async function answer<T>(work: () => Promise<T>): Promise<T | Refusal> {
  try {
    return await work();
  } catch (error) {
    return refusal(error instanceof Refused ? error.code : "UNAVAILABLE");
  }
}

const clock = (host: SignInHost) => host.now?.() ?? Math.floor(Date.now() / 1000);
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

function email(input: unknown, keys: string) {
  if (!isRecord(input) || sortedKeys(input) !== keys) refuse("INVALID_INPUT");
  const normalized = normalizeEmail(input.email);
  if (typeof normalized === "string") refuse(normalized);
  return normalized;
}

/**
 * Emails a 6-digit code. It answers the same whether or not the address has signed in before,
 * so the form never tells a stranger who shops here.
 */
export function startSignIn(store: SignInStore, host: SignInHost, input: unknown) {
  return answer(async () => {
    if (!host.send) refuse("EMAIL_UNAVAILABLE");
    const { email: address, emailKey } = email(input, "email");
    const now = clock(host);
    const existing = await store.codes.getVersioned(emailKey);
    if (existing && now - existing.value.issuedAt < CODE_COOLDOWN_SECONDS) refuse("RATE_LIMITED");
    const code = (host.newCode ?? randomSixDigitCode)();
    if (!/^[0-9]{6}$/.test(code)) refuse("UNAVAILABLE");
    const record: SignInCodeRecord = {
      emailKey, verifier: await sha256Hex(`${emailKey}:${code}`), tries: 0, issuedAt: now, expiresAt: now + CODE_LIFETIME_SECONDS, used: false,
    };
    const written = await store.codes.compareAndSet(emailKey, existing?.revision ?? null, record);
    if (!written.applied) refuse("CONTENTION");
    try {
      await host.send({
        to: address,
        subject: `Your ${host.storeName} sign-in code: ${code}`,
        text: `Your ${host.storeName} sign-in code is ${code}. It expires in 10 minutes. If you did not ask for it, you can ignore this email.`,
      });
    } catch {
      // A code that was never delivered must not hold the 30-second wait or be usable.
      await store.codes.compareAndSet(emailKey, written.revision, existing?.value ?? { ...record, issuedAt: 0, expiresAt: 0, used: true }).catch(() => {});
      refuse("EMAIL_UNAVAILABLE");
    }
    return { ok: true as const, email: address, expiresAt: iso(record.expiresAt) };
  });
}

/** Checks the code and starts a 30-day session. The session token goes into the shopper's cookie. */
export function verifySignIn(store: SignInStore, host: SignInHost, input: unknown) {
  return answer(async () => {
    const { email: address, emailKey } = email(input, "code,email");
    const code = (input as { code: unknown }).code;
    if (typeof code !== "string" || !/^[0-9]{6}$/.test(code.trim())) refuse("CODE_INVALID");
    const now = clock(host);
    const stored = await store.codes.getVersioned(emailKey);
    if (!stored || stored.value.used) refuse("CODE_INVALID");
    if (stored.value.tries >= CODE_TRIES) refuse("CODE_EXHAUSTED");
    const challenge = stored.value;
    if (now >= challenge.expiresAt) refuse("CODE_EXPIRED");
    const matches = timingSafeEqual(challenge.verifier, await sha256Hex(`${emailKey}:${code.trim()}`));
    // Every try counts, right or wrong, and a right one uses the code up.
    const counted = await store.codes.compareAndSet(emailKey, stored.revision, { ...challenge, tries: challenge.tries + 1, used: matches });
    if (!counted.applied) refuse("CONTENTION");
    if (!matches) refuse(challenge.tries + 1 >= CODE_TRIES ? "CODE_EXHAUSTED" : "CODE_INVALID");

    const shopper = await store.shoppers.getVersioned(emailKey);
    if (!shopper) {
      const created = await store.shoppers.compareAndSet(emailKey, null, { emailKey, email: address, createdAt: iso(now), updatedAt: iso(now) });
      if (!created.applied && !(await store.shoppers.get(emailKey))) refuse("CONTENTION");
    }
    const sessionId = (host.newSessionId ?? (() => crypto.randomUUID()))();
    const secret = (host.newSecret ?? randomSecret)();
    if (!sessionId.trim() || sessionId.includes(".") || !secret.trim()) refuse("UNAVAILABLE");
    const session: SessionRecord = {
      sessionId, emailKey, verifier: await sha256Hex(`${sessionId}:${emailKey}:${secret}`), site: host.site, createdAt: now, expiresAt: now + SESSION_LIFETIME_SECONDS,
    };
    if (!(await store.sessions.compareAndSet(sessionId, null, session)).applied) refuse("CONTENTION");
    return { ok: true as const, email: shopper?.value.email ?? address, session: `${sessionId}.${secret}`, expiresAt: iso(session.expiresAt) };
  });
}

/** The live session a token names, or a refusal; any doubt counts as signed out. */
export async function findSession(store: SignInStore, host: SignInHost, token: string | undefined): Promise<SessionRecord> {
  const dot = token?.indexOf(".") ?? -1;
  if (!token || dot <= 0 || dot === token.length - 1) refuse("SESSION_DENIED");
  const sessionId = token.slice(0, dot);
  const stored = await store.sessions.get(sessionId);
  if (!stored || stored.sessionId !== sessionId || stored.site !== host.site || !Number.isSafeInteger(stored.expiresAt) || clock(host) >= stored.expiresAt) {
    refuse("SESSION_DENIED");
  }
  if (!timingSafeEqual(stored.verifier, await sha256Hex(`${sessionId}:${stored.emailKey}:${token.slice(dot + 1)}`))) refuse("SESSION_DENIED");
  return stored;
}

/** Who is signed in, for the store's own server pages. */
export function readSession(store: SignInStore, host: SignInHost, token: string | undefined) {
  return answer(async () => {
    const session = await findSession(store, host, token);
    const shopper = await store.shoppers.get(session.emailKey);
    if (!shopper) refuse("SESSION_DENIED");
    return { ok: true as const, email: shopper.email, expiresAt: iso(session.expiresAt) };
  });
}

export function signOut(store: SignInStore, host: SignInHost, token: string | undefined) {
  return answer(async () => {
    const session = await findSession(store, host, token);
    await store.sessions.delete(session.sessionId);
    return { ok: true as const, signedOut: true as const };
  });
}
