// Insights, digest, Ask. Owner: Insights+AI agent.
import { createServerFn } from "@tanstack/react-start";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.ts";
import { countedAmountSql, monthBounds, shareSql, spendByCategory, splitShareOf } from "../db/queries.ts";
import { dayMonth } from "../../lib/format.ts";
import { digests, insights } from "../db/schema.ts";

export type DigestLine = { pre: string; num: string; post: string; href: string };
export type Digest =
  | { status: "ok"; weekStart: string; label: string; lines: DigestLine[] }
  | { status: "unavailable" }
  | { status: "none" };

/** CONTRACT (used by Today): this week's digest, or why it is missing. */
export const getDigest = createServerFn({ method: "GET" }).handler(async (): Promise<Digest> => {
  const digest = await getDb().select().from(digests).orderBy(desc(digests.weekStart)).limit(1).get();
  if (!digest) return { status: "none" };
  if (!digest.text) return { status: "unavailable" };
  try {
    const facts = JSON.parse(digest.factsJson) as { links?: Record<string, string> };
    const lines = JSON.parse(digest.text) as (Omit<DigestLine, "href"> & { factKey?: string })[];
    if (!Array.isArray(lines) || lines.length !== 3) return { status: "unavailable" };
    return {
      status: "ok", weekStart: digest.weekStart,
      label: `Week of ${dayMonth(digest.weekStart)}`,
      lines: lines.map((line) => ({ pre: line.pre, num: line.num, post: line.post, href: facts.links?.[line.factKey ?? ""] ?? "/insights" })),
    };
  } catch { return { status: "unavailable" }; }
});

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const spend = sql`"transactions"."deleted_at" IS NULL AND "transactions"."type" = 'expense' AND "transactions"."excluded" = 0 AND "transactions"."duplicate_of" IS NULL`;
const aliasedSpend = sql`t.deleted_at IS NULL AND t.type = 'expense' AND t.excluded = 0 AND t.duplicate_of IS NULL`;
const moneyRows = <T,>(rows: T[]) => rows.map((row) => {
  const value = row as Record<string, unknown>;
  for (const key of ["total", "amount", "income", "investments", "n"]) if (typeof value[key] === "string") value[key] = Number(value[key]);
  return row;
});

export const getInsights = createServerFn({ method: "GET" })
  .validator(z.object({ month: monthSchema.optional() }))
  .handler(async ({ data }) => {
    const db = getDb(); const month = data.month ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()).slice(0, 7); const [from, to] = monthBounds(month);
    const [waterfall, daily, bees, merchants, allInsights] = await Promise.all([
      db.all<{ income: number; investments: number; spending: number }>(sql`SELECT
        COALESCE(SUM(CASE WHEN type = 'income' AND excluded = 0 AND duplicate_of IS NULL THEN ${countedAmountSql()} END), 0) income,
        COALESCE(SUM(CASE WHEN type = 'investment' THEN amount END), 0) investments,
        COALESCE(SUM(CASE WHEN type = 'expense' AND excluded = 0 AND duplicate_of IS NULL THEN ${shareSql()} END), 0) spending
        FROM transactions WHERE deleted_at IS NULL AND date >= ${from} AND date < ${to}`),
      db.all<{ day: string; total: number; category: string }>(sql`
        SELECT substr(t.date, 1, 10) day, SUM(CASE WHEN s.transaction_id IS NULL THEN ${shareSql("t")} ELSE
          ${sql.raw(splitShareOf("t", "s"))} END) total,
          COALESCE(s.category, t.category, 'Other') category
        FROM transactions t LEFT JOIN transaction_splits s ON s.transaction_id = t.id WHERE ${aliasedSpend}
          AND t.date >= ${from} AND t.date < ${to} GROUP BY 1, 3`),
      db.all<{ id: number; merchant: string; amount: number; category: string; date: string }>(sql`SELECT id, merchant, ${shareSql()} amount, COALESCE(category, 'Other') category, date FROM transactions WHERE ${spend} AND date >= ${from} AND date < ${to} ORDER BY amount DESC LIMIT 120`),
      db.all<{ merchant: string; total: number; n: number }>(sql`SELECT merchant, SUM(${shareSql()}) total, COUNT(*) n FROM transactions WHERE ${spend} AND date >= ${from} AND date < ${to} GROUP BY merchant ORDER BY total DESC LIMIT 8`),
      db.select().from(insights).where(isNull(insights.dismissedAt)).orderBy(desc(insights.createdAt)).limit(8),
    ]);
    const six = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
      const date = new Date(`${month}-01T00:00:00`); date.setMonth(date.getMonth() - (5 - index)); const key = date.toISOString().slice(0, 7); const [start, end] = monthBounds(key); const row = await db.all<{ total: number }>(sql`SELECT COALESCE(SUM(${shareSql()}), 0) total FROM transactions WHERE ${spend} AND date >= ${start} AND date < ${end}`); return { month: key, total: Number(row[0]?.total ?? 0), current: key === month };
    }));
    const values = moneyRows(waterfall)[0] ?? { income: 0, investments: 0, spending: 0 };
    const categories = await spendByCategory(db, from, to);
    return { month, waterfall: { ...values, saved: values.income - values.investments - values.spending }, daily: moneyRows(daily), bees: moneyRows(bees), merchants: moneyRows(merchants), insights: allInsights, six, categories };
  });

export const dismissInsight = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => { await getDb().update(insights).set({ dismissedAt: sql`(datetime('now'))` }).where(eq(insights.id, data.id)); });
