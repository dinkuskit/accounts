import { bundlePlugin } from "@emdash-cms/plugin-cli";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

// Runs the official Registry packaging on this repository's root plugin, so a
// backend over the 128 KiB per-file cap (RFC 0001) fails the build instead of a
// later install. bundlePlugin enforces the limit; this reports the headroom.
const REGISTRY_FILE_LIMIT_BYTES = 128 * 1024;
const directory = resolve(".tmp/registry-bundle");
await rm(directory, { recursive: true, force: true });
const extracted = resolve(directory, "extracted");
await mkdir(extracted, { recursive: true });
const artifact = await bundlePlugin({ dir: resolve("."), outDir: resolve(directory, "build") });
execFileSync("tar", ["-xf", artifact.tarballPath, "-C", extracted]);
const backend = await readFile(resolve(extracted, "backend.js"));
const manifest = JSON.parse(await readFile(resolve(extracted, "manifest.json"), "utf8"));
if (manifest.id !== "dinkus-accounts") throw new Error(`unexpected plugin id ${manifest.id}`);
// Each public route, network host and capability is added on purpose, here and in the manifest together.
const PUBLIC_ROUTES = ["session", "sign-in/start", "sign-in/verify", "sign-out"];
const publicRoutes = manifest.routes.filter(route => route.public).map(route => route.name).sort();
if (JSON.stringify(publicRoutes) !== JSON.stringify(PUBLIC_ROUTES)) throw new Error(`unexpected public routes ${publicRoutes}`);
if ((manifest.allowedHosts ?? []).length > 0) throw new Error("the Accounts plugin asks for no network host");
if (JSON.stringify(manifest.capabilities ?? []) !== JSON.stringify(["email:send"])) throw new Error(`unexpected capabilities ${manifest.capabilities}`);
console.log([
  "registry_bundle=pass",
  `backend_bytes=${backend.byteLength}`,
  `headroom_bytes=${REGISTRY_FILE_LIMIT_BYTES - backend.byteLength}`,
  `backend_sha256=${createHash("sha256").update(backend).digest("hex")}`,
].join(" "));
