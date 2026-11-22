/**
 * Runtime proof: the built plugin runs inside EmDash 1.5's production Cloudflare sandbox runner
 * (workerd, real D1, PluginBridge), called through EmDash's own plugin route dispatcher.
 */
import { expect, test } from "vitest";
import { call, host, nowSeconds, refused, SAME_ORIGIN, session, SESSION_HEADER, sha256Hex, signIn, SITE } from "./support.js";

test("a shopper signs in with the emailed code, is read back, and signs out", async () => {
  expect(await host.inspect.scheduledTasks()).toEqual([
    expect.objectContaining({ name: "accounts-cleanup", schedule: "0 */12 * * *", enabled: 1 }),
  ]);

  expect(await call("sign-in/start", { body: { email: "Pat@Example.test" } })).toMatchObject({ ok: true, email: "Pat@Example.test" });
  const [message] = await host.inspect.email();
  expect(message).toMatchObject({ to: "Pat@Example.test", source: host.manifest.id });
  const code = /sign-in code: ([0-9]{6})$/.exec(String(message!.subject))![1]!;
  expect(String(message!.text)).toContain(`Your Corner Shop sign-in code is ${code}. It expires in 10 minutes.`);

  // Storage keeps only a hash of the code.
  const [stored] = await host.inspect.storage.list<Record<string, unknown>>("sign_in_codes");
  expect(stored!.id).toBe("pat@example.test");
  expect(stored!.data.verifier).toBe(await sha256Hex(`pat@example.test:${code}`));
  expect(JSON.stringify(stored)).not.toContain(code);

  // The shopper is saved with the address as typed at the first sign-in.
  const verified = await call("sign-in/verify", { body: { email: "Pat@Example.test", code } });
  expect(verified).toMatchObject({ ok: true, email: "Pat@Example.test" });
  const token = verified.session!;
  const [sessionId, secret] = token.split(".") as [string, string];

  // Storage keeps only a hash of the session secret, tied to this store.
  const [savedSession] = await host.inspect.storage.list<Record<string, unknown>>("sessions");
  expect(savedSession!.data).toMatchObject({
    sessionId, emailKey: "pat@example.test", site: SITE, verifier: await sha256Hex(`${sessionId}:pat@example.test:${secret}`),
  });
  expect(JSON.stringify(await host.inspect.storage.list("sessions"))).not.toContain(secret);
  expect((await host.inspect.storage.get("sign_in_codes", "pat@example.test")) as Record<string, unknown>).toMatchObject({ used: true, tries: 1 });

  expect(await session(token)).toEqual({ ok: true, email: "Pat@Example.test", expiresAt: verified.expiresAt });

  // A used code cannot start a second session.
  refused(await call("sign-in/verify", { body: { email: "pat@example.test", code } }), "CODE_INVALID");

  // Signed out is signed out, even after EmDash restarts.
  expect(await call("sign-out", { headers: { ...SAME_ORIGIN, [SESSION_HEADER]: token }, body: {} })).toEqual({ ok: true, signedOut: true });
  await host.restart();
  refused(await session(token), "SESSION_DENIED");
  expect(await host.inspect.storage.list("sessions")).toEqual([]);
});

