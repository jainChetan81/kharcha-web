import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { monthBounds, monthSchema, spendByCategory } from "../db/queries";
import { categories, recurringOccurrences, recurringSeries, transactionTrips, transactions, trips } from "../db/schema";

export type UpcomingPayment = { seriesId: number; date: string; name: string; amount: number; kind: string };
const today = () => new Date().toISOString().slice(0, 10);
const id = z.object({ id: z.number().int().positive() });
const seriesSchema = z.object({
  id: z.number().int().positive().optional(), name: z.string().trim().min(1).max(80), kind: z.enum(["subscription", "bill", "sip", "emi", "insurance"]),
  match: z.string().trim().min(2).max(120), cadence: z.enum(["monthly", "quarterly", "yearly", "weekly"]), usualDay: z.number().int().min(1).max(31).nullable(),
  expectedAmount: z.number().positive().max(1e8), tolerancePct: z.number().min(0).max(100), status: z.enum(["active", "paused"]),
});
const tripSchema = z.object({
  id: z.number().int().positive().optional(), name: z.string().trim().min(1).max(80), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  budget: z.number().min(0).max(1e8), autoTag: z.boolean(), skipRecurring: z.boolean(), bookings: z.array(z.number().int().positive()).max(100).default([]),
}).refine((value) => value.endDate >= value.startDate, { message: "End date must follow start date." });

/** CONTRACT (used by Today): recurring payments due in next days, soonest first. */
export const getUpcoming = createServerFn({ method: "GET" }).validator(z.object({ days: z.number().int().min(1).max(60) })).handler(async ({ data }): Promise<UpcomingPayment[]> => {
  const until = new Date(Date.now() + data.days * 864e5).toISOString().slice(0, 10);
  const rows = await getDb().select({ seriesId: recurringOccurrences.seriesId, date: recurringOccurrences.dueDate, name: recurringSeries.name, amount: recurringSeries.expectedAmount, kind: recurringSeries.kind })
    .from(recurringOccurrences).innerJoin(recurringSeries, eq(recurringOccurrences.seriesId, recurringSeries.id))
    .where(and(eq(recurringOccurrences.status, "upcoming"), gte(recurringOccurrences.dueDate, today()), lte(recurringOccurrences.dueDate, until), eq(recurringSeries.status, "active"))).orderBy(asc(recurringOccurrences.dueDate));
  return rows;
});

export const getPlanBudgets = createServerFn({ method: "GET" }).validator(z.object({ month: monthSchema })).handler(async ({ data }) => {
  const db = getDb(); const [from, to] = monthBounds(data.month);
  const [spend, limits, cats] = await Promise.all([spendByCategory(db, from, to), db.query.budgets.findMany(), db.select().from(categories).where(eq(categories.type, "expense")).orderBy(categories.sortOrder)]);
  const byName = new Map(spend.map((row) => [row.category, row.total])); const limitOf = new Map(limits.map((row) => [row.category, row.monthlyLimit]));
  return cats.filter((cat) => cat.name !== "Other").map((cat) => ({ ...cat, spent: byName.get(cat.name) ?? 0, limit: limitOf.get(cat.name) ?? null })).concat(
    limitOf.size ? [] : [],
  );
});

export const getRecurring = createServerFn({ method: "GET" }).validator(z.object({ month: monthSchema })).handler(async ({ data }) => {
  const db = getDb(); const [from, to] = monthBounds(data.month);
  const [series, occurrences, detector] = await Promise.all([
    db.select().from(recurringSeries).orderBy(asc(recurringSeries.name)),
    db.select({ seriesId: recurringOccurrences.seriesId, dueDate: recurringOccurrences.dueDate, status: recurringOccurrences.status, transactionId: recurringOccurrences.transactionId }).from(recurringOccurrences).where(and(gte(recurringOccurrences.dueDate, from), lte(recurringOccurrences.dueDate, to))),
    db.all<{ payload_json: string }>(sql`select payload_json from insights where detector = 'new_recurring' and dismissed_at is null limit 1`),
  ]);
  return { series, occurrences, suggestion: detector[0]?.payload_json ?? null };
});

