// Post-write jobs (§8): run after each ingest, add and edit. A failing job never fails the write.
import { type Db, getDb } from "./db/client";
import { matchRecurring, tagTrips } from "./plan/jobs";
import { linkSips } from "./wealth/jobs";
import { fillMissing } from "./ai/embed";

// Not awaited: a slow 9Router must not hold up ingest or edits. Misses are filled by the embeddings job.
const embedMerchants = async (_ids: number[], db?: Db) => { void fillMissing(db ?? getDb()).catch((error) => console.error("embed merchants failed", error)); };

export async function afterWrite(txnIds: number[], db?: Db): Promise<void> {
  if (txnIds.length === 0) return;
  for (const job of [tagTrips, matchRecurring, linkSips, embedMerchants]) {
    try {
      await job(txnIds, db);
    } catch (error) {
      console.error(`post-write job ${job.name} failed`, error);
    }
  }
}
