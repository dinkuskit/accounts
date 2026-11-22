import test from "node:test";
import assert from "node:assert/strict";
import plugin from "../dist/plugin.mjs";

const SITE = "https://shop.example.test";
const SESSION_HEADER = "x-dinkus-accounts-session";

/** EmDash plugin storage, in memory: revisions, compare-and-set, and expiresAt range queries. */
function collection() {
  const rows = new Map();
  let revision = 0;
  return {
    rows,
    async get(id) { return rows.has(id) ? structuredClone(rows.get(id).value) : null; },
    async getVersioned(id) { return rows.has(id) ? structuredClone(rows.get(id)) : null; },
    async compareAndSet(id, expected, value) {
      const current = rows.get(id);
      if ((current?.revision ?? null) !== expected) return { applied: false };
      const next = { value: structuredClone(value), revision: String(++revision) };
      rows.set(id, next);
      return { applied: true, revision: next.revision };
    },
    async delete(id) { return rows.delete(id); },
    async deleteMany(ids) { return ids.filter(id => rows.delete(id)).length; },
    async query({ where, limit = 50 }) {
      const matching = [...rows].filter(([, row]) => row.value.expiresAt <= where.expiresAt.lte);
      return { items: matching.slice(0, limit).map(([id, row]) => ({ id, data: row.value })), hasMore: matching.length > limit };
    },
  };
}

function store({ email = true, failSend = false, site = SITE } = {}) {
  const sent = [];
  const ctx = {
    site: { url: site, name: "Corner Shop" },
    storage: { shoppers: collection(), sign_in_codes: collection(), sessions: collection() },
    email: email ? { send: async message => { if (failSend) throw new Error("smtp down"); sent.push(message); } } : undefined,
    cron: { scheduled: [], schedule: async (name, opts) => { ctx.cron.scheduled.push([name, opts.schedule]); } },
  };
  return { ctx, sent };
}

const sameSite = { origin: SITE, "sec-fetch-site": "same-origin" };
const call = (ctx, name, { input, headers = sameSite, url = `${SITE}/_emdash/api/plugins/dinkus-accounts/${name}` } = {}) => {
  const route = plugin.routes[name];
  return route.handler({ input, request: { url, method: route.methods[0], headers } }, ctx);
};
const codeIn = message => message.text.match(/\b(\d{6})\b/)[1];

async function signIn(ctx, sent, email = "Pat@Example.test") {
  assert.equal((await call(ctx, "sign-in/start", { input: { email } })).ok, true);
  const verified = await call(ctx, "sign-in/verify", { input: { email, code: codeIn(sent.at(-1)) } });
  assert.equal(verified.ok, true);
  return verified;
}

test("the plugin has the admin route and four public shopper routes", () => {
  assert.deepEqual(Object.keys(plugin.routes).sort(), ["admin", "session", "sign-in/start", "sign-in/verify", "sign-out"]);
  for (const name of ["session", "sign-in/start", "sign-in/verify", "sign-out"]) {
    assert.equal(plugin.routes[name].public, true);
    assert.equal(plugin.routes[name].cacheControl, "no-store");
  }
  assert.deepEqual(plugin.routes.session.methods, ["GET"]);
  assert.deepEqual(plugin.routes["sign-out"].request.headers.sort(), ["origin", "sec-fetch-site", SESSION_HEADER].sort());
});

