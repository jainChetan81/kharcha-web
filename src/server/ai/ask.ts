import { and, count, desc, eq, gte, isNull, like, lt, lte, sql, sum } from "drizzle-orm";
import { filteredAmount, listWhere, type Scope, spendByCategory } from "../db/queries.ts";
import { z } from "zod";
import { askLog, budgets, categories, recurringSeries, transactions, trips } from "../db/schema.ts";
import { callOpenRouter } from "./client.ts";
import type { Db } from "../db/client.ts";

const filterSchema = z.object({
  category: z.string().max(40).optional(), merchant: z.string().max(120).optional(), type: z.enum(["income", "expense", "investment"]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), trip: z.string().max(100).optional(),
}).strict();
export const askSpecSchema = z.object({
  metric: z.enum(["sum", "count", "avg"]), filters: filterSchema.default({}), groupBy: z.enum(["category", "merchant", "day", "month"]).nullable().optional(),
  period: z.enum(["current_month", "previous_month", "last_30_days", "last_3_months", "this_year", "all"]).optional(),
}).strict();
export type AskSpec = z.infer<typeof askSpecSchema>;

type ResultRow = { label: string; value: number; transactionIds: number[] };
export type AskResult = { ok: true; question: string; answer: string; rows: ResultRow[]; transactionIds: number[]; followUps: string[]; model: string } | { ok: false; reason: string };
const parseJson = (value: string): unknown => {
  try { return JSON.parse(value); } catch { return undefined; }
};
// Models emit null for unused fields; the strict schema wants them absent.
const dropNulls = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(dropNulls) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, dropNulls(v)])) : value;
/** Merchant labels can carry UPI IDs or account numbers; neither may reach OpenRouter. */
export const scrub = (label: string) => (/@|\d(?:[\s.-]*\d){5}/.test(label) ? "[private payee]" : label);
/** Free text (questions, past answers) keeps its words but loses handles, long digit runs and bare 4-digit numbers (card last-4). Years and ₹ amounts stay. */
export const redact = (text: string) => text.replace(/\S+@\S+/g, "[private]").replace(/\d[\d\s.-]{5,}\d/g, (m) => (m.replace(/\D/g, "").length >= 6 ? "[number]" : m)).replace(/(?<![₹\d,.]|Rs\.? ?)(\d{4})(?![\d]|[,.]\d)/g, (m) => (/^(19|20)\d\d$/.test(m) ? m : "[number]"));
const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const plan = z.object({ queries: z.array(askSpecSchema).min(1).max(3) });

function dates(spec: AskSpec) {
  // Calendar math in UTC on the IST date, so bounds match the IST context whatever the server zone.
  const [y, m, dd] = istToday().split("-").map(Number); const day = new Date(Date.UTC(y, m - 1, dd));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (spec.filters.from || spec.filters.to) return { from: spec.filters.from, to: spec.filters.to, explicitTo: true };
  if (spec.period === "all") return {};
  if (spec.period === "this_year") return { from: `${y}-01-01`, to: `${y + 1}-01-01` };
  if (spec.period === "last_30_days") return { from: fmt(new Date(day.getTime() - 30 * 864e5)), to: fmt(new Date(day.getTime() + 864e5)) };
  const months = spec.period === "last_3_months" ? 2 : spec.period === "previous_month" ? 1 : 0;
  const d = new Date(Date.UTC(y, m - 1 - months, 1));
  return { from: fmt(d), to: months === 2 ? fmt(new Date(Date.UTC(y, m, 1))) : fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) };
}

/** Scope dates win over the planner's period: the page's filter is what the person is looking at. */
const scopeDated = (scope: Scope) => Boolean(scope.month || scope.from || scope.to);

