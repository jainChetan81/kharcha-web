import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/client";
import { getMeta } from "../db/queries";
import { miniStatus, requestSync } from "../mini";

/** Sync pill and Settings → Sync (§9, §18). */
export const getSyncStatus = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb();
  return { ...(await miniStatus(db)), lastIngestAt: (await getMeta(db, "last_ingest_at")) ?? null };
});

export const syncNow = createServerFn({ method: "POST" }).handler(async () => {
  await requestSync(getDb());
  return { ok: true };
});
