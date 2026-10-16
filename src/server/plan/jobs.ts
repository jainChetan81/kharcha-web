import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
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

/** trip-tag (§8): tag spend inside an active trip window, honouring each trip's autoTag and skipRecurring. */
export async function tagTrips(txnIds: number[], db: Db = getDb()): Promise<void> {
  if (!txnIds.length) return;
  const [rows, active, series] = await Promise.all([
    db.select().from(transactions).where(inArray(transactions.id, txnIds)),
    db.select().from(trips).where(and(isNull(trips.endedAt), eq(trips.autoTag, true))),
    db.select().from(recurringSeries).where(eq(recurringSeries.status, "active")),
  ]);
  for (const row of rows) {
    if (row.deletedAt || row.excluded || row.duplicateOf || row.type !== "expense" || /\b(transfer|upi.*self|self.*upi)\b/i.test(row.merchant)) continue;
    const recurring = series.some((s) => ruleMatches(s, row.merchant));
    for (const trip of active)
      if (!(recurring && trip.skipRecurring) && ymd(row.date) >= trip.startDate && ymd(row.date) <= trip.endDate)
        await db.insert(transactionTrips).values({ transactionId: row.id, tripId: trip.id, source: "auto", inDailyBudget: true }).onConflictDoNothing();
  }
}

const days = (a: string, b: string) => (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5;
const GRACE = 5;
/** The due date a payment settles: an open occurrence near it, else the nearest usual day around it. */
function dueFor(date: string, s: typeof recurringSeries.$inferSelect, open: string[]) {
  const near = open.filter((due) => Math.abs(days(date, due)) <= GRACE).sort((a, b) => Math.abs(days(date, a)) - Math.abs(days(date, b)))[0];
  if (near || s.cadence === "weekly" || !s.usualDay) return near ?? date;
  return [-1, 0, 1].map((shift) => nextDue(addMonths(`${date.slice(0, 7)}-01`, shift - 1), "monthly", s.usualDay)).sort((a, b) => Math.abs(days(date, a)) - Math.abs(days(date, b)))[0]!;
}

/** recurring (§8): match payments, mark missed dues past_due, keep one next upcoming occurrence per active series. */
export async function matchRecurring(txnIds: number[], db: Db = getDb()): Promise<void> {
  const series = await db.select().from(recurringSeries).where(eq(recurringSeries.status, "active"));
  const rows = txnIds.length ? await db.select().from(transactions).where(inArray(transactions.id, txnIds)) : [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  for (const s of series) {
    const occurrences = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, s.id));
    const open = occurrences.filter((o) => !o.transactionId).map((o) => o.dueDate);
    for (const row of rows) {
      if (row.deletedAt || row.excluded || row.duplicateOf || row.type === "income" || !ruleMatches(s, row.merchant)) continue;
      if (Math.abs(row.amount - s.expectedAmount) > s.expectedAmount * (s.tolerancePct / 100)) continue;
      const due = dueFor(ymd(row.date), s, open);
      if (Math.abs(days(ymd(row.date), due)) > GRACE) continue;
      const status = ymd(row.date) <= due ? "cleared" : "cleared_late";
      await db.insert(recurringOccurrences).values({ seriesId: s.id, dueDate: due, transactionId: row.id, status }).onConflictDoUpdate({
        target: [recurringOccurrences.seriesId, recurringOccurrences.dueDate], set: { transactionId: row.id, status },
      });
    }
    const paid = await db.select({ due: recurringOccurrences.dueDate }).from(recurringOccurrences).innerJoin(transactions, eq(recurringOccurrences.transactionId, transactions.id)).where(and(eq(recurringOccurrences.seriesId, s.id), isNull(transactions.deletedAt))).orderBy(sql`${recurringOccurrences.dueDate} desc`).limit(1);
    // First due: the last paid one stepped forward, else this period's usual day (or today when there is none).
    let next = paid[0] ? nextDue(paid[0].due, s.cadence, s.usualDay) : s.usualDay && s.cadence !== "weekly" ? nextDue(addMonths(`${today.slice(0, 7)}-01`, -1), "monthly", s.usualDay) : today;
    if (!paid[0] && days(today, next) > GRACE) next = nextDue(next, s.cadence, s.usualDay);
    for (let i = 0; i < 24 && days(today, next) > GRACE; i++) {
      await db.insert(recurringOccurrences).values({ seriesId: s.id, dueDate: next, transactionId: null, status: "past_due" }).onConflictDoUpdate({
        target: [recurringOccurrences.seriesId, recurringOccurrences.dueDate], set: { status: "past_due" }, where: isNull(recurringOccurrences.transactionId),
      });
      next = nextDue(next, s.cadence, s.usualDay);
    }
    // One upcoming row: drop stale ones left by edits to cadence or usual day.
    await db.delete(recurringOccurrences).where(and(eq(recurringOccurrences.seriesId, s.id), eq(recurringOccurrences.status, "upcoming"), ne(recurringOccurrences.dueDate, next)));
    await db.insert(recurringOccurrences).values({ seriesId: s.id, dueDate: next, transactionId: null, status: "upcoming" }).onConflictDoNothing();
  }
}

/** Run after a series is saved: match its past year of payments and schedule its next due date. */
export async function scheduleSeries(seriesId: number, db: Db = getDb()): Promise<void> {
  const s = await db.select().from(recurringSeries).where(eq(recurringSeries.id, seriesId)).get();
  if (!s) return;
  await db.delete(recurringOccurrences).where(and(eq(recurringOccurrences.seriesId, seriesId), isNull(recurringOccurrences.transactionId)));
  const year = await db.select({ id: transactions.id, merchant: transactions.merchant }).from(transactions).where(and(isNull(transactions.deletedAt), sql`${transactions.date} >= date('now', '-13 months')`));
  await matchRecurring(year.filter((row) => ruleMatches(s, row.merchant)).map((row) => row.id), db);
}
