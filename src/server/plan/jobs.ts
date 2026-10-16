import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type Db } from "../db/client.ts";
import { ruleMatches } from "../db/queries.ts";
import { recurringOccurrences, recurringSeries, transactionTrips, transactions, trips } from "../db/schema.ts";

const ymd = (date: string) => date.slice(0, 10);
const addDays = (date: string, days: number) => {
  const d = new Date(`${ymd(date)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const addMonths = (date: string, months: number) => {
  const d = new Date(`${ymd(date)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

export function nextDue(date: string, cadence: "monthly" | "quarterly" | "yearly" | "weekly", usualDay?: number | null) {
  if (cadence === "weekly") return addDays(date, 7);
  const current = new Date(`${ymd(date)}T00:00:00Z`);
  const day = usualDay ?? current.getUTCDate();
  const d = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + (cadence === "monthly" ? 1 : cadence === "quarterly" ? 3 : 12), 1));
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
}

/** trip-tag (§8): tag rows inside an active trip window. */
export async function tagTrips(txnIds: number[], db: Db = getDb()): Promise<void> {
  if (!txnIds.length) return;
  const [rows, active, series] = await Promise.all([
    db.select().from(transactions).where(inArray(transactions.id, txnIds)),
    db.select().from(trips).where(isNull(trips.endedAt)),
    db.select().from(recurringSeries).where(eq(recurringSeries.status, "active")),
  ]);
  for (const row of rows) {
    if (row.excluded || row.type === "investment" || /\b(transfer|upi.*self|self.*upi)\b/i.test(row.merchant)) continue;
    if (series.some((s) => ruleMatches(s, row.merchant))) continue;
    for (const trip of active)
      if (ymd(row.date) >= trip.startDate && ymd(row.date) <= trip.endDate)
        await db.insert(transactionTrips).values({ transactionId: row.id, tripId: trip.id, source: "auto", inDailyBudget: true }).onConflictDoNothing();
  }
}

/** recurring (§8): match a payment, retain one next upcoming occurrence per active series. */
export async function matchRecurring(txnIds: number[], db: Db = getDb()): Promise<void> {
  const series = await db.select().from(recurringSeries).where(eq(recurringSeries.status, "active"));
  const rows = txnIds.length ? await db.select().from(transactions).where(inArray(transactions.id, txnIds)) : [];
  for (const s of series) {
    for (const row of rows) {
      if (row.excluded || row.type === "income" || !ruleMatches(s, row.merchant)) continue;
      const tolerance = s.expectedAmount * (s.tolerancePct / 100);
      if (Math.abs(row.amount - s.expectedAmount) > tolerance) continue;
      const due = nextDue(addMonths(ymd(row.date), -1), s.cadence, s.usualDay);
      if (Math.abs(new Date(`${due}T00:00:00Z`).getTime() - new Date(`${ymd(row.date)}T00:00:00Z`).getTime()) > 3 * 864e5) continue;
      const status = ymd(row.date) === due ? "cleared" : "cleared_late";
      await db.insert(recurringOccurrences).values({ seriesId: s.id, dueDate: due, transactionId: row.id, status }).onConflictDoUpdate({
        target: [recurringOccurrences.seriesId, recurringOccurrences.dueDate], set: { transactionId: row.id, status },
      });
    }
    const paid = await db.select({ date: transactions.date }).from(recurringOccurrences).innerJoin(transactions, eq(recurringOccurrences.transactionId, transactions.id)).where(and(eq(recurringOccurrences.seriesId, s.id), isNull(transactions.deletedAt))).orderBy(sql`${transactions.date} desc`).limit(1);
    const due = nextDue(paid[0]?.date ?? new Date().toISOString().slice(0, 10), s.cadence, s.usualDay);
    await db.insert(recurringOccurrences).values({ seriesId: s.id, dueDate: due, transactionId: null, status: "upcoming" }).onConflictDoNothing();
  }
}
