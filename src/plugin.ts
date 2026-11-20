import type { SandboxedPlugin } from "emdash/plugin";
import { accountsAdmin } from "./admin.js";

/**
 * DinkusKit Accounts for EmDash stores: shopper sign-in, saved addresses and past orders.
 * This is the scaffold. It has one admin page and keeps no data.
 */
const plugin: SandboxedPlugin = {
  routes: {
    // Editors and Administrators; lower roles do not see Shopper accounts.
    admin: { public: false, permission: "content:edit_any", methods: ["POST"], handler: route => accountsAdmin(route) },
  },
};

export default plugin;
