import { createServerFn } from "@tanstack/react-start";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { holdingCsvRows } from "../../lib/csv";
import { getDb } from "../db/client";
import { holdingTxns, holdings, prices } from "../db/schema";
import { realDay, xirr } from "./xirr";

export type WealthSummary = { value: number; dayChange: number; navDate: string | null; spark: number[] };
const id = z.object({ id: z.number().int().positive() });
const holdingSchema = z.object({
  id: z.number().int().positive().optional(), name: z.string().trim().min(1).max(120), kind: z.enum(["fund", "gold", "nps", "other"]), assetClass: z.string().trim().min(1).max(80), schemeCode: z.string().trim().max(30).nullable(),
  targetPct: z.number().min(0).max(100).nullable(), manualValue: z.number().min(0).max(1e10).nullable(), manualValueDate: z.string().refine(realDay).nullable(), sipAmount: z.number().positive().max(1e8).nullable(), sipDay: z.number().int().min(1).max(31).nullable(), smsMatch: z.string().trim().max(120).nullable(),
});

async function latestPrices() {
  return getDb().all<{ scheme_code: string; date: string; nav: number; prev: number | null }>(sql`select p.scheme_code, p.date, p.nav, (select nav from prices q where q.scheme_code=p.scheme_code and q.date<p.date order by q.date desc limit 1) prev from prices p join (select scheme_code, max(date) date from prices group by scheme_code) last on p.scheme_code=last.scheme_code and p.date=last.date`);
}
// ponytail: invested-over-time with today's value as the final point; past values need per-date NAV, add when price history covers every holding.
function investedSeries(txns: { date: string; amount: number }[], value: number) {
  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date)); let sum = 0;
  const series = sorted.map((txn) => (sum += txn.amount));
  return series.length ? [...series, value] : [];
}
async function holdingsWithValue() {
  const db = getDb(); const [all, buys, latest] = await Promise.all([db.select().from(holdings).where(eq(holdings.isClosed, false)), db.select().from(holdingTxns), latestPrices()]);
  const nav = new Map(latest.map((row) => [row.scheme_code, row]));
  return all.map((holding) => {
    const txns = buys.filter((txn) => txn.holdingId === holding.id); const units = txns.reduce((sum, txn) => sum + (txn.units ?? 0), 0); const invested = txns.reduce((sum, txn) => sum + txn.amount, 0); const price = holding.schemeCode ? nav.get(holding.schemeCode) : undefined;
    const value = holding.manualValue ?? (price ? units * Number(price.nav) : invested);
    // Day change: units times the move since the previous NAV. Manual values have no daily price.
    const dayChange = holding.manualValue == null && price?.prev ? units * (Number(price.nav) - Number(price.prev)) : 0;
    return { ...holding, txns, units, invested, price, value, gain: value - invested, dayChange };
  });
}

/** CONTRACT (used by Today): portfolio value, day change, NAV date, ~30-point sparkline. */
export const getWealthSummary = createServerFn({ method: "GET" }).handler(async (): Promise<WealthSummary | null> => {
  const rows = await holdingsWithValue(); if (!rows.length) return null;
  const value = rows.reduce((sum, row) => sum + row.value, 0); const dates = rows.map((row) => row.price?.date).filter(Boolean) as string[];
  return { value, dayChange: rows.reduce((sum, row) => sum + row.dayChange, 0), navDate: dates.sort().at(-1) ?? null, spark: investedSeries(rows.flatMap((row) => row.txns), value) };
});

export const getWealth = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await holdingsWithValue(); const value = rows.reduce((sum, row) => sum + row.value, 0); const invested = rows.reduce((sum, row) => sum + row.invested, 0);
  const dates = rows.map((row) => row.price?.date).filter(Boolean) as string[];
  const flows = rows.flatMap((row) => row.txns.map((txn) => ({ date: txn.date, amount: -txn.amount }))); if (value) flows.push({ date: new Date().toISOString().slice(0, 10), amount: value });
  const allocation = Object.values(rows.reduce<Record<string, { value: number; target: number; name: string }>>((map, row) => { const item = map[row.assetClass] ?? { name: row.assetClass, value: 0, target: 0 }; item.value += row.value; item.target += row.targetPct ?? 0; map[row.assetClass] = item; return map; }, {}));
  const financialYear = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const nps = rows.filter((row) => row.kind === "nps").flatMap((row) => row.txns).filter((txn) => txn.date >= `${financialYear}-04-01`).reduce((sum, txn) => sum + txn.amount, 0);
  return { rows, value, invested, gain: value - invested, xirr: xirr(flows), navDate: dates.sort().at(-1) ?? null, allocation, nps, financialYear, spark: investedSeries(rows.flatMap((row) => row.txns), value) };
});

export const getHolding = createServerFn({ method: "GET" }).validator(id).handler(async ({ data }) => {
  const rows = await holdingsWithValue(); const holding = rows.find((row) => row.id === data.id); if (!holding) return null;
  const history = holding.schemeCode ? await getDb().select().from(prices).where(eq(prices.schemeCode, holding.schemeCode)).orderBy(asc(prices.date)) : [];
  const flows = holding.txns.map((txn) => ({ date: txn.date, amount: -txn.amount })); if (holding.value) flows.push({ date: new Date().toISOString().slice(0, 10), amount: holding.value });
  return { ...holding, history, xirr: xirr(flows) };
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

const csvRow = z.object({ date: z.string().refine(realDay, "not a real date").refine((d) => d <= new Date().toISOString().slice(0, 10), "future date"), fund: z.string().trim().min(1), amount: z.coerce.number().refine((n) => n !== 0), units: z.coerce.number().refine((n) => n !== 0), nav: z.coerce.number().positive() }).refine((row) => Math.sign(row.amount) === Math.sign(row.units)); // negative amount + units = redemption
export const importHoldingCsv = createServerFn({ method: "POST" }).validator(z.object({ csv: z.string().max(1_000_000) })).handler(async ({ data }) => {
  const values = holdingCsvRows(data.csv); const db = getDb(); const all = await db.select().from(holdings); const seen = new Set((await db.select().from(holdingTxns)).map((row) => `${row.holdingId}|${row.date}|${row.amount}|${row.units}`)); let imported = 0; let errors = 0; let skipped = 0;
  for (const [date, fund, amount, units, nav] of values) { const parsed = csvRow.safeParse({ date, fund, amount, units, nav }); const holding = parsed.success ? all.find((row) => row.name.toLowerCase() === parsed.data.fund.toLowerCase()) : undefined; if (!parsed.success || !holding) { errors++; continue; } const key = `${holding.id}|${parsed.data.date}|${parsed.data.amount}|${parsed.data.units}`; if (seen.has(key)) { skipped++; continue; } seen.add(key); await db.insert(holdingTxns).values({ holdingId: holding.id, date: parsed.data.date, amount: parsed.data.amount, units: parsed.data.units, nav: parsed.data.nav, source: "csv" }); imported++; }
  return { imported, errors, skipped };
});
