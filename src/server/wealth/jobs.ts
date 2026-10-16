import type { Db } from "../db/client";

/** SIP linking (§8): debits matching a holding's sms_match become holding_txns. Owned by the Wealth area. */
export async function linkSips(_txnIds: number[], _db?: Db): Promise<void> {}