test("a shopper signs in with an emailed code, stays signed in, and signs out", async () => {
  const { ctx, sent } = store();
  const started = await call(ctx, "sign-in/start", { input: { email: " Pat@Example.test " } });
  assert.equal(started.ok, true);
  assert.equal(started.email, "Pat@Example.test");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "Pat@Example.test");
  assert.match(sent[0].subject, /^Your Corner Shop sign-in code: \d{6}$/);
  assert.match(sent[0].text, /expires in 10 minutes/);
  const stored = ctx.storage.sign_in_codes.rows.get("pat@example.test").value;
  assert.doesNotMatch(JSON.stringify(stored), new RegExp(codeIn(sent[0])), "the code itself is never stored");

  const verified = await call(ctx, "sign-in/verify", { input: { email: "Pat@Example.test", code: codeIn(sent[0]) } });
  assert.equal(verified.ok, true);
  assert.equal(verified.email, "Pat@Example.test");
  const days = (Date.parse(verified.expiresAt) - Date.now()) / 86400_000;
  assert.ok(days > 29.9 && days <= 30, "a session lasts 30 days");
  assert.equal(ctx.storage.shoppers.rows.size, 1);
  const secret = verified.session.split(".")[1];
  assert.doesNotMatch(JSON.stringify([...ctx.storage.sessions.rows.values()]), new RegExp(secret), "the session secret is never stored");

  const who = await call(ctx, "session", { headers: { [SESSION_HEADER]: verified.session } });
  assert.deepEqual({ ok: who.ok, email: who.email }, { ok: true, email: "Pat@Example.test" });

  assert.equal((await call(ctx, "sign-in/verify", { input: { email: "pat@example.test", code: codeIn(sent[0]) } })).error.code, "CODE_INVALID", "a code works once");

  const out = await call(ctx, "sign-out", { input: {}, headers: { ...sameSite, [SESSION_HEADER]: verified.session } });
  assert.deepEqual(out, { ok: true, signedOut: true });
  assert.equal((await call(ctx, "session", { headers: { [SESSION_HEADER]: verified.session } })).error.code, "SESSION_DENIED");
});

test("signing in again keeps the one shopper record", async () => {
  const { ctx, sent } = store();
  await signIn(ctx, sent);
  ctx.storage.sign_in_codes.rows.clear();
  await signIn(ctx, sent, "pat@example.test");
  assert.equal(ctx.storage.shoppers.rows.size, 1);
  assert.equal(ctx.storage.shoppers.rows.get("pat@example.test").value.email, "Pat@Example.test");
  assert.equal(ctx.storage.sessions.rows.size, 2);
});

test("a code allows 5 tries, right or wrong", async () => {
  const { ctx, sent } = store();
  await call(ctx, "sign-in/start", { input: { email: "pat@example.test" } });
  const right = codeIn(sent[0]);
  const wrong = right === "000000" ? "111111" : "000000";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await call(ctx, "sign-in/verify", { input: { email: "pat@example.test", code: wrong } })).error.code, "CODE_INVALID");
  }
  const late = await call(ctx, "sign-in/verify", { input: { email: "pat@example.test", code: right } });
  assert.equal(late.error.code, "CODE_INVALID");
  assert.equal(ctx.storage.sessions.rows.size, 0);
});

test("a code expires after 10 minutes, and a new one waits 30 seconds", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-22T12:00:00Z") });
  const { ctx, sent } = store();
  await call(ctx, "sign-in/start", { input: { email: "pat@example.test" } });
  t.mock.timers.tick(29_000);
  assert.equal((await call(ctx, "sign-in/start", { input: { email: "pat@example.test" } })).error.code, "RATE_LIMITED");
  assert.equal(sent.length, 1);
  t.mock.timers.tick(571_000);
  const expired = await call(ctx, "sign-in/verify", { input: { email: "pat@example.test", code: codeIn(sent[0]) } });
  assert.equal(expired.error.code, "CODE_EXPIRED");
  assert.equal((await call(ctx, "sign-in/start", { input: { email: "pat@example.test" } })).ok, true);
  assert.equal(sent.length, 2);
});

test("a session ends after 30 days", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-22T12:00:00Z") });
  const { ctx, sent } = store();
  const { session } = await signIn(ctx, sent);
  t.mock.timers.tick(30 * 86400_000 - 1000);
  assert.equal((await call(ctx, "session", { headers: { [SESSION_HEADER]: session } })).ok, true);
  t.mock.timers.tick(1000);
  assert.equal((await call(ctx, "session", { headers: { [SESSION_HEADER]: session } })).error.code, "SESSION_DENIED");
});

test("a made-up or altered session token is refused", async () => {
  const { ctx, sent } = store();
  const { session } = await signIn(ctx, sent);
  const [id, secret] = session.split(".");
  for (const token of [undefined, "", "nodot", `${id}.`, `.${secret}`, `${id}.${secret.replace(/.$/, c => (c === "0" ? "1" : "0"))}`, `other.${secret}`]) {
    const headers = token === undefined ? {} : { [SESSION_HEADER]: token };
    assert.equal((await call(ctx, "session", { headers })).error.code, "SESSION_DENIED", String(token));
  }
});

