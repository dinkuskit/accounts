/** Shared runtime-test host: each test gets a fresh EmDash store running the built plugin. */
import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { afterEach, beforeEach, expect } from "vitest";

export const SITE = "https://shop.example.test";
export const SESSION_HEADER = "x-dinkus-accounts-session";
export const SAME_ORIGIN = { origin: SITE, "sec-fetch-site": "same-origin" };

export type Answer = { ok: boolean; email?: string; session?: string; expiresAt?: string; error?: { code: string; message: string }; [key: string]: unknown };

export let host: PluginRuntimeTestHost;
beforeEach(async () => {
  host = await createPluginRuntimeTestHost({ site: { name: "Corner Shop", url: SITE } });
});
afterEach(async () => {
  await host.dispose();
});

export async function call(route: string, init: { method?: string; headers?: Record<string, string>; body?: unknown; rawBody?: string; url?: string } = {}): Promise<Answer> {
  const response = await host.actions.routes.request(route, {
    url: init.url ?? `${SITE}/_emdash/api/plugins/${host.manifest.id}/${route}`,
    method: init.method ?? "POST",
    headers: init.headers ?? SAME_ORIGIN,
    ...(init.body === undefined ? {} : { body: init.body }),
    ...(init.rawBody === undefined ? {} : { rawBody: init.rawBody }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const json = (await response.json()) as { success: boolean; data: Answer };
  expect(json.success).toBe(true);
  return json.data;
}
export const session = (token: string) => call("session", { method: "GET", headers: { [SESSION_HEADER]: token } });
export const refused = (answer: Answer, code: string) => {
  expect(answer).toEqual({ ok: false, error: { code, message: expect.any(String) } });
};

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export const nowSeconds = () => Math.floor(Date.now() / 1000);

export async function signIn(email: string): Promise<string> {
  const before = (await host.inspect.email()).length;
  expect(await call("sign-in/start", { body: { email } })).toMatchObject({ ok: true, email });
  const sent = (await host.inspect.email()).slice(before);
  expect(sent).toHaveLength(1);
  const code = /sign-in code: ([0-9]{6})$/.exec(String(sent[0]!.subject))?.[1];
  expect(code).toMatch(/^[0-9]{6}$/);
  const verified = await call("sign-in/verify", { body: { email, code } });
  expect(verified).toMatchObject({ ok: true });
  return verified.session!;
}

