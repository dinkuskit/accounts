/** A non-null, non-array object, as JSON object input or a stored record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** The object's own keys, sorted and comma-joined, for exact-shape checks. */
export function sortedKeys(value: object): string {
  return Object.keys(value).sort().join();
}

/** Compares two strings without stopping at the first difference. */
export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

const hex = (bytes: Uint8Array) => [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");

/** SHA-256 of the UTF-8 text, as lowercase hex. */
export async function sha256Hex(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

/** 32 random bytes as lowercase hex. */
export function randomSecret(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

/** A six-digit code with no modulo bias. */
export function randomSixDigitCode(): string {
  const value = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(value);
    if (value[0]! < 4_294_000_000) return String(value[0]! % 1_000_000).padStart(6, "0");
  }
}

/** One request header, case-insensitively, trimmed; undefined when absent or blank. */
export function headerValue(headers: Headers | Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const want = name.toLowerCase();
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(want)?.trim() || undefined;
  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    if (key.toLowerCase() === want && typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * The canonical http(s) origin of a URL, or null. Refuses credentials, other schemes, empty
 * hosts and unparseable text, as DinkusKit Commerce does.
 */
export function canonicalOrigin(value: string | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.includes("@")) return null;
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { return null; }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) return null;
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "." || /\s/.test(host) || parsed.origin === "null") return null;
  return parsed.origin;
}

/**
 * A same-origin write: the request is for this site and the browser (or the store's own server
 * page, which sends Origin) says it came from this site. Missing both Origin and
 * Sec-Fetch-Site: same-origin is refused.
 */
export function isSameOriginWrite(request: { url: string; headers?: Headers | Record<string, string> }, siteOrigin: string): boolean {
  if (canonicalOrigin(request.url) !== siteOrigin) return false;
  const origin = headerValue(request.headers, "origin");
  const fetchSite = headerValue(request.headers, "sec-fetch-site")?.toLowerCase();
  if (origin !== undefined) return canonicalOrigin(origin) === siteOrigin && (fetchSite === undefined || fetchSite === "same-origin");
  return fetchSite === "same-origin";
}

const EMAIL_SYNTAX = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/** An email address checked exactly as Commerce checkout checks one, or the reason it is refused. */
export function normalizeEmail(value: unknown): { email: string; emailKey: string } | "EMAIL_REQUIRED" | "EMAIL_INVALID" {
  if (typeof value !== "string") return "EMAIL_REQUIRED";
  if (CONTROL_CHARACTER.test(value)) return "EMAIL_INVALID";
  const email = value.trim();
  if (!email) return "EMAIL_REQUIRED";
  const at = email.lastIndexOf("@");
  if (email.length > 254 || !EMAIL_SYNTAX.test(email) || at <= 0 || at > 64) return "EMAIL_INVALID";
  return { email, emailKey: email.toLowerCase() };
}
