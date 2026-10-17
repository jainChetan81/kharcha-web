import { createServerFn } from "@tanstack/react-start";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { holdingCsvRows } from "../../lib/csv.ts";
import { getDb } from "../db/client.ts";
import { holdingTxns, holdings, prices, sipMandates } from "../db/schema.ts";
import { realDay, xirr } from "./xirr.ts";

export type WealthSummary = {
  value: number; dayChange: number; navDate: string | null; asOf: string | null; spark: number[];
  holdings: number;
  /** Gain over holdings with a real cost basis only; null when none (manualValue fallback is not a basis). */
  invested: number | null; gain: number | null; gainPct: number | null;
  xirr: number | null;
  allocation: { name: string; value: number; pct: number }[];
  nextSip: { amount: number; date: string } | null;
};
const id = z.object({ id: z.number().int().positive() });
const holdingSchema = z.object({
  id: z.number().int().positive().optional(), name: z.string().trim().min(1).max(120), kind: z.enum(["fund", "gold", "nps", "other"]), assetClass: z.string().trim().min(1).max(80), schemeCode: z.string().trim().max(30).nullable(),
  targetPct: z.number().finite().min(0).max(100).nullable(), manualValue: z.number().finite().min(0).max(1e10).nullable(), manualValueDate: z.string().refine(realDay).nullable(), sipAmount: z.number().finite().positive().max(1e8).nullable(), sipDay: z.number().int().min(1).max(31).nullable(), smsMatch: z.string().trim().max(120).nullable(),
});

async function latestPrices() {
  return getDb().all<{ scheme_code: string; date: string; nav: number; prev: number | null; prev_date: string | null }>(sql`select p.scheme_code, p.date, p.nav, (select nav from prices q where q.scheme_code=p.scheme_code and q.date<p.date order by q.date desc limit 1) prev, (select date from prices q where q.scheme_code=p.scheme_code and q.date<p.date order by q.date desc limit 1) prev_date from prices p join (select scheme_code, max(date) date from prices group by scheme_code) last on p.scheme_code=last.scheme_code and p.date=last.date`);
}
export function navDayChange(txns: { date: string; units: number | null }[], previousDate: string | null, nav: number, previousNav: number | null) {
  if (!previousDate || previousNav == null) return 0;
  const previousUnits = txns.reduce((sum, txn) => sum + (txn.date <= previousDate ? (txn.units ?? 0) : 0), 0);
  return previousUnits * (nav - previousNav);
}
export function isNotFutureDateInIST(date: string, now = new Date()) {
  return date <= new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
// ponytail: invested-over-time with today's value as the final point; past values need per-date NAV, add when price history covers every holding.
function investedSeries(txns: { date: string; amount: number }[], value: number) {
  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date)); let sum = 0;
  const series = sorted.map((txn) => (sum += txn.amount));
  return series.length ? [...series, value] : [];
}
/** Latest statement date among manual values: the "as of" label when there is no NAV. */
export const snapshotDate = (rows: { manualValue: number | null; manualValueDate: string | null }[]) =>
  rows.filter((row) => row.manualValue != null && row.manualValueDate).map((row) => row.manualValueDate!).sort().at(-1) ?? null;

async function holdingsWithValue() {
  const db = getDb(); const [all, buys, latest] = await Promise.all([db.select().from(holdings).where(eq(holdings.isClosed, false)), db.select().from(holdingTxns), latestPrices()]);
  const nav = new Map(latest.map((row) => [row.scheme_code, row]));
  return all.map((holding) => valueHolding(holding, buys.filter((txn) => txn.holdingId === holding.id), holding.schemeCode ? nav.get(holding.schemeCode) : undefined));
}

type Price = { date: string; nav: number; prev: number | null; prev_date: string | null };
type Txn = { date: string; amount: number; units: number | null };
type Valued = { manualValue: number | null; manualInvested: number | null };
export function valueHolding<H extends Valued, T extends Txn>(holding: H, txns: T[], price: Price | undefined) {
  const units = txns.reduce((sum, txn) => sum + (txn.units ?? 0), 0);
  // No buy history: use the statement cost basis, else the value itself (gain unknown, shown as zero).
  const invested = txns.length ? txns.reduce((sum, txn) => sum + txn.amount, 0) : (holding.manualInvested ?? holding.manualValue ?? 0);
  const value = holding.manualValue ?? (price ? units * Number(price.nav) : invested);
  // Day change: units times the move since the previous NAV. Manual values have no daily price.
  const dayChange = holding.manualValue == null && price ? navDayChange(txns, price.prev_date, Number(price.nav), price.prev == null ? null : Number(price.prev)) : 0;
  return { ...holding, txns, units, invested, price, value, gain: value - invested, dayChange };
}

