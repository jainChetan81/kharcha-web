import { type Db, getDb } from "./db/client";
import { matchRecurring, tagTrips } from "./plan/jobs";
import { linkSips } from "./wealth/jobs";
import { fillMissing } from "./ai/embed";

export async function afterWrite(txnIds: number[], db?: Db): Promise<void> {
  if (txnIds.length === 0) return;
  for (const job of [tagTrips, matchRecurring, linkSips]) {
    try {
      await job(txnIds, db);
    } catch (error) {
      console.error(`post-write job ${job.name} failed`, error);
    }
  }
  // A slow 9Router must not hold up ingest or edits.
  try {
    void fillMissing(db ?? getDb()).catch((error) => console.error("embed merchants failed", error));
  } catch (error) {
    console.error("embed merchants failed", error);
  }
}
