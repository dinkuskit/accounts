import { pluginRoute, type PluginContext, type SandboxedPlugin, type SandboxedRouteContext } from "emdash/plugin";
import { readAccount, saveAccount } from "./account.js";
import { accountsAdmin } from "./admin.js";
import { cleanUpExpired, CLEANUP_TASK, scheduleCleanup } from "./cleanup.js";
import { canonicalOrigin, headerValue, isSameOriginWrite } from "./shared.js";
import {
  readSession, refusal, SESSION_HEADER, SESSIONS, SHOPPERS, SIGN_IN_CODES, signOut, startSignIn, verifySignIn,
  type SignInHost, type SignInStore,
} from "./sign-in.js";

type Route = Omit<SandboxedRouteContext, "input"> & { input: unknown };

function bind(ctx: PluginContext): { store: SignInStore; host: SignInHost } | undefined {
  const site = canonicalOrigin(ctx.site?.url);
  const store = { shoppers: ctx.storage[SHOPPERS], codes: ctx.storage[SIGN_IN_CODES], sessions: ctx.storage[SESSIONS] } as SignInStore;
  if (!site || !store.shoppers || !store.codes || !store.sessions) return undefined;
  const storeName = typeof ctx.site.name === "string" && ctx.site.name.trim() ? ctx.site.name.trim() : "Store";
  return { store, host: { site, storeName, send: ctx.email ? message => ctx.email!.send(message) : undefined } };
}

/**
 * A public shopper route. Writes must come from this store (its own server page sends Origin);
 * reads must at least be addressed to this store. Refusals answer { ok: false, error }.
 */
function shopperRoute(methods: ("GET" | "POST")[], headers: string[], body: "json" | "none" | "text",
  action: (store: SignInStore, host: SignInHost, route: Route) => Promise<unknown>) {
  return pluginRoute({
    public: true,
    methods,
    cacheControl: "no-store",
    request: { body, headers },
    handler: async (route: Route, ctx: PluginContext) => {
      const bound = bind(ctx);
      if (!bound) return refusal("UNAVAILABLE");
      const write = route.request.method.toUpperCase() !== "GET";
      const allowed = write ? isSameOriginWrite(route.request, bound.host.site) : canonicalOrigin(route.request.url) === bound.host.site;
      if (!allowed) return refusal("ORIGIN_DENIED");
      return action(bound.store, bound.host, route);
    },
  });
}

const session = (route: Route) => headerValue(route.request.headers, SESSION_HEADER);
const WRITE_HEADERS = ["origin", "sec-fetch-site"];
/** GET account has no body, so the route takes text and reads a POST's JSON itself, as Commerce's profile route does. */
const json = (input: unknown) => {
  if (typeof input !== "string") return input;
  try { return JSON.parse(input); } catch { return null; }
};

/**
 * DinkusKit Accounts for EmDash stores: shoppers sign in with a 6-digit code sent by email.
 * The signed-in shopper keeps one delivery address and one phone number (accounts-saved-address-20261122).
 */
const plugin: SandboxedPlugin = {
  hooks: {
    "plugin:install": async (_event, ctx) => scheduleCleanup(ctx),
    "plugin:activate": async (_event, ctx) => scheduleCleanup(ctx),
    cron: async (event, ctx) => {
      if (event.name === CLEANUP_TASK) await cleanUpExpired(ctx);
    },
  },
  routes: {
    // Editors and Administrators; lower roles do not see Shopper accounts.
    admin: { public: false, permission: "content:edit_any", methods: ["POST"], handler: route => accountsAdmin(route) },
    "sign-in/start": shopperRoute(["POST"], WRITE_HEADERS, "json", (store, host, route) => startSignIn(store, host, route.input)),
    "sign-in/verify": shopperRoute(["POST"], WRITE_HEADERS, "json", (store, host, route) => verifySignIn(store, host, route.input)),
    session: shopperRoute(["GET"], [SESSION_HEADER], "none", (store, host, route) => readSession(store, host, session(route))),
    "sign-out": shopperRoute(["POST"], [...WRITE_HEADERS, SESSION_HEADER], "json", (store, host, route) => signOut(store, host, session(route))),
    // The account page and the checkout page read the shopper here; the account form saves here.
    account: shopperRoute(["GET", "POST"], [...WRITE_HEADERS, SESSION_HEADER], "text", (store, host, route) =>
      route.request.method.toUpperCase() === "GET" ? readAccount(store, host, session(route)) : saveAccount(store, host, session(route), json(route.input))),
  },
};

export default plugin;
