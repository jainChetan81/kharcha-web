import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "../db/client.ts";
import { shareSql, spendByCategory } from "../db/queries.ts";
import { budgets, digests, holdings, holdingTxns, insights, recurringSeries, transactions } from "../db/schema.ts";
import { scrub } from "../ai/ask.ts";
import { callOpenRouter } from "../ai/client.ts";
import { callCostUsd } from "../ai/pricing.ts";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const localDate = () => new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())}T00:00:00Z`);
const weekStart = (d = localDate()) => {
  const out = new Date(d); out.setUTCDate(out.getUTCDate() - ((out.getUTCDay() + 6) % 7)); return out;
};
const monthEnd = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
const daysIn = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();

async function addInsight(db: Db, detector: string, key: string, payload: object) {
  await db.insert(insights).values({ detector, key, payloadJson: JSON.stringify(payload) }).onConflictDoNothing();
}

/** detectors job (§8), nightly. Owner: Insights+AI agent. */
export async function runDetectors(db: Db = getDb()): Promise<{ found: number }> {
  const now = localDate(); const from = new Date(now.getTime() - 56 * 864e5); const thisWeek = weekStart(now);
  const rows = await db.select({ id: transactions.id, merchant: transactions.merchant, amount: shareSql(), date: transactions.date, category: transactions.category }).from(transactions).where(and(isNull(transactions.deletedAt), eq(transactions.type, "expense"), eq(transactions.excluded, false), isNull(transactions.duplicateOf), sql`${transactions.date} >= ${iso(from)}`));
  let found = 0;
  const merchants = new Map<string, number[]>();
  for (const row of rows) {
    const bucket = Math.floor((new Date(`${row.date.slice(0, 10)}T00:00:00Z`).getTime() - weekStart(from).getTime()) / (7 * 864e5));
    const amounts = merchants.get(row.merchant) ?? Array(9).fill(0); amounts[Math.max(0, Math.min(8, bucket))] += row.amount; merchants.set(row.merchant, amounts);
  }
  for (const [merchant, amounts] of merchants) {
    const current = amounts[8] ?? 0; const prior = amounts.slice(0, 8).filter(Boolean).sort((a, b) => a - b); const median = prior.length ? prior[Math.floor(prior.length / 2)] : 0;
    if (median > 0 && current >= 2 * median) { await addInsight(db, "unusual", `${iso(thisWeek)}:${merchant}`, { merchant, current, median, href: `/activity?merchant=${encodeURIComponent(merchant)}` }); found++; }
  }
  const repeats = new Map<string, { merchant: string; date: string; amount: number; ids: number[] }>();
  const sameDay = new Map<string, { merchant: string; date: string; ids: number[] }>();
  for (const row of rows.filter((row) => row.date >= iso(thisWeek))) {
    const key = `${row.date.slice(0, 10)}:${row.merchant}:${row.amount}`; const item = repeats.get(key) ?? { merchant: row.merchant, date: row.date.slice(0, 10), amount: row.amount, ids: [] }; item.ids.push(row.id); repeats.set(key, item);
    const dayKey = `${row.date.slice(0, 10)}:${row.merchant}`; const dayItem = sameDay.get(dayKey) ?? { merchant: row.merchant, date: row.date.slice(0, 10), ids: [] }; dayItem.ids.push(row.id); sameDay.set(dayKey, dayItem);
  }
  for (const [key, item] of repeats) if (item.ids.length >= 2) { await addInsight(db, "repeat", key, item); found++; }
  for (const [key, item] of sameDay) if (item.ids.length >= 3) { await addInsight(db, "repeat", `${key}:three`, item); found++; }
  const recent = rows.filter((row) => row.date >= iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1))));
  const seen = new Map<string, { months: Set<string>; values: number[] }>();
  for (const row of recent) { const item = seen.get(row.merchant) ?? { months: new Set(), values: [] }; item.months.add(row.date.slice(0, 7)); item.values.push(row.amount); seen.set(row.merchant, item); }
  const series = await db.select({ match: recurringSeries.match }).from(recurringSeries);
  for (const [merchant, item] of seen) {
    const average = item.values.reduce((a, b) => a + b, 0) / item.values.length;
    const similar = item.values.every((value) => Math.abs(value - average) <= average * 0.2);
    if (item.months.size >= 3 && similar && !series.some((s) => merchant.toLowerCase().includes(s.match.toLowerCase()))) { await addInsight(db, "recurring", merchant, { merchant, average, href: `/activity?merchant=${encodeURIComponent(merchant)}` }); found++; }
  }
  const activeHoldings = await db.select().from(holdings).where(and(eq(holdings.isClosed, false), sql`${holdings.sipDay} IS NOT NULL`));
  for (const holding of activeHoldings) if ((holding.sipDay ?? 32) + 3 < now.getUTCDate()) {
    const paid = await db.select({ id: holdingTxns.id }).from(holdingTxns).where(and(eq(holdingTxns.holdingId, holding.id), sql`${holdingTxns.date} >= ${iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)))}`)).get();
    if (!paid) { await addInsight(db, "missing_sip", `${holding.id}:${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`, { holding: holding.name, href: `/wealth/${holding.id}` }); found++; }
  }
  const limits = await db.select().from(budgets); const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); const spend = await spendByCategory(db, iso(start), iso(monthEnd(now)));
  for (const budget of limits) { const value = spend.find((row) => row.category === budget.category)?.total ?? 0; const pace = value / Math.max(1, now.getUTCDate()); if (pace * daysIn(now) > budget.monthlyLimit) { const crossing = Math.ceil(budget.monthlyLimit / Math.max(pace, 1)); await addInsight(db, "budget", `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}:${budget.category}`, { category: budget.category, crossing, href: "/plan/budgets" }); found++; } }
  return { found };
}

/** digest job (§8), Monday 07:00 IST. Owner: Insights+AI agent. */
const lineSchema = z.array(z.object({ pre: z.string(), num: z.string(), post: z.string(), factKey: z.string() })).length(3);
const parseJson = (value: string): unknown => { try { return JSON.parse(value); } catch { return undefined; } };
export function validDigestLines(value: unknown, facts: Record<string, string>): value is z.infer<typeof lineSchema> {
  const parsed = lineSchema.safeParse(value); return parsed.success && parsed.data.every((line) => facts[line.factKey] === line.num && !/\d/.test(line.pre + line.post));
}

export async function runDigest(db: Db = getDb()): Promise<{ written: boolean }> {
  // Runs Monday morning, so report the last full Monday-to-Sunday week.
  const now = localDate(); const week = new Date(weekStart(now).getTime() - 7 * 864e5); const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const weeklySpend = await spendByCategory(db, iso(week), iso(new Date(week.getTime() + 7 * 864e5)));
  const usualSpend = await spendByCategory(db, iso(new Date(week.getTime() - 28 * 864e5)), iso(week));
  const monthSpend = await spendByCategory(db, iso(month), iso(monthEnd(now)));
  const monthRows = await db.all<{ merchant: string; total: number }>(sql`SELECT merchant, SUM(${shareSql()}) total FROM transactions WHERE deleted_at IS NULL AND type = 'expense' AND excluded = 0 AND duplicate_of IS NULL AND date >= ${iso(month)} AND date < ${iso(monthEnd(now))} GROUP BY merchant ORDER BY total DESC LIMIT 1`);
  const total = monthSpend.reduce((sum, row) => sum + row.total, 0); const top = monthRows[0];
  const cat = weeklySpend.map((row) => ({ ...row, change: row.total - (usualSpend.find((usual) => usual.category === row.category)?.total ?? 0) / 4 })).sort((a, b) => b.change - a.change)[0]; const reviews = await db.all<{ n: number }>(sql`SELECT COUNT(*) n FROM transactions WHERE deleted_at IS NULL AND needs_review = 1 AND category = 'Other'`);
  const limits = await db.select().from(budgets); const day = Math.max(1, now.getUTCDate());
  const crossing = limits.map((limit) => ({ category: limit.category, day: Math.ceil(limit.monthlyLimit / Math.max(1, (monthSpend.find((row) => row.category === limit.category)?.total ?? 0) / day)) })).filter((item) => item.day <= daysIn(now)).sort((a, b) => a.day - b.day)[0];
  const facts = {
    topMerchant: top ? `${scrub(top.merchant)} at ${Math.round((top.total / Math.max(1, total)) * 100)}%` : "No merchant data",
    category: cat ? `${scrub(cat.category)} ${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(cat.total)}` : "No category data",
    budgetForecast: crossing ? `${scrub(crossing.category)} around day ${crossing.day}` : "No budget crossing forecast",
    reviewBacklog: `${reviews[0]?.n ?? 0} rows`,
  };
  const links = { topMerchant: top ? `/activity?merchant=${encodeURIComponent(top.merchant)}` : "/activity", category: cat ? `/activity?category=${encodeURIComponent(cat.category)}` : "/activity", budgetForecast: "/plan/budgets", reviewBacklog: "/review" };
  // Context lets the model judge which facts matter; only facts values may appear as figures.
  const context = { dayOfMonth: day, daysInMonth: daysIn(now), weekCategory: cat ? { category: scrub(cat.category), thisWeek: Math.round(cat.total), usualWeek: Math.round(cat.total - cat.change) } : null, budgets: limits.map((limit) => ({ category: scrub(limit.category), limit: limit.monthlyLimit, spent: Math.round(monthSpend.find((row) => row.category === limit.category)?.total ?? 0) })) };
  const response = await callOpenRouter([{ role: "system", content: `You write a Monday money digest for one person in India. Return JSON only: {"lines":[{"pre","num","post","factKey"}]} with exactly 3 lines.
