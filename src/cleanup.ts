import type { PluginContext, StorageCollection } from "emdash";
import { SESSIONS, SIGN_IN_CODES } from "./sign-in.js";

/** Twice a day, as WooCommerce clears expired shopper sessions (woocommerce_cleanup_sessions). */
export const CLEANUP_TASK = "accounts-cleanup";
export const CLEANUP_SCHEDULE = "0 */12 * * *";
/** Up to 5 pages of 100 per run, inside the sandbox's time limits; the next run takes the rest. */
const CLEANUP_PAGES = 5;

/** Registers the cleanup; scheduling the same task again only keeps it. */
export async function scheduleCleanup(ctx: PluginContext): Promise<void> {
  await ctx.cron?.schedule(CLEANUP_TASK, { schedule: CLEANUP_SCHEDULE });
}

/**
 * Deletes expired sign-in codes and sessions. EmDash plugin storage keeps rows until a plugin
 * deletes them, and an expired row is already refused, so this only stops them piling up.
 */
export async function cleanUpExpired(ctx: PluginContext, now = Math.floor(Date.now() / 1000)): Promise<number> {
  let deleted = 0;
  for (const name of [SIGN_IN_CODES, SESSIONS]) {
    const collection = ctx.storage[name] as StorageCollection<{ expiresAt: number }> | undefined;
    if (!collection) continue;
    for (let page = 0; page < CLEANUP_PAGES; page += 1) {
      const expired = await collection.query({ where: { expiresAt: { lte: now } }, limit: 100 });
      if (!expired.items.length) break;
      for (const { id } of expired.items) {
        // sign-in/start may have put a fresh code under the same key since the query. Delete only
        // the revision read here, and only while it is still expired, so a new code is never lost.
        const current = await collection.getVersioned(id);
        if (!current || !(current.value.expiresAt <= now)) continue;
        if ((await collection.compareAndDelete(id, current.revision)).applied) deleted += 1;
      }
      if (!expired.hasMore) break;
    }
  }
  return deleted;
}
