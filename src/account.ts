import { isRecord, sha256Hex, timingSafeEqual } from "./shared.js";
import {
  answer, clock, findSession, iso, refuse,
  type DeliveryAddress, type SessionRecord, type ShopperRecord, type SignInHost, type SignInStore,
} from "./sign-in.js";

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const ADDRESS_FIELDS = ["name", "line1", "line2", "city", "region", "postalCode", "country"] as const;
const OPTIONAL_ADDRESS_FIELDS = new Set<string>(["line2", "region"]);
const ADDRESS_FIELD_MAX_LENGTH = 200;
const PHONE_MAX_LENGTH = 64;

/**
 * A delivery address checked as DinkusKit Commerce checkout checks one: the seven fields, line2
 * and region optional, each at most 200 characters, a two-letter country. Null clears it.
 */
export function normalizeAddress(value: unknown): DeliveryAddress | null {
  if (value === null) return null;
  if (!isRecord(value) || !Object.keys(value).every(key => (ADDRESS_FIELDS as readonly string[]).includes(key))) refuse("ADDRESS_INVALID");
  const address: Record<string, string> = {};
  for (const field of ADDRESS_FIELDS) {
    const raw = value[field];
    if (raw === undefined && OPTIONAL_ADDRESS_FIELDS.has(field)) continue;
    if (typeof raw !== "string" || CONTROL_CHARACTER.test(raw) || raw.length > ADDRESS_FIELD_MAX_LENGTH) refuse(raw === undefined ? "ADDRESS_REQUIRED" : "ADDRESS_INVALID");
    const text = raw.trim();
    if (text) address[field] = text;
    else if (!OPTIONAL_ADDRESS_FIELDS.has(field)) refuse("ADDRESS_REQUIRED");
  }
  address.country = address.country!.toUpperCase();
  if (!/^[A-Z]{2}$/.test(address.country)) refuse("ADDRESS_INVALID");
  return address as unknown as DeliveryAddress;
}

/** A phone number as Commerce checkout takes one: up to 64 characters; blank or null clears it. */
export function normalizePhone(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || CONTROL_CHARACTER.test(value) || value.trim().length > PHONE_MAX_LENGTH) refuse("PHONE_INVALID");
  return value.trim() || null;
}

/**
 * The account form's token. It is tied to this sign-in, as WooCommerce ties its form nonce to the
 * user and their session, so a page drawn for one shopper cannot save after another signs in.
 */
const formToken = (session: SessionRecord) => sha256Hex(`account-form:${session.verifier}`);

function view(shopper: ShopperRecord, session: SessionRecord, token: string) {
  return {
    ok: true as const,
    email: shopper.email,
    phone: shopper.phone ?? null,
    delivery: shopper.delivery ? structuredClone(shopper.delivery) : null,
    formToken: token,
    expiresAt: iso(session.expiresAt),
  };
}

async function signedIn(store: SignInStore, host: SignInHost, token: string | undefined) {
  const session = await findSession(store, host, token);
  const shopper = await store.shoppers.getVersioned(session.emailKey);
  if (!shopper) refuse("SESSION_DENIED");
  return { session, shopper };
}

/**
 * The signed-in shopper's email, phone and delivery address, and the token the account form
 * sends back. The store's account page and its checkout page both draw from this.
 */
export function readAccount(store: SignInStore, host: SignInHost, token: string | undefined) {
  return answer(async () => {
    const { session, shopper } = await signedIn(store, host, token);
    return view(shopper.value, session, await formToken(session));
  });
}

/**
 * Saves the phone and delivery address from the account form. Each key is optional, and null
 * clears it. A form drawn before a sign-in change in another tab is refused (STALE_FORM).
 */
export function saveAccount(store: SignInStore, host: SignInHost, token: string | undefined, input: unknown) {
  return answer(async () => {
    const { session, shopper } = await signedIn(store, host, token);
    if (!isRecord(input) || typeof input.formToken !== "string" || Object.keys(input).some(key => !["formToken", "phone", "delivery"].includes(key))) refuse("INVALID_INPUT");
    const expected = await formToken(session);
    if (!timingSafeEqual(input.formToken, expected)) refuse("STALE_FORM");
    if (!Object.hasOwn(input, "phone") && !Object.hasOwn(input, "delivery")) refuse("INVALID_INPUT");
    const next: ShopperRecord = { ...shopper.value, updatedAt: iso(clock(host)) };
    if (Object.hasOwn(input, "phone")) {
      const phone = normalizePhone(input.phone);
      if (phone) next.phone = phone; else delete next.phone;
    }
    if (Object.hasOwn(input, "delivery")) {
      const delivery = normalizeAddress(input.delivery);
      if (delivery) next.delivery = delivery; else delete next.delivery;
    }
    if (!(await store.shoppers.compareAndSet(session.emailKey, shopper.revision, next)).applied) refuse("CONTENTION");
    return view(next, session, expected);
  });
}