Pick the 3 facts that matter most this week, most important first, using context to judge (a category well above its usual week, a budget about to be crossed, a big review backlog). Each line reads pre + num + post as one short sentence (under 14 words) that says what happened and, where useful, what to do next, e.g. "Review " + "12 rows" + " so Other stops hiding spend."
num must be copied verbatim from the chosen facts value, and factKey must be that fact's key. Use each fact at most once. No other figures in pre or post.` }, { role: "user", content: JSON.stringify({ facts, context }) }], { db });
  let text: string | null = null; let model: string | null = null;
  if (response.ok) { const parsed = z.object({ lines: z.unknown() }).safeParse(parseJson(response.content)); if (parsed.success && validDigestLines(parsed.data.lines, facts)) { text = JSON.stringify(parsed.data.lines); model = response.model; } }
  // Provenance only when the model's words were kept; a rejected reply still cost money but is not shown.
  const tokensIn = text !== null && response.ok ? response.tokensIn : null;
  const tokensOut = text !== null && response.ok ? response.tokensOut : null;
  const costUsd = text !== null && response.ok ? await callCostUsd(db, response.model, response.tokensIn, response.tokensOut, response.costUsd) : null;
  const row = { factsJson: JSON.stringify({ ...facts, links }), text, model, tokensIn, tokensOut, costUsd };
  await db.insert(digests).values({ weekStart: iso(week), ...row }).onConflictDoUpdate({ target: digests.weekStart, set: row });
  return { written: text !== null };
}