/** Cashflows for XIRR: buys/sells as outflows/inflows, plus today's value of traded holdings. Snapshot-only holdings have no dated cost, so their value stays out. */
function wealthFlows(rows: { txns: { date: string; amount: number }[]; value: number }[]) {
  const flows = rows.flatMap((row) => row.txns.map((txn) => ({ date: txn.date, amount: -txn.amount })));
  const traded = rows.filter((row) => row.txns.length).reduce((sum, row) => sum + row.value, 0); if (traded) flows.push({ date: new Date().toISOString().slice(0, 10), amount: traded });
  return flows;
}
/** Next occurrence of a SIP day-of-month on or after today in IST, clamped to month end (day 31 in Feb gives 28/29). */
export function nextSipDate(day: number, now = new Date()) {
  const today = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const [y, m] = today.split("-").map(Number) as [number, number, number];
  const onMonth = (year: number, monthIndex: number) => {
    const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, monthIndex, Math.min(day, last))).toISOString().slice(0, 10);
  };
  const thisMonth = onMonth(y, m - 1);
  return thisMonth >= today ? thisMonth : onMonth(y, m);
}

/** CONTRACT (used by Today): value, day change, NAV/statement dates, sparkline, gain, XIRR, allocation, next SIP. */
export const getWealthSummary = createServerFn({ method: "GET" }).handler(async (): Promise<WealthSummary | null> => {
  const [rows, mandates] = await Promise.all([holdingsWithValue(), getDb().select().from(sipMandates)]); if (!rows.length) return null;
  const value = rows.reduce((sum, row) => sum + row.value, 0); const dates = rows.map((row) => row.price?.date).filter(Boolean) as string[];
  const based = rows.filter((row) => row.txns.length || row.manualInvested != null);
  const invested = based.length ? based.reduce((sum, row) => sum + row.invested, 0) : null;
  const gain = invested == null ? null : based.reduce((sum, row) => sum + row.value, 0) - invested;
  const byClass = new Map<string, number>(); for (const row of rows) byClass.set(row.assetClass, (byClass.get(row.assetClass) ?? 0) + row.value);
  const allocation = [...byClass].map(([name, classValue]) => ({ name, value: classValue, pct: value ? (classValue / value) * 100 : 0 })).sort((a, b) => b.value - a.value);
  const active = new Set(rows.map((row) => row.id));
  const nextSip = mandates.filter((row) => active.has(row.holdingId)).map((row) => ({ amount: row.amount, date: nextSipDate(row.day) })).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  return {
    value, dayChange: rows.reduce((sum, row) => sum + row.dayChange, 0), navDate: dates.sort().at(-1) ?? null, asOf: snapshotDate(rows), spark: investedSeries(rows.flatMap((row) => row.txns), value),
    holdings: rows.length, invested, gain, gainPct: invested && invested > 0 ? (gain! / invested) * 100 : null, xirr: xirr(wealthFlows(rows)), allocation, nextSip,
  };
});

export const getWealth = createServerFn({ method: "GET" }).handler(async () => {
  const [rows, mandates] = await Promise.all([holdingsWithValue(), getDb().select().from(sipMandates).orderBy(asc(sipMandates.day))]);
  const names = new Map(rows.map((row) => [row.id, row.name]));
  const sips = mandates.filter((row) => names.has(row.holdingId)).map((row) => ({ ...row, name: names.get(row.holdingId)! })); const value = rows.reduce((sum, row) => sum + row.value, 0); const invested = rows.reduce((sum, row) => sum + row.invested, 0);
  const dates = rows.map((row) => row.price?.date).filter(Boolean) as string[];
  const flows = wealthFlows(rows); // Snapshot-only holdings have no dated cost, so their value stays out of XIRR.
  const allocation = Object.values(rows.reduce<Record<string, { value: number; target: number; hasTarget: boolean; name: string }>>((map, row) => { const item = map[row.assetClass] ?? { name: row.assetClass, value: 0, target: 0, hasTarget: false }; item.value += row.value; item.target += row.targetPct ?? 0; item.hasTarget ||= row.targetPct != null; map[row.assetClass] = item; return map; }, {}));
  const financialYear = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const nps = rows.filter((row) => row.kind === "nps").flatMap((row) => row.txns).filter((txn) => txn.date >= `${financialYear}-04-01`).reduce((sum, txn) => sum + txn.amount, 0);
  return { rows, value, dayChange: rows.reduce((sum, row) => sum + row.dayChange, 0), invested, gain: value - invested, xirr: xirr(flows), navDate: dates.sort().at(-1) ?? null, asOf: snapshotDate(rows), sips, allocation, nps, financialYear, spark: investedSeries(rows.flatMap((row) => row.txns), value) };
});

