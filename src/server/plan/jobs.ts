import type { Db } from "../db/client";

/** trip-tag (§8): tag rows inside an active trip window. Owned by the Plan area. */
export async function tagTrips(_txnIds: number[], _db?: Db): Promise<void> {}

/** recurring (§8): match new rows to series, predict next dates, suggest series. Owned by the Plan area. */
export async function matchRecurring(_txnIds: number[], _db?: Db): Promise<void> {}
