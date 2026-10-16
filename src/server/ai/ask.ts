import { and, count, desc, eq, gte, isNull, like, lt, lte, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { askLog, transactions } from "../db/schema.ts";
import { callOpenRouter } from "./client.ts";
import type { Db } from "../db/client.ts";

const filterSchema = z.object({
  category: z.string().max(40).optional(), merchant: z.string().max(120).optional(), type: z.enum(["income", "expense", "investment"]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), trip: z.string().max(100).optional(),
}).strict();
export const askSpecSchema = z.object({
  metric: z.enum(["sum", "count", "avg"]), filters: filterSchema.default({}), groupBy: z.enum(["category", "merchant", "day", "month"]).nullable().optional(),
  period: z.enum(["current_month", "previous_month", "last_30_days", "last_3_months", "this_year", "all"]).optional(), compareTo: z.literal("previous_period").nullable().optional(),
}).strict();
export type AskSpec = z.infer<typeof askSpecSchema>;

type ResultRow = { label: string; value: number; transactionIds: number[] };
export type AskResult = { ok: true; question: string; answer: string; rows: ResultRow[]; transactionIds: number[]; model: string } | { ok: false; reason: string };
const parseJson = (value: string): unknown => {
  try { return JSON.parse(value); } catch { return undefined; }
};

function dates(spec: AskSpec) {
  const now = new Date(); const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (spec.filters.from || spec.filters.to) return { from: spec.filters.from, to: spec.filters.to, explicitTo: true };
  if (spec.period === "all") return {};
  if (spec.period === "this_year") return { from: `${day.getFullYear()}-01-01`, to: `${day.getFullYear() + 1}-01-01` };
  if (spec.period === "last_30_days") return { from: fmt(new Date(day.getTime() - 30 * 864e5)), to: fmt(new Date(day.getTime() + 864e5)) };
  const months = spec.period === "last_3_months" ? 2 : spec.period === "previous_month" ? 1 : 0;
  const d = new Date(day.getFullYear(), day.getMonth() - months, 1);
  return { from: fmt(d), to: months === 2 ? fmt(new Date(day.getFullYear(), day.getMonth() + 1, 1)) : fmt(new Date(d.getFullYear(), d.getMonth() + 1, 1)) };
}

async function runSpec(db: Db, spec: AskSpec): Promise<ResultRow[]> {
  const where = [isNull(transactions.deletedAt), eq(transactions.excluded, false), isNull(transactions.duplicateOf)];
  const period = dates(spec);
  if (period.from) where.push(gte(transactions.date, period.from));
  if (period.to) where.push(period.explicitTo ? lte(transactions.date, `${period.to} 23:59`) : lt(transactions.date, period.to));
  if (spec.filters.category) where.push(eq(transactions.category, spec.filters.category));
  if (spec.filters.merchant) where.push(like(transactions.merchant, `%${spec.filters.merchant}%`));
  if (spec.filters.type) where.push(eq(transactions.type, spec.filters.type));
  if (spec.filters.trip) where.push(sql`${transactions.id} IN (SELECT tt.transaction_id FROM transaction_trips tt JOIN trips tr ON tr.id = tt.trip_id WHERE tr.name LIKE ${`%${spec.filters.trip}%`})`);
  const group = spec.groupBy ?? null;
  const label = group === "day" ? sql<string>`substr(${transactions.date}, 1, 10)` : group === "month" ? sql<string>`substr(${transactions.date}, 1, 7)` : group === "category" ? sql<string>`coalesce(${transactions.category}, 'Other')` : group === "merchant" ? transactions.merchant : sql<string>`'Total'`;
  const metric = spec.metric === "count" ? count() : spec.metric === "avg" ? sql<number>`avg(${transactions.amount})` : sum(transactions.amount).mapWith(Number);
  const rows = await db.select({ label, value: metric, ids: sql<string>`group_concat(${transactions.id})` }).from(transactions).where(and(...where)).groupBy(label).orderBy(desc(metric));
  return rows.map((row) => ({ label: String(row.label), value: Number(row.value ?? 0), transactionIds: String(row.ids ?? "").split(",").filter(Boolean).map(Number) }));
}

const rupees = /₹\s*([\d,]+(?:\.\d{1,2})?)/g;
const normal = (value: string) => Number(value.replace(/,/g, "")).toFixed(2);
/** Reject AI money claims absent from query result. */
export function figuresMatchRows(answer: string, rows: Pick<ResultRow, "value">[]): boolean {
  const allowed = new Set(rows.map((row) => Number(row.value).toFixed(2)));
  return [...answer.matchAll(rupees)].every((match) => allowed.has(normal(match[1])));
}

export async function askLedger(db: Db, question: string): Promise<AskResult> {
  const planned = await callOpenRouter([{ role: "system", content: "Return JSON only. Convert question to allowed ledger query spec. No SQL. Allowed metrics sum,count,avg; allowed groups category,merchant,day,month." }, { role: "user", content: question }], { db, requireEnabled: true });
  if (!planned.ok) return planned;
  const parsed = askSpecSchema.safeParse(parseJson(planned.content));
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const rows = await runSpec(db, parsed.data);
  const transactionIds = [...new Set(rows.flatMap((row) => row.transactionIds))];
  const narrated = await callOpenRouter([{ role: "system", content: "Return JSON only as {answer:string}. Explain only supplied aggregate rows in at most 3 sentences. Do not invent money figures." }, { role: "user", content: JSON.stringify({ question, rows: rows.map(({ label, value }) => ({ label, value })) }) }], { db, requireEnabled: true });
  const answerData = narrated.ok ? z.object({ answer: z.string().max(700) }).safeParse(parseJson(narrated.content)) : null;
  const answer = answerData?.success && figuresMatchRows(answerData.data.answer, rows) ? answerData.data.answer : "Here are matching ledger totals.";
  const model = narrated.ok ? narrated.model : planned.model;
  await db.insert(askLog).values({ question, specJson: JSON.stringify(parsed.data), answerJson: JSON.stringify({ answer, rows, transactionIds }), model });
  return { ok: true, question, answer, rows, transactionIds, model };
}
