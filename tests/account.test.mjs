import test from "node:test";
import assert from "node:assert/strict";
import plugin from "../dist/plugin.mjs";
import { call, sameSite, SESSION_HEADER, signIn, store } from "./support.mjs";

const HOME = { name: "Pat Lee", line1: "1 Main St", line2: "Apt 2", city: "Bryson City", region: "NC", postalCode: "28713", country: "us" };
const read = (ctx, session) => call(ctx, "account", { method: "GET", headers: { [SESSION_HEADER]: session } });
const save = (ctx, session, body, headers = sameSite) =>
  call(ctx, "account", { method: "POST", input: JSON.stringify(body), headers: { ...headers, [SESSION_HEADER]: session } });

test("the account route reads and saves, and is never cached", () => {
  const route = plugin.routes.account;
  assert.equal(route.public, true);
  assert.deepEqual(route.methods, ["GET", "POST"]);
  assert.equal(route.request.body, "text");
  assert.equal(route.cacheControl, "no-store");
});

test("a new shopper has no phone or address yet", async () => {
  const { ctx, sent } = store();
  const { session } = await signIn(ctx, sent);
  const account = await read(ctx, session);
  assert.equal(account.ok, true);
  assert.equal(account.email, "Pat@Example.test");
  assert.equal(account.phone, null);
  assert.equal(account.delivery, null);
  assert.match(account.formToken, /^[0-9a-f]{64}$/);
});

test("the shopper saves one delivery address and one phone, and checkout can read them back", async () => {
  const { ctx, sent } = store();
  const { session } = await signIn(ctx, sent);
  const { formToken } = await read(ctx, session);
  const saved = await save(ctx, session, { formToken, phone: " 828-555-0100 ", delivery: { ...HOME, city: " Bryson City " } });
  assert.equal(saved.ok, true);
  assert.equal(saved.phone, "828-555-0100");
  assert.deepEqual(saved.delivery, { ...HOME, country: "US" });
  const again = await read(ctx, session);
  assert.deepEqual({ phone: again.phone, delivery: again.delivery }, { phone: "828-555-0100", delivery: { ...HOME, country: "US" } });

  // Saving only the phone keeps the address; null or blank clears either one.
  assert.deepEqual((await save(ctx, session, { formToken, phone: "" })).delivery, { ...HOME, country: "US" });
  const cleared = await save(ctx, session, { formToken, delivery: null });
  assert.deepEqual({ phone: cleared.phone, delivery: cleared.delivery }, { phone: null, delivery: null });
  const row = ctx.storage.shoppers.rows.get("pat@example.test").value;
  assert.equal("phone" in row || "delivery" in row, false);
});

test("line 2 and region are optional; the rest are required", async () => {
  const { ctx, sent } = store();
  const { session } = await signIn(ctx, sent);
  const { formToken } = await read(ctx, session);
  const { line2, region, ...plain } = HOME;
  assert.deepEqual((await save(ctx, session, { formToken, delivery: { ...plain, line2: " " } })).delivery, { ...plain, country: "US" });
  for (const field of ["name", "line1", "city", "postalCode", "country"]) {
    const missing = { ...HOME };
    delete missing[field];
    assert.equal((await save(ctx, session, { formToken, delivery: missing })).error.code, "ADDRESS_REQUIRED", field);
    assert.equal((await save(ctx, session, { formToken, delivery: { ...HOME, [field]: "  " } })).error.code, "ADDRESS_REQUIRED", field);
  }
  for (const bad of [{ ...HOME, country: "USA" }, { ...HOME, city: "x".repeat(201) }, { ...HOME, line1: "1 Main\nSt" }, { ...HOME, extra: "x" }, "1 Main St"]) {
    assert.equal((await save(ctx, session, { formToken, delivery: bad })).error.code, "ADDRESS_INVALID", JSON.stringify(bad));
  }
  assert.equal((await save(ctx, session, { formToken, phone: "1".repeat(65) })).error.code, "PHONE_INVALID");
  assert.equal((await save(ctx, session, { formToken, phone: 5 })).error.code, "PHONE_INVALID");
  assert.equal((await read(ctx, session)).delivery.line1, "1 Main St", "a refused save changes nothing");
});

test("a page drawn before signing in as someone else in another tab cannot save", async () => {
  const { ctx, sent } = store();
  const pat = await signIn(ctx, sent);
  const patForm = (await read(ctx, pat.session)).formToken;
  // Another tab signs out and signs in as Sam, so the cookie now holds Sam's session.
  await call(ctx, "sign-out", { input: {}, headers: { ...sameSite, [SESSION_HEADER]: pat.session } });
  ctx.storage.sign_in_codes.rows.clear();
  const sam = await signIn(ctx, sent, "sam@example.test");
  const stale = await save(ctx, sam.session, { formToken: patForm, delivery: HOME });
  assert.equal(stale.error.code, "STALE_FORM");
  assert.match(stale.error.message, /Reload it/);
  assert.equal(ctx.storage.shoppers.rows.get("sam@example.test").value.delivery, undefined);
  // A fresh page works.
  const fresh = (await read(ctx, sam.session)).formToken;
  assert.notEqual(fresh, patForm);
  assert.equal((await save(ctx, sam.session, { formToken: fresh, delivery: HOME })).ok, true);
});

test("saving needs a signed-in shopper, the form token, and a same-origin request", async () => {
  const { ctx, sent } = store();
  const { session } = await signIn(ctx, sent);
  const { formToken } = await read(ctx, session);
  assert.equal((await read(ctx, "nope.nope")).error.code, "SESSION_DENIED");
  assert.equal((await save(ctx, "nope.nope", { formToken, delivery: HOME })).error.code, "SESSION_DENIED");
  assert.equal((await save(ctx, session, { delivery: HOME })).error.code, "INVALID_INPUT");
  assert.equal((await save(ctx, session, { formToken })).error.code, "INVALID_INPUT");
  assert.equal((await save(ctx, session, { formToken, email: "x@example.test" })).error.code, "INVALID_INPUT", "the email cannot be changed here");
  assert.equal((await save(ctx, session, { formToken, delivery: HOME }, { origin: "https://evil.example.test" })).error.code, "ORIGIN_DENIED");
  assert.equal((await save(ctx, session, { formToken, delivery: HOME }, {})).error.code, "ORIGIN_DENIED");
  const garbled = await call(ctx, "account", { method: "POST", input: "{not json", headers: { ...sameSite, [SESSION_HEADER]: session } });
  assert.equal(garbled.error.code, "INVALID_INPUT");
  assert.equal((await read(ctx, session)).delivery, null);
});
