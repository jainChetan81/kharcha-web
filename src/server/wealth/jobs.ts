import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb, type Db } from "../db/client.ts";
import { holdingTxns, holdings, prices, transactions } from "../db/schema.ts";

const ymd = (date: string) => date.slice(0, 10);
const timeoutFetch = (url: string) => fetch(url, { signal: AbortSignal.timeout(10_000) });

async function nearestNav(db: Db, code: string, date: string) {
  const rows = await db.select().from(prices).where(and(eq(prices.schemeCode, code), lte(prices.date, date))).orderBy(prices.date);
  return rows.at(-1);
}

/** SIP linking (§8): idempotently turns matching investment debits into holding buys. */
export async function linkSips(txnIds: number[], db: Db = getDb()): Promise<void> {
  if (!txnIds.length) return;
  const [rows, open] = await Promise.all([
    db.select().from(transactions).where(inArray(transactions.id, txnIds)),
    db.select().from(holdings).where(eq(holdings.isClosed, false)),
  ]);
  for (const row of rows) for (const holding of open) {
    if (!holding.smsMatch || !row.merchant.toLowerCase().includes(holding.smsMatch.toLowerCase()) || row.type === "income") continue;
    const price = holding.schemeCode ? await nearestNav(db, holding.schemeCode, ymd(row.date)) : undefined;
    await db.insert(holdingTxns).values({
      holdingId: holding.id, transactionId: row.id, date: ymd(row.date), amount: row.amount,
      nav: price?.nav ?? null, units: price ? row.amount / price.nav : null, source: "sms",
    }).onConflictDoNothing();
  }
}

async function amfiNav(code: string) {
  const text = await (await timeoutFetch("https://www.amfiindia.com/spages/NAVAll.txt")).text();
  const line = text.split("\n").find((item) => item.startsWith(`${code};`));
  if (!line) return undefined;
  const [, , nav, date] = line.split(";");
  const parts = date?.trim().split("-");
  if (!parts || parts.length !== 3) return undefined;
  return { nav: Number(nav), date: `${parts[2]}-${parts[1]}-${parts[0]}`, source: "amfi" as const };
}

/** Fetch each scheme independently. Remote failures are deliberately ignored. */
export async function runPrices(db: Db = getDb()): Promise<{ updated: number }> {
  const open = await db.select().from(holdings).where(and(eq(holdings.isClosed, false), isNull(holdings.manualValue), sql`${holdings.schemeCode} is not null`));
  let updated = 0;
  for (const holding of open) try {
    const code = holding.schemeCode!;
    let value: { nav: number; date: string; source: "mfapi" | "amfi" } | undefined;
    const response = await timeoutFetch(`https://api.mfapi.in/mf/${encodeURIComponent(code)}/latest`);
    if (response.ok) {
      const body = await response.json() as { data?: { nav?: string; date?: string } };
      const raw = body.data;
      const parts = raw?.date?.split("-");
      if (raw?.nav && parts?.length === 3) value = { nav: Number(raw.nav), date: `${parts[2]}-${parts[1]}-${parts[0]}`, source: "mfapi" };
    }
    value ??= await amfiNav(code);
    if (!value || !Number.isFinite(value.nav)) continue;
    await db.insert(prices).values({ schemeCode: code, ...value }).onConflictDoUpdate({ target: [prices.schemeCode, prices.date], set: { nav: value.nav, source: value.source } });
    const missing = await db.select().from(holdingTxns).where(and(eq(holdingTxns.holdingId, holding.id), isNull(holdingTxns.units)));
    for (const txn of missing) {
      const nav = await nearestNav(db, code, txn.date);
      if (nav) await db.update(holdingTxns).set({ nav: nav.nav, units: txn.amount / nav.nav }).where(eq(holdingTxns.id, txn.id));
    }
    updated++;
  } catch { /* network failure leaves this holding stale */ }
  return { updated };
}