async function runSpec(db: Db, spec: AskSpec, scope: Scope = {}): Promise<ResultRow[]> {
  // Scope is applied here, server-side, so the model can't widen it and card digits never leave the box.
  const where = [isNull(transactions.deletedAt), isNull(transactions.duplicateOf), ...listWhere(scope)];
  if (scope.type !== "transfer") where.push(eq(transactions.excluded, false)); // "Not counted" scope asks about exactly those rows.
  const period = scopeDated(scope) ? {} : dates(spec);
  if (period.from) where.push(gte(transactions.date, period.from));
  if (period.to) where.push(period.explicitTo ? lte(transactions.date, `${period.to} 23:59`) : lt(transactions.date, period.to));
  if (spec.filters.category) where.push(eq(transactions.category, spec.filters.category));
  if (spec.filters.merchant) where.push(like(transactions.merchant, `%${spec.filters.merchant}%`));
  if (spec.filters.type) where.push(eq(transactions.type, spec.filters.type));
  if (spec.filters.trip) where.push(sql`${transactions.id} IN (SELECT tt.transaction_id FROM transaction_trips tt JOIN trips tr ON tr.id = tt.trip_id WHERE tr.name LIKE ${`%${spec.filters.trip}%`})`);
  const group = spec.groupBy ?? null;
  const label = group === "day" ? sql<string>`substr(${transactions.date}, 1, 10)` : group === "month" ? sql<string>`substr(${transactions.date}, 1, 7)` : group === "category" ? sql<string>`coalesce(${transactions.category}, 'Other')` : group === "merchant" ? transactions.merchant : sql<string>`'Total'`;
  // A category scope counts only the selected split parts, matching Activity and Insights.
  // ponytail: groupBy "category" still labels split rows by their root category; join transaction_splits if split breakdowns get used.
  const amount = scope.categories?.length || scope.category ? filteredAmount(scope).counted : sql`${transactions.amount}`;
  const metric = spec.metric === "count" ? count() : spec.metric === "avg" ? sql<number>`avg(${amount})` : sql<number>`sum(${amount})`.mapWith(Number);
  const rows = await db.select({ label, value: metric, ids: sql<string>`group_concat(${transactions.id})` }).from(transactions).where(and(...where)).groupBy(label).orderBy(desc(metric));
  return rows.map((row) => ({ label: String(row.label), value: Number(row.value ?? 0), transactionIds: String(row.ids ?? "").split(",").filter(Boolean).map(Number) }));
}

const rupees = /(?:₹|\b(?:Rs\.?|INR)\s*)\s*([\d,]+(?:\.\d{1,2})?)|\b([\d,]+(?:\.\d{1,2})?)\s*(?:rupees|rs\b|inr\b)/gi;
const normal = (value: string) => Number(value.replace(/,/g, "")).toFixed(2);
/** Reject AI money claims absent from query results and context (exact or rounded to the rupee). */
export function figuresMatchRows(answer: string, rows: Pick<ResultRow, "value">[]): boolean {
  const allowed = new Set(rows.flatMap((row) => [Number(row.value).toFixed(2), Math.round(row.value).toFixed(2)]));
  return [...answer.matchAll(rupees)].every((match) => allowed.has(normal(match[1] ?? match[2] ?? "")));
}

