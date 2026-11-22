import { emdashPluginTest } from "@emdash-cms/plugin-test/config";
import { defineConfig } from "vitest/config";

// Builds the plugin and runs it inside EmDash's production Cloudflare sandbox runner (workerd, real D1).
export default defineConfig({
  plugins: [emdashPluginTest()],
  test: { include: ["tests/runtime/**/*.test.ts"] },
});
