import type { BlockResponse } from "@emdash-cms/blocks/server";
import type { SandboxedRouteContext } from "emdash/plugin";

/** EmDash's Editor role; Administrators are above it. Lower roles never see Shopper accounts. */
const EDITOR = 40;

/**
 * The Shopper accounts page in the store admin. Shoppers can sign in, but their saved addresses
 * and account page are not built yet, so the page says what works today.
 */
export async function accountsAdmin(route: SandboxedRouteContext): Promise<BlockResponse> {
  const user = route.user;
  if (route.ui?.surface !== "admin-page" || typeof user?.role !== "number" || user.role < EDITOR) {
    return { blocks: [{ type: "banner", variant: "error", title: "Shopper accounts is for Editors and Administrators", description: "Ask an Administrator of this site to manage shopper accounts." }] };
  }
  return {
    blocks: [
      { type: "header", text: "Shopper accounts" },
      { type: "banner", variant: "default", title: "Shoppers can sign in with an emailed code", description: "A shopper enters their email, gets a 6-digit code from this store's email setup in EmDash, and stays signed in for 30 days. Saved addresses and the account page come next. Shoppers can always check out as guests." },
    ],
  };
}