type Context = Awaited<ReturnType<typeof ledgerContext>>;
/** Aggregates only: no SMS text, card digits or UPI IDs. Gives the model enough history to judge what matters. */
async function ledgerContext(db: Db) {
  const today = istToday();
  const month = today.slice(0, 7);
  const shift = (by: number) => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + by); return d.toISOString().slice(0, 10); };
  const live = and(isNull(transactions.deletedAt), eq(transactions.type, "expense"), eq(transactions.excluded, false), isNull(transactions.duplicateOf));
  const [thisMonth, lastThree, months, merchants, limits, series, tripRows, cats, recent] = await Promise.all([
    spendByCategory(db, shift(0), shift(1)),
    spendByCategory(db, shift(-3), shift(0)),
    db.select({ month: sql<string>`substr(${transactions.date}, 1, 7)`, total: sum(transactions.amount).mapWith(Number) }).from(transactions).where(and(live, gte(transactions.date, shift(-5)))).groupBy(sql`1`).orderBy(sql`1`),
    db.select({ merchant: transactions.merchant, total: sum(transactions.amount).mapWith(Number), n: count() }).from(transactions).where(and(live, gte(transactions.date, shift(-2)))).groupBy(transactions.merchant).orderBy(desc(sum(transactions.amount))).limit(15),
    db.select().from(budgets),
    db.select({ name: recurringSeries.name, kind: recurringSeries.kind, amount: recurringSeries.expectedAmount, cadence: recurringSeries.cadence, status: recurringSeries.status }).from(recurringSeries),
    db.select({ name: trips.name, startDate: trips.startDate, endDate: trips.endDate }).from(trips).orderBy(desc(trips.startDate)).limit(5),
    db.select({ name: categories.name, type: categories.type }).from(categories).orderBy(categories.sortOrder),
    db.select({ question: askLog.question, answerJson: askLog.answerJson }).from(askLog).orderBy(desc(askLog.createdAt)).limit(3),
  ]);
  const r = (value: number) => Math.round(value);
  const day = Number(today.slice(8, 10));
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return {
    today,
    dayOfMonth: `${day} of ${daysInMonth}`,
    expenseCategories: cats.filter((c) => c.type === "expense").map((c) => scrub(c.name)),
    incomeCategories: cats.filter((c) => c.type === "income").map((c) => scrub(c.name)),
    monthlySpend: months.map((m) => ({ month: m.month, total: r(m.total) })),
    // Deltas are precomputed so the model can cite them without doing arithmetic.
    thisMonthByCategory: thisMonth.map((c) => {
      const spent = r(c.total);
      const usualMonth = r((lastThree.find((u) => u.category === c.category)?.total ?? 0) / 3);
      const budget = limits.find((b) => b.category === c.category)?.monthlyLimit ?? null;
      return { category: scrub(c.category), spent, usualMonth, vsUsual: spent - usualMonth, onPaceFor: r((c.total / day) * daysInMonth), budget, budgetLeft: budget == null ? null : r(budget - c.total) };
    }),
    budgetsWithoutSpend: limits.filter((b) => !thisMonth.some((c) => c.category === b.category)).map((b) => ({ category: scrub(b.category), budget: b.monthlyLimit })),
    topMerchantsLast3Months: merchants.map((m) => ({ merchant: scrub(m.merchant), total: r(m.total), count: m.n })),
    recurring: series.map((s) => ({ ...s, name: scrub(s.name), amount: r(s.amount) })),
    trips: tripRows.map((t) => ({ ...t, name: scrub(t.name) })),
    recentQuestions: recent.reverse().map((q) => ({ question: redact(q.question), answer: redact((parseJson(q.answerJson ?? "") as { answer?: string } | undefined)?.answer ?? "") || null })),
  };
}

const contextFigures = (context: Context) => [
  ...context.monthlySpend.map((m) => m.total),
  ...context.thisMonthByCategory.flatMap((c) => [c.spent, c.usualMonth, c.vsUsual, c.onPaceFor, c.budget ?? 0, c.budgetLeft ?? 0]),
  ...context.budgetsWithoutSpend.map((b) => b.budget),
  ...context.topMerchantsLast3Months.map((m) => m.total),
  ...context.recurring.map((s) => s.amount),
].map((value) => ({ value: Math.abs(value) }));

const plannerPrompt = `You plan read-only queries over one person's personal expense ledger (India, rupees). Return JSON only:
{"queries":[Spec, ...]} with 1 to 3 specs. Use more than one only when it helps answer well, e.g. this period vs a previous one, or a total plus a breakdown.
Spec = {
  "metric": "sum" | "count" | "avg",
  "groupBy": "category" | "merchant" | "day" | "month"   (omit for a single total),
  "period": "current_month" | "previous_month" | "last_30_days" | "last_3_months" | "this_year" | "all"   (default current_month),
  "filters": { "category"?: exact category name, "merchant"?: substring of merchant name, "type"?: "expense" | "income" | "investment", "from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD", "trip"?: substring of trip name }
}
from/to override period. If "scope" is set, every query is already limited to it by the server (its period replaces yours); plan within it and don't repeat its filters. Omit fields you do not need; never invent other keys. Use the context to map words to real category, merchant and trip names, and to resolve follow-up questions from recentQuestions. Spending questions use type "expense".`;