export const getHolding = createServerFn({ method: "GET" }).validator(id).handler(async ({ data }) => {
  const rows = await holdingsWithValue(); const holding = rows.find((row) => row.id === data.id); if (!holding) return null;
  const history = holding.schemeCode ? await getDb().select().from(prices).where(eq(prices.schemeCode, holding.schemeCode)).orderBy(asc(prices.date)) : [];
  const flows = holding.txns.map((txn) => ({ date: txn.date, amount: -txn.amount })); if (holding.value) flows.push({ date: new Date().toISOString().slice(0, 10), amount: holding.value });
  const sips = await getDb().select().from(sipMandates).where(eq(sipMandates.holdingId, holding.id)).orderBy(asc(sipMandates.day));
  return { ...holding, history, sips, xirr: xirr(flows) };
});

export const saveHolding = createServerFn({ method: "POST" }).validator(holdingSchema).handler(async ({ data }) => {
  const db = getDb(); const { id: holdingId, ...values } = data;
  if (holdingId) { await db.update(holdings).set(values).where(eq(holdings.id, holdingId)); return holdingId; }
  const [row] = await db.insert(holdings).values(values).returning({ id: holdings.id }); return row!.id;
});
export const closeHolding = createServerFn({ method: "POST" }).validator(id).handler(async ({ data }) => { await getDb().update(holdings).set({ isClosed: true }).where(eq(holdings.id, data.id)); });

export const searchFund = createServerFn({ method: "GET" }).validator(z.object({ query: z.string().trim().min(2).max(120) })).handler(async ({ data }) => {
  try { const response = await fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(data.query)}`, { signal: AbortSignal.timeout(10_000) }); if (!response.ok) return []; const rows = await response.json() as { schemeCode: string | number; schemeName: string }[]; return rows.slice(0, 10).map((row) => ({ code: String(row.schemeCode), name: row.schemeName })); } catch { return []; }
});

const csvRow = z.object({ date: z.string().refine(realDay, "not a real date").refine((d) => isNotFutureDateInIST(d), "future date"), fund: z.string().trim().min(1), amount: z.coerce.number().refine((n) => n !== 0), units: z.coerce.number().refine((n) => n !== 0), nav: z.coerce.number().positive() }).refine((row) => Math.sign(row.amount) === Math.sign(row.units)); // negative amount + units = redemption
export const importHoldingCsv = createServerFn({ method: "POST" }).validator(z.object({ csv: z.string().max(1_000_000) })).handler(async ({ data }) => {
  const values = holdingCsvRows(data.csv); const db = getDb(); const all = await db.select().from(holdings); const seen = new Set((await db.select().from(holdingTxns)).map((row) => `${row.holdingId}|${row.date}|${row.amount}|${row.units}`)); let imported = 0; let errors = 0; let skipped = 0;
  for (const [date, fund, amount, units, nav] of values) { const parsed = csvRow.safeParse({ date, fund, amount, units, nav }); const holding = parsed.success ? all.find((row) => row.name.toLowerCase() === parsed.data.fund.toLowerCase()) : undefined; if (!parsed.success || !holding) { errors++; continue; } const key = `${holding.id}|${parsed.data.date}|${parsed.data.amount}|${parsed.data.units}`; if (seen.has(key)) { skipped++; continue; } seen.add(key); await db.insert(holdingTxns).values({ holdingId: holding.id, date: parsed.data.date, amount: parsed.data.amount, units: parsed.data.units, nav: parsed.data.nav, source: "csv" }); imported++; }
  return { imported, errors, skipped };
});