export const getSeries = createServerFn({ method: "GET" }).validator(id).handler(async ({ data }) => {
  const db = getDb(); const series = await db.select().from(recurringSeries).where(eq(recurringSeries.id, data.id)).get();
  if (!series) return null;
  const [occurrences, matching] = await Promise.all([
    db.select({ dueDate: recurringOccurrences.dueDate, status: recurringOccurrences.status, transactionId: recurringOccurrences.transactionId, amount: transactions.amount, date: transactions.date }).from(recurringOccurrences).leftJoin(transactions, eq(recurringOccurrences.transactionId, transactions.id)).where(eq(recurringOccurrences.seriesId, data.id)).orderBy(desc(recurringOccurrences.dueDate)),
    db.select({ n: sql<number>`count(*)` }).from(transactions).where(sql`${transactions.merchant} like ${`%${series.match.replace("*", "")}%`}`),
  ]);
  return { series, occurrences, matching: Number(matching[0]?.n ?? 0) };
});

export const saveSeries = createServerFn({ method: "POST" }).validator(seriesSchema).handler(async ({ data }) => {
  const db = getDb(); const { id: seriesId, ...values } = data;
  if (seriesId) { await db.update(recurringSeries).set(values).where(eq(recurringSeries.id, seriesId)); return seriesId; }
  const [row] = await db.insert(recurringSeries).values(values).returning({ id: recurringSeries.id }); return row!.id;
});
export const removeSeries = createServerFn({ method: "POST" }).validator(id).handler(async ({ data }) => { await getDb().delete(recurringSeries).where(eq(recurringSeries.id, data.id)); });

export const getTrips = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb(); const all = await db.select().from(trips).orderBy(desc(trips.startDate)); const now = today();
  const totals = await db.all<{ trip_id: number; total: number }>(sql`select tt.trip_id, sum(t.amount) total from transaction_trips tt join transactions t on t.id=tt.transaction_id where t.deleted_at is null and tt.in_daily_budget=1 group by tt.trip_id`);
  const spend = new Map(totals.map((row) => [Number(row.trip_id), Number(row.total)])); return all.map((trip) => ({ ...trip, spent: spend.get(trip.id) ?? 0, active: trip.startDate <= now && trip.endDate >= now && !trip.endedAt }));
});

export const getTrip = createServerFn({ method: "GET" }).validator(id).handler(async ({ data }) => {
  const db = getDb(); const trip = await db.select().from(trips).where(eq(trips.id, data.id)).get(); if (!trip) return null;
  const rows = await db.select({ id: transactions.id, amount: transactions.amount, merchant: transactions.merchant, category: transactions.category, date: transactions.date, daily: transactionTrips.inDailyBudget }).from(transactionTrips).innerJoin(transactions, eq(transactionTrips.transactionId, transactions.id)).where(and(eq(transactionTrips.tripId, data.id), isNull(transactions.deletedAt))).orderBy(desc(transactions.date));
  return { trip, rows };
});

export const saveTrip = createServerFn({ method: "POST" }).validator(tripSchema).handler(async ({ data }) => {
  const db = getDb(); const { id: tripId, bookings, ...values } = data; let id = tripId;
  if (id) await db.update(trips).set(values).where(eq(trips.id, id)); else { const [row] = await db.insert(trips).values(values).returning({ id: trips.id }); id = row!.id; }
  for (const transactionId of bookings) await db.insert(transactionTrips).values({ transactionId, tripId: id!, source: "manual", inDailyBudget: false }).onConflictDoUpdate({ target: [transactionTrips.transactionId, transactionTrips.tripId], set: { inDailyBudget: false } });
  return id!;
});
export const endTrip = createServerFn({ method: "POST" }).validator(id).handler(async ({ data }) => { await getDb().update(trips).set({ endedAt: sql`datetime('now')` }).where(eq(trips.id, data.id)); });

export const findBookings = createServerFn({ method: "GET" }).validator(z.object({ before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).handler(async ({ data }) =>
  getDb().select({ id: transactions.id, merchant: transactions.merchant, amount: transactions.amount, date: transactions.date, category: transactions.category }).from(transactions)
    .where(and(isNull(transactions.deletedAt), lte(transactions.date, `${data.before} 23:59`), sql`(${transactions.category} = 'Transport' or lower(${transactions.merchant}) glob '*flight*' or lower(${transactions.merchant}) glob '*rail*' or lower(${transactions.merchant}) glob '*hotel*' or lower(${transactions.merchant}) glob '*ibibo*' or lower(${transactions.merchant}) glob '*makemytrip*' or lower(${transactions.merchant}) glob '*irctc*')`)).orderBy(desc(transactions.date)).limit(25),
);
