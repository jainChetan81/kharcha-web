import type { Db } from "../db/client";

/** SIP linking (§8): debits matching a holding's sms_match become holding_txns. Owned by the Wealth area. */
export async function linkSips(_txnIds: number[], _db?: Db): Promise<void> {}

/** prices job (§8): 23:30 and 06:00 IST. Called by /api/jobs/prices. */
export async function runPrices(_db?: Db): Promise<{ updated: number }> {
  return { updated: 0 };
}
