import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb, type Db } from "../db/client.ts";
import { ruleMatches } from "../db/queries.ts";
import { recurringOccurrences, recurringSeries, transactionTrips, transactions, trips } from "../db/schema.ts";

const ymd = (date: string) => date.slice(0, 10);
const addDays = (date: string, days: number) => {
  const d = new Date(`${ymd(date)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
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
function cadenceDate(anchor: string, periods: number, s: typeof recurringSeries.$inferSelect) {
  if (s.cadence === "weekly") return addDays(anchor, periods * 7);
  const source = new Date(`${ymd(anchor)}T00:00:00Z`);
  const month = source.getUTCMonth() + periods * (s.cadence === "monthly" ? 1 : s.cadence === "quarterly" ? 3 : 12);
  const first = new Date(Date.UTC(source.getUTCFullYear(), month, 1));
  const day = s.usualDay ?? source.getUTCDate();
  first.setUTCDate(Math.min(day, new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()));
  return first.toISOString().slice(0, 10);
}
function nearestCadenceDate(date: string, s: typeof recurringSeries.$inferSelect, anchors: string[]) {
  const anchor = anchors.slice().sort()[0]!;
  const periods = s.cadence === "weekly"
    ? Math.round(days(date, anchor) / 7)
    : Math.round(((Number(date.slice(0, 4)) - Number(anchor.slice(0, 4))) * 12 + Number(date.slice(5, 7)) - Number(anchor.slice(5, 7))) / (s.cadence === "monthly" ? 1 : s.cadence === "quarterly" ? 3 : 12));
  const candidates = [-1, 0, 1].map((offset) => cadenceDate(anchor, periods + offset, s));
  return candidates.sort((a, b) => Math.abs(days(date, a)) - Math.abs(days(date, b)))[0]!;
}
/** The due date a payment settles: an open occurrence near it, else the nearest date on the anchored cadence. */
function dueFor(date: string, s: typeof recurringSeries.$inferSelect, open: string[], anchors: string[]) {
  const near = open.filter((due) => Math.abs(days(date, due)) <= GRACE).sort((a, b) => Math.abs(days(date, a)) - Math.abs(days(date, b)))[0];
  if (near) return near;
  if (!anchors.length) return s.cadence !== "weekly" && s.usualDay ? nearestCadenceDate(date, s, [`${date.slice(0, 7)}-01`]) : date;
  const due = nearestCadenceDate(date, s, anchors);
  return Math.abs(days(date, due)) <= GRACE ? due : null;
}

/** recurring (§8): match payments, mark missed dues past_due, keep one next upcoming occurrence per active series. */
export async function matchRecurring(txnIds: number[], db: Db = getDb(), onlySeriesId?: number): Promise<void> {
  const series = await db.select().from(recurringSeries).where(onlySeriesId === undefined
    ? eq(recurringSeries.status, "active")
    : and(eq(recurringSeries.status, "active"), eq(recurringSeries.id, onlySeriesId)));
  const rows = txnIds.length ? await db.select().from(transactions).where(inArray(transactions.id, txnIds)) : [];
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  for (const s of series) {
    const occurrences = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, s.id));
    const open = occurrences.filter((o) => !o.transactionId).map((o) => o.dueDate);
    const anchors = occurrences.map((o) => o.dueDate);
    for (const row of rows) {
      if (row.deletedAt || row.excluded || row.duplicateOf || row.type === "income" || !ruleMatches(s, row.merchant)) continue;
      if (Math.abs(row.amount - s.expectedAmount) > s.expectedAmount * (s.tolerancePct / 100)) continue;
      const due = occurrences.find((o) => o.transactionId === row.id)?.dueDate ?? dueFor(ymd(row.date), s, open, anchors);
      if (!due) continue;
      if (Math.abs(days(ymd(row.date), due)) > GRACE) continue;
      const status = ymd(row.date) <= due ? "cleared" : "cleared_late";
      await db.insert(recurringOccurrences).values({ seriesId: s.id, dueDate: due, transactionId: row.id, status }).onConflictDoUpdate({
        target: [recurringOccurrences.seriesId, recurringOccurrences.dueDate], set: { transactionId: row.id, status },
        where: or(isNull(recurringOccurrences.transactionId), eq(recurringOccurrences.transactionId, row.id)),
      });
      if (!anchors.includes(due)) anchors.push(due);
      const openIndex = open.indexOf(due);
      if (openIndex !== -1) open.splice(openIndex, 1);
    }
    const paid = await db.select({ due: recurringOccurrences.dueDate }).from(recurringOccurrences).innerJoin(transactions, eq(recurringOccurrences.transactionId, transactions.id)).where(and(eq(recurringOccurrences.seriesId, s.id), isNull(transactions.deletedAt))).orderBy(sql`${recurringOccurrences.dueDate} desc`).limit(1);
    const anchorDay = s.usualDay ?? (anchors.length ? new Date(`${anchors.slice().sort()[0]}T00:00:00Z`).getUTCDate() : null);
    // First due: continue persisted cadence anchor, else this month's usual day (or today).
    let next = paid[0]
      ? nextDue(paid[0].due, s.cadence, anchorDay)
      : anchors.length
        ? open.slice().sort()[0] ?? nearestCadenceDate(today, s, anchors)
        : s.cadence !== "weekly" && s.usualDay
          ? cadenceDate(`${today.slice(0, 7)}-01`, 0, s)
          : today;
    if (!paid[0] && !anchors.length && days(today, next) > GRACE) next = nextDue(next, s.cadence, anchorDay);
    while (days(today, next) > GRACE) {
      await db.insert(recurringOccurrences).values({ seriesId: s.id, dueDate: next, transactionId: null, status: "past_due" }).onConflictDoUpdate({
        target: [recurringOccurrences.seriesId, recurringOccurrences.dueDate], set: { status: "past_due" }, where: isNull(recurringOccurrences.transactionId),
      });
      next = nextDue(next, s.cadence, anchorDay);
    }
    // One upcoming row: drop stale ones left by edits to cadence or usual day.
    await db.delete(recurringOccurrences).where(and(eq(recurringOccurrences.seriesId, s.id), eq(recurringOccurrences.status, "upcoming"), ne(recurringOccurrences.dueDate, next)));
    await db.insert(recurringOccurrences).values({ seriesId: s.id, dueDate: next, transactionId: null, status: "upcoming" }).onConflictDoUpdate({
      target: [recurringOccurrences.seriesId, recurringOccurrences.dueDate], set: { status: "upcoming" }, where: isNull(recurringOccurrences.transactionId),
    });
  }
}

/** Run after a series is saved: match its past year of payments and schedule its next due date. */
export async function scheduleSeries(seriesId: number, db: Db = getDb()): Promise<void> {
  const s = await db.select().from(recurringSeries).where(eq(recurringSeries.id, seriesId)).get();
  if (!s) return;
  await db.delete(recurringOccurrences).where(and(eq(recurringOccurrences.seriesId, seriesId), isNull(recurringOccurrences.transactionId)));
  const year = await db.select({ id: transactions.id, merchant: transactions.merchant }).from(transactions).where(and(isNull(transactions.deletedAt), sql`${transactions.date} >= date('now', '-13 months')`));
  await matchRecurring(year.filter((row) => ruleMatches(s, row.merchant)).map((row) => row.id), db, seriesId);
}
