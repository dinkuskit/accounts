import type { BlockResponse } from "@emdash-cms/blocks/server";
import type { SandboxedRouteContext } from "emdash/plugin";

/** EmDash's Editor role; Administrators are above it. Lower roles never see Shopper accounts. */
const EDITOR = 40;

/**
 * The Shopper accounts page in the store admin. The scaffold keeps no accounts, so the page
 * says so plainly instead of showing an empty list that looks broken.
 */
export async function accountsAdmin(route: SandboxedRouteContext): Promise<BlockResponse> {
  const user = route.user;
  if (route.ui?.surface !== "admin-page" || typeof user?.role !== "number" || user.role < EDITOR) {
    return { blocks: [{ type: "banner", variant: "error", title: "Shopper accounts is for Editors and Administrators", description: "Ask an Administrator of this site to manage shopper accounts." }] };
  }
  return {
    blocks: [
      { type: "header", text: "Shopper accounts" },
      { type: "banner", variant: "default", title: "No shopper accounts yet", description: "This version of DinkusKit Accounts does not let shoppers sign in. Shoppers still check out as guests, and no email is sent." },
    ],
  };
}
