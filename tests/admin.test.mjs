import test from "node:test";
import assert from "node:assert/strict";
import plugin from "../dist/plugin.mjs";
import { validateBlockResponse } from "@emdash-cms/blocks/server";

const admin = plugin.routes.admin.handler;
const route = (role, surface = "admin-page") => ({
  input: { type: "page_load" }, ui: { surface, locale: "en", direction: "ltr" },
  user: role === null ? undefined : { id: "u1", email: "staff@example.test", name: "Staff", role, createdAt: "" },
  request: { url: "", method: "POST", headers: {} },
});
const text = response => JSON.stringify(response);

test("the admin route is private and for Editors and Administrators", async () => {
  assert.equal(plugin.routes.admin.public, false);
  assert.equal(plugin.routes.admin.permission, "content:edit_any");
  for (const refused of [route(30), route(null), route(50, "editor-panel")]) {
    const response = await admin(refused, {});
    assert.match(text(response), /Editors and Administrators/);
    assert.doesNotMatch(text(response), /Shoppers can sign in/);
  }
});

test("the Shopper accounts page says what works today", async () => {
  for (const role of [40, 50]) {
    const response = await admin(route(role), {});
    assert.equal(validateBlockResponse(response).valid, true);
    assert.match(text(response), /Shoppers can sign in with an emailed code/);
    assert.match(text(response), /one delivery address and phone number/);
  }
});
