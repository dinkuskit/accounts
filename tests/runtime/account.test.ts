/** Runtime proof of the saved address and phone, through EmDash 1.5's production sandbox runner. */
import { expect, test } from "vitest";
import { call, host, nowSeconds, refused, SAME_ORIGIN, SESSION_HEADER, sha256Hex, signIn, SITE } from "./support.js";

const delivery = { name: "Pat Shopper", line1: "1 Main St", city: "Springfield", region: "IL", postalCode: "62701", country: "US" };
const read = (token: string) => call("account", { method: "GET", headers: { [SESSION_HEADER]: token } });
const save = (token: string, fields: Record<string, unknown>, headers: Record<string, string> = SAME_ORIGIN) =>
  call("account", { headers: { ...headers, [SESSION_HEADER]: token, "content-type": "application/json" }, rawBody: JSON.stringify(fields) });

test("a signed-in shopper saves one delivery address and phone, reads them back, and clears them", async () => {
  const pat = await signIn("pat@example.test");
  const empty = await read(pat);
  expect(empty).toMatchObject({ ok: true, email: "pat@example.test", phone: null, delivery: null });
  const formToken = empty.formToken as string;
  expect(formToken).toMatch(/^[0-9a-f]{64}$/);

  const saved = await save(pat, { formToken, phone: " 555-0100 ", delivery: { ...delivery, country: "us" } });
  expect(saved).toMatchObject({ ok: true, phone: "555-0100", delivery: { ...delivery, country: "US" } });
  expect(await read(pat)).toMatchObject({ ok: true, phone: "555-0100", delivery: { ...delivery, country: "US" }, formToken });
  expect(await host.inspect.storage.get("shoppers", "pat@example.test")).toMatchObject({ phone: "555-0100", delivery: { ...delivery, country: "US" } });

  expect(await save(pat, { formToken, phone: null })).toMatchObject({ ok: true, phone: null, delivery: { country: "US" } });
  expect(await save(pat, { formToken, delivery: null })).toMatchObject({ ok: true, phone: null, delivery: null });
});

test("another shopper, a stale tab, another site and bad fields cannot change the saved address", async () => {
  const pat = await signIn("pat@example.test");
  const sam = await signIn("sam@example.test");
  const patForm = (await read(pat)).formToken as string;
  await save(pat, { formToken: patForm, delivery });
  const before = await host.inspect.storage.get("shoppers", "pat@example.test");

  // Sam's session with Pat's form token, and no session at all.
  refused(await save(sam, { formToken: patForm, phone: "555-0199" }), "STALE_FORM");
  refused(await call("account", { method: "GET", headers: {} }), "SESSION_DENIED");
  expect(await read(sam)).toMatchObject({ ok: true, email: "sam@example.test", delivery: null });

  // A tab drawn before Pat signed in again in another tab. (A second emailed code would wait 30 seconds,
  // so the newer session is written straight into storage, as verify would write it.)
  await host.fixtures.plugin.storage("sessions", "tab2", {
    sessionId: "tab2", emailKey: "pat@example.test", verifier: await sha256Hex("tab2:pat@example.test:tab2-secret"),
    site: SITE, createdAt: nowSeconds(), expiresAt: nowSeconds() + 86400,
  });
  const again = "tab2.tab2-secret";
  expect(await read(again)).toMatchObject({ ok: true, email: "pat@example.test" });
  refused(await save(again, { formToken: patForm, phone: "555-0199" }), "STALE_FORM");

  // A write from another site's page.
  refused(await save(pat, { formToken: patForm, phone: "555-0199" }, { origin: "https://evil.example.test", "sec-fetch-site": "cross-site" }), "ORIGIN_DENIED");

  // Bad fields.
  refused(await save(pat, { formToken: patForm, delivery: { ...delivery, country: "USA" } }), "ADDRESS_INVALID");
  refused(await save(pat, { formToken: patForm, delivery: { ...delivery, line1: "" } }), "ADDRESS_REQUIRED");
  refused(await save(pat, { formToken: patForm, phone: "x".repeat(65) }), "PHONE_INVALID");
  refused(await save(pat, { formToken: patForm, email: "new@example.test" }), "INVALID_INPUT");
  refused(await call("account", { headers: { ...SAME_ORIGIN, [SESSION_HEADER]: pat }, rawBody: "{" }), "INVALID_INPUT");

  expect(await host.inspect.storage.get("shoppers", "pat@example.test")).toEqual(before);
});

test("after sign-out or expiry, the old session can neither read nor change the saved address and phone", async () => {
  const pat = await signIn("pat@example.test");
  const formToken = (await read(pat)).formToken as string;
  await save(pat, { formToken, phone: "555-0100", delivery });
  const before = await host.inspect.storage.get("shoppers", "pat@example.test");

  expect(await call("sign-out", { headers: { ...SAME_ORIGIN, [SESSION_HEADER]: pat }, body: {} })).toEqual({ ok: true, signedOut: true });
  for (let round = 0; round < 2; round += 1) {
    const stale = await read(pat);
    refused(stale, "SESSION_DENIED");
    // No saved personal data in the refusal.
    expect(JSON.stringify(stale)).not.toMatch(/555-0100|Main St|pat@example\.test/);
    refused(await save(pat, { formToken, phone: "555-0199", delivery: null }), "SESSION_DENIED");
    refused(await save(pat, { formToken, phone: null }), "SESSION_DENIED");
    // Signed out stays signed out after EmDash restarts.
    if (round === 0) await host.restart();
  }

  // A session past its 30 days is refused the same way.
  await host.fixtures.plugin.storage("sessions", "old", {
    sessionId: "old", emailKey: "pat@example.test", verifier: await sha256Hex("old:pat@example.test:old-secret"),
    site: SITE, createdAt: nowSeconds() - 31 * 86400, expiresAt: nowSeconds() - 60,
  });
  refused(await read("old.old-secret"), "SESSION_DENIED");
  refused(await save("old.old-secret", { formToken, phone: "555-0199" }), "SESSION_DENIED");

  expect(await host.inspect.storage.get("shoppers", "pat@example.test")).toEqual(before);
});