test("a session from one store does not work on another", async () => {
  const first = store();
  const { session } = await signIn(first.ctx, first.sent);
  const moved = { ...first.ctx, site: { url: "https://other.example.test", name: "Other" } };
  const answer = await call(moved, "session", { headers: { [SESSION_HEADER]: session }, url: "https://other.example.test/_emdash/api/plugins/dinkus-accounts/session" });
  assert.equal(answer.error.code, "SESSION_DENIED");
});

test("writes must come from the store itself", async () => {
  const { ctx, sent } = store();
  const input = { email: "pat@example.test" };
  for (const headers of [{}, { origin: "https://evil.example.test" }, { "sec-fetch-site": "cross-site" }, { origin: SITE, "sec-fetch-site": "cross-site" }]) {
    assert.equal((await call(ctx, "sign-in/start", { input, headers })).error.code, "ORIGIN_DENIED", JSON.stringify(headers));
  }
  assert.equal((await call(ctx, "sign-in/start", { input, url: "https://evil.example.test/x" })).error.code, "ORIGIN_DENIED");
  assert.equal(sent.length, 0);
  // The store's own server page sends Origin only; a browser form sends Sec-Fetch-Site only.
  assert.equal((await call(ctx, "sign-in/start", { input, headers: { origin: SITE } })).ok, true);
  assert.equal((await call(ctx, "session", { url: "https://evil.example.test/session" })).error.code, "ORIGIN_DENIED");
});

test("bad input is refused with the shopper's message", async () => {
  const { ctx } = store();
  const start = input => call(ctx, "sign-in/start", { input });
  assert.equal((await start({ email: "" })).error.code, "EMAIL_REQUIRED");
  assert.equal((await start({ email: "not-an-email" })).error.code, "EMAIL_INVALID");
  assert.equal((await start({ email: "pat@example.test", extra: 1 })).error.code, "INVALID_INPUT");
  assert.equal((await start("pat@example.test")).error.code, "INVALID_INPUT");
  const verify = await call(ctx, "sign-in/verify", { input: { email: "pat@example.test", code: "12345" } });
  assert.deepEqual(verify, { ok: false, error: { code: "CODE_INVALID", message: "That sign-in code is not right." } });
});

test("with no email set up, sign-in says so and stores nothing", async () => {
  const { ctx } = store({ email: false });
  const answer = await call(ctx, "sign-in/start", { input: { email: "pat@example.test" } });
  assert.equal(answer.error.code, "EMAIL_UNAVAILABLE");
  assert.match(answer.error.message, /check out as a guest/);
  assert.equal(ctx.storage.sign_in_codes.rows.size, 0);
});

test("a code that could not be sent is cancelled and does not hold the wait", async () => {
  const failing = store({ failSend: true });
  assert.equal((await call(failing.ctx, "sign-in/start", { input: { email: "pat@example.test" } })).error.code, "EMAIL_UNAVAILABLE");
  const row = failing.ctx.storage.sign_in_codes.rows.get("pat@example.test").value;
  assert.equal(row.used, true);
  assert.equal(row.issuedAt, 0);
  failing.ctx.email = { send: async message => failing.sent.push(message) };
  assert.equal((await call(failing.ctx, "sign-in/start", { input: { email: "pat@example.test" } })).ok, true);
});

test("expired codes and sessions are cleared twice a day", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-22T12:00:00Z") });
  const { ctx, sent } = store();
  await plugin.hooks["plugin:install"]({}, ctx);
  await plugin.hooks["plugin:activate"]({}, ctx);
  assert.deepEqual(ctx.cron.scheduled[0], ["accounts-cleanup", "0 */12 * * *"]);
  const { session } = await signIn(ctx, sent);
  await plugin.hooks.cron({ name: "accounts-cleanup", scheduledAt: "" }, ctx);
  assert.equal(ctx.storage.sessions.rows.size, 1, "a live session stays");
  t.mock.timers.tick(31 * 86400_000);
  await plugin.hooks.cron({ name: "something-else", scheduledAt: "" }, ctx);
  assert.equal(ctx.storage.sessions.rows.size, 1);
  await plugin.hooks.cron({ name: "accounts-cleanup", scheduledAt: "" }, ctx);
  assert.equal(ctx.storage.sessions.rows.size, 0);
  assert.equal(ctx.storage.sign_in_codes.rows.size, 0);
  assert.equal(ctx.storage.shoppers.rows.size, 1, "the shopper stays");
  assert.equal((await call(ctx, "session", { headers: { [SESSION_HEADER]: session } })).error.code, "SESSION_DENIED");
});
