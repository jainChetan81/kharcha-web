// Post-write jobs (§8): run after each ingest, add and edit. A failing job never fails the write.
import type { Db } from "./db/client";
import { matchRecurring, tagTrips } from "./plan/jobs";
import { linkSips } from "./wealth/jobs";
import { fillMissing } from "./ai/embed";

const embedMerchants = (_ids: number[], db?: Db) => (db ? fillMissing(db) : Promise.resolve());

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
