// Mini presence and Sync now (§18). The VPS can't reach the mini, so the mini polls
// /api/mini/poll every 30 s; each poll records last_seen_at and picks up a pending request.
import { and, count, eq, gte } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { getMeta, setMeta } from "./db/queries.ts";
import { transactions } from "./db/schema.ts";

const SEEN = "mini_last_seen_at";
const REQUESTED = "sync_requested_at";
const DONE = "sync_done_at";
const ONLINE_MS = 2 * 60_000;

/** Called by the mini. Returns whether a sync was asked for since its last finished run. */
export async function minipoll(db: Db, done: boolean, now = new Date()): Promise<{ sync: boolean }> {
  const at = now.toISOString();
  await setMeta(db, SEEN, at);
  if (done) await setMeta(db, DONE, at);
  const [requested, finished] = await Promise.all([getMeta(db, REQUESTED), getMeta(db, DONE)]);
  return { sync: !!requested && (!finished || finished < requested) };
}

export async function requestSync(db: Db, now = new Date()): Promise<void> {
  await setMeta(db, REQUESTED, now.toISOString());
}

export type SyncState = "idle" | "waiting" | "synced";

export async function miniStatus(db: Db, now = Date.now()) {
  const [seen, requested, finished] = await Promise.all([getMeta(db, SEEN), getMeta(db, REQUESTED), getMeta(db, DONE)]);
  const online = !!seen && now - Date.parse(seen) < ONLINE_MS;
  const state: SyncState = !requested ? "idle" : !finished || finished < requested ? "waiting" : "synced";
  // ponytail: "new" counts SMS rows first stored after the request; an edit re-push is not new.
  const fresh = state === "synced" && requested
    ? (await db.select({ n: count() }).from(transactions).where(and(eq(transactions.source, "sms"), gte(transactions.createdAt, requested.slice(0, 19).replace("T", " ")))).get())?.n ?? 0
    : 0;
  return { seenAt: seen ?? null, online, sync: state, syncNew: fresh, requestedAt: requested ?? null };
}