const narratorPrompt = `You are Kharcha, a sharp, friendly money assistant for one person in India. Return JSON only: {"answer": string, "followUps": string[]}.
answer: at most 4 short sentences, plain text, no markdown.
1. Answer the question directly from "results" (the first query is the main one). If "scope" is set, results cover only that scope; say so briefly when it matters.
2. Then use your own judgment with "context", which is this person's recent history: if something is worth noticing, say it and give one concrete, practical suggestion they can act on this month. Look for: a category well above its usualMonth (vsUsual), onPaceFor beyond budget, a negative budgetLeft, one merchant or subscription dominating, a trip or recurring charge driving the number, or a month that breaks the monthlySpend trend. Prefer the single most useful insight over a list. Skip this if nothing stands out; never pad or lecture.
Money rules: every rupee figure you write must appear in results or context. Write it as ₹ with Indian digit grouping and no decimals, e.g. ₹12,345. You may name categories, merchants and months freely. Do not do new arithmetic: use the supplied vsUsual, onPaceFor and budgetLeft instead of subtracting yourself. If a figure you want is not supplied, describe it in words ("about double", "well under budget").
followUps: up to 3 short next questions this ledger can answer (totals, counts or averages by category, merchant, day, month, trip or date range), tailored to what you found.`;

/** What the model is told about the scope: names and dates only. Card digits, raw search text and amounts stay local. */
export function describeScope(scope: Scope) {
  // Scope labels come from the URL, so any digit run of 4+ (card last-4) is dropped too.
  const label = (value: string) => (/\d{4}/.test(value) ? "[private]" : scrub(value));
  const cats = (scope.categories ?? (scope.category ? [scope.category] : [])).map((value) => label(value.split(":").at(-1) ?? value));
  const parts = {
    period: scope.from || scope.to ? `${scope.from ?? "start"} to ${scope.to ?? "today"}` : scope.month,
    categories: cats.length ? cats : undefined,
    merchant: scope.merchant ? label(scope.merchant) : undefined,
    type: scope.type === "transfer" ? "not counted" : scope.type,
    card: scope.card ? "one card" : undefined,
    trip: scope.tripId ? "one trip" : undefined,
    amount: scope.min !== undefined || scope.max !== undefined ? "an amount range" : undefined,
    search: scope.search ? "a text search" : undefined,
  };
  const set = Object.fromEntries(Object.entries(parts).filter(([, v]) => v !== undefined));
  return Object.keys(set).length ? set : null;
}

export async function askLedger(db: Db, question: string, scope: Scope = {}): Promise<AskResult> {
  const context = await ledgerContext(db);
  const asked = redact(question);
  const scoped = describeScope(scope);
  const planned = await callOpenRouter([{ role: "system", content: plannerPrompt }, { role: "user", content: JSON.stringify({ question: asked, scope: scoped, context: { today: context.today, expenseCategories: context.expenseCategories, incomeCategories: context.incomeCategories, merchants: context.topMerchantsLast3Months.map((m) => m.merchant), trips: context.trips, recentQuestions: context.recentQuestions } }) }], { db });
  if (!planned.ok) return planned;
  const raw = dropNulls(parseJson(planned.content));
  const parsed = plan.safeParse(raw);
  const single = parsed.success ? null : askSpecSchema.safeParse(raw);
  const queries = parsed.success ? parsed.data.queries : single?.success ? [single.data] : null;
  if (!queries) return { ok: false, reason: "invalid" };
  const results = await Promise.all(queries.map((spec) => runSpec(db, spec, scope)));
  const rows = results[0] ?? [];
  const transactionIds = [...new Set(rows.flatMap((row) => row.transactionIds))];
  const shown = results.map((list, index) => ({ spec: queries[index], rows: list.slice(0, 25).map(({ label, value }) => ({ label: scrub(label), value: Math.round(value) })) }));
  const narrated = await callOpenRouter([{ role: "system", content: narratorPrompt }, { role: "user", content: JSON.stringify({ question: asked, scope: scoped, results: shown, context }) }], { db });
  const answerData = narrated.ok ? z.object({ answer: z.string().max(700), followUps: z.array(z.string().trim().min(3).max(120)).max(3).default([]) }).safeParse(parseJson(narrated.content)) : null;
  const ok = answerData?.success && figuresMatchRows(answerData.data.answer, [...results.flat(), ...contextFigures(context)]);
  const answer = ok ? answerData.data.answer : "Here are matching ledger totals.";
  const followUps = ok ? answerData.data.followUps : [];
  const model = narrated.ok ? narrated.model : planned.model;
  await db.insert(askLog).values({ question, specJson: JSON.stringify(queries), answerJson: JSON.stringify({ answer, rows, transactionIds, followUps }), model });
  return { ok: true, question, answer, rows, transactionIds, followUps, model };
}
