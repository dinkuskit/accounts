import assert from "node:assert/strict";
import plugin from "../dist/plugin.mjs";

export const SITE = "https://shop.example.test";
export const SESSION_HEADER = "x-dinkus-accounts-session";

/** EmDash plugin storage, in memory: revisions, compare-and-set, and expiresAt range queries. */
export function collection() {
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
    async compareAndDelete(id, expected) {
      if (rows.get(id)?.revision !== expected) return { applied: false };
      rows.delete(id);
      return { applied: true };
    },
    async deleteMany(ids) { return ids.filter(id => rows.delete(id)).length; },
    async query({ where, limit = 50 }) {
      const matching = [...rows].filter(([, row]) => row.value.expiresAt <= where.expiresAt.lte);
      return { items: matching.slice(0, limit).map(([id, row]) => ({ id, data: row.value })), hasMore: matching.length > limit };
    },
  };
}

export function store({ email = true, failSend = false, site = SITE } = {}) {
  const sent = [];
  const ctx = {
    site: { url: site, name: "Corner Shop" },
    storage: { shoppers: collection(), sign_in_codes: collection(), sessions: collection() },
    email: email ? { send: async message => { if (failSend) throw new Error("smtp down"); sent.push(message); } } : undefined,
    cron: { scheduled: [], schedule: async (name, opts) => { ctx.cron.scheduled.push([name, opts.schedule]); } },
  };
  return { ctx, sent };
}

export const sameSite = { origin: SITE, "sec-fetch-site": "same-origin" };
export const call = (ctx, name, { input, headers = sameSite, url = `${SITE}/_emdash/api/plugins/dinkus-accounts/${name}`, method } = {}) => {
  const route = plugin.routes[name];
  return route.handler({ input, request: { url, method: method ?? route.methods[0], headers } }, ctx);
};
export const codeIn = message => message.text.match(/\b(\d{6})\b/)[1];

export async function signIn(ctx, sent, email = "Pat@Example.test") {
  assert.equal((await call(ctx, "sign-in/start", { input: { email } })).ok, true);
  const verified = await call(ctx, "sign-in/verify", { input: { email, code: codeIn(sent.at(-1)) } });
  assert.equal(verified.ok, true);
  return verified;
}