test("the nearest forbidden callers are refused before any shopper data is returned", async () => {
  const pat = await signIn("pat@example.test");
  const sam = await signIn("sam@example.test");
  const [patId, patSecret] = pat.split(".") as [string, string];
  const [samId] = sam.split(".") as [string, string];

  expect(await session(pat)).toMatchObject({ ok: true, email: "pat@example.test" });
  refused(await session(`${patId}.${patSecret.slice(0, -1)}${patSecret.endsWith("A") ? "B" : "A"}`), "SESSION_DENIED"); // altered secret
  refused(await session(`${samId}.${patSecret}`), "SESSION_DENIED"); // another shopper's session id
  refused(await session(patId), "SESSION_DENIED"); // no secret
  refused(await session(""), "SESSION_DENIED");

  // A session that has run out, and one begun on another store, both with a correct secret.
  const secret = "known-secret";
  await host.fixtures.plugin.storage("sessions", "expired", {
    sessionId: "expired", emailKey: "pat@example.test", verifier: await sha256Hex(`expired:pat@example.test:${secret}`),
    site: SITE, createdAt: nowSeconds() - 31 * 86400, expiresAt: nowSeconds() - 60,
  });
  await host.fixtures.plugin.storage("sessions", "elsewhere", {
    sessionId: "elsewhere", emailKey: "pat@example.test", verifier: await sha256Hex(`elsewhere:pat@example.test:${secret}`),
    site: "https://other-shop.example.test", createdAt: nowSeconds(), expiresAt: nowSeconds() + 86400,
  });
  refused(await session(`expired.${secret}`), "SESSION_DENIED");
  refused(await session(`elsewhere.${secret}`), "SESSION_DENIED");

  // The same valid token, sent to a different host name for this store.
  refused(await call("session", {
    method: "GET", url: `https://other-shop.example.test/_emdash/api/plugins/${host.manifest.id}/session`, headers: { [SESSION_HEADER]: pat },
  }), "ORIGIN_DENIED");

  // Writes from another site's page are refused, and sign-out does nothing for them.
  const crossSite = { origin: "https://evil.example.test", "sec-fetch-site": "cross-site" };
  refused(await call("sign-out", { headers: { ...crossSite, [SESSION_HEADER]: pat }, body: {} }), "ORIGIN_DENIED");
  refused(await call("sign-out", { headers: { origin: SITE, "sec-fetch-site": "cross-site", [SESSION_HEADER]: pat }, body: {} }), "ORIGIN_DENIED");
  refused(await call("sign-out", { headers: { [SESSION_HEADER]: pat }, body: {} }), "ORIGIN_DENIED"); // no Origin or Sec-Fetch-Site
  refused(await call("sign-in/start", { headers: crossSite, body: { email: "pat@example.test" } }), "ORIGIN_DENIED");
  expect(await session(pat)).toMatchObject({ ok: true, email: "pat@example.test" });
});

test("a code runs out after 10 minutes and after 5 tries", async () => {
  await host.fixtures.plugin.storage("sign_in_codes", "pat@example.test", {
    emailKey: "pat@example.test", verifier: await sha256Hex("pat@example.test:123456"), tries: 0,
    issuedAt: nowSeconds() - 601, expiresAt: nowSeconds() - 1, used: false,
  });
  refused(await call("sign-in/verify", { body: { email: "pat@example.test", code: "123456" } }), "CODE_EXPIRED");

  await host.fixtures.plugin.storage("sign_in_codes", "pat@example.test", {
    emailKey: "pat@example.test", verifier: await sha256Hex("pat@example.test:123456"), tries: 0,
    issuedAt: nowSeconds() - 60, expiresAt: nowSeconds() + 540, used: false,
  });
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    refused(await call("sign-in/verify", { body: { email: "pat@example.test", code: "000000" } }), "CODE_INVALID");
  }
  refused(await call("sign-in/verify", { body: { email: "pat@example.test", code: "000000" } }), "CODE_EXHAUSTED");
  // Even the right code is refused once 5 tries are used, and no session is made.
  refused(await call("sign-in/verify", { body: { email: "pat@example.test", code: "123456" } }), "CODE_EXHAUSTED");
  expect(await host.inspect.storage.list("sessions")).toEqual([]);
  expect(await host.inspect.storage.list("shoppers")).toEqual([]);
});

test("the twice-daily clean-up deletes only expired codes and sessions", async () => {
  const live = await signIn("pat@example.test");
  const past = nowSeconds() - 60;
  await host.fixtures.plugin.storage("sign_in_codes", "old@example.test", {
    emailKey: "old@example.test", verifier: "x", tries: 0, issuedAt: past - 600, expiresAt: past, used: false,
  });
  await host.fixtures.plugin.storage("sessions", "old", {
    sessionId: "old", emailKey: "old@example.test", verifier: "x", site: SITE, createdAt: past - 86400, expiresAt: past,
  });
  const [task] = await host.inspect.scheduledTasks();
  host.scheduled.setTime(String(task!.nextRunAt));
  await host.scheduled.run();
  await host.waitForDeferredTasks();

  expect((await host.inspect.storage.list("sign_in_codes")).map(row => row.id)).toEqual(["pat@example.test"]);
  expect((await host.inspect.storage.list("sessions")).map(row => row.id)).toEqual([live.split(".")[0]]);
  expect(await session(live)).toMatchObject({ ok: true, email: "pat@example.test" });
});
