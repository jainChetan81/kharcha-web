// Insights, digest, Ask. Owner: Insights+AI agent.
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "../db/client.ts";
import { filteredAmount, listWhere, type Scope, scopeSchema, splitShareOf } from "../db/queries.ts";
import { dayMonth, shiftMonth } from "../../lib/format.ts";
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

const moneyRows = <T,>(rows: T[]) => rows.map((row) => {
  const value = row as Record<string, unknown>;
  for (const key of ["total", "amount", "income", "investments", "spending", "n"]) if (typeof value[key] === "string") value[key] = Number(value[key]);
  return row;
});

/** Same filters as Activity (listWhere), so "See insights" shows the rows Activity showed. Default period: this month. */
export const getInsights = createServerFn({ method: "GET" })
  .validator(scopeSchema)
  .handler(({ data }) => insightsFor(getDb(), data));

export async function insightsFor(db: Db, data: Scope) {
    const now = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()).slice(0, 7);
    const ranged = Boolean(data.from || data.to);
    const q = ranged ? { ...data, month: undefined } : { ...data, month: data.month ?? now };
    // Anchor month for the calendar and the six-month bars: the month the period ends in.
    const month = (data.to ?? data.from)?.slice(0, 7) ?? q.month ?? now;
    const { counted, splitFilter } = filteredAmount(q);
    const scoped = (where: SQL) => sql`WITH m AS (SELECT transactions.*, ${counted} AS counted_amount FROM transactions WHERE ${where}),
      s AS (SELECT * FROM m WHERE type = 'expense' AND excluded = 0 AND duplicate_of IS NULL)`;
    const head = scoped(and(...listWhere(q)) ?? sql`1 = 1`);
    const [waterfall, daily, bees, merchants, allInsights] = await Promise.all([
      db.all<{ income: number; investments: number; spending: number }>(sql`${head} SELECT
        (SELECT COALESCE(SUM(counted_amount), 0) FROM m WHERE type = 'income' AND excluded = 0 AND duplicate_of IS NULL) income,
        (SELECT COALESCE(SUM(amount), 0) FROM m WHERE type = 'investment') investments,
        (SELECT COALESCE(SUM(counted_amount), 0) FROM s) spending`),
      db.all<{ day: string; total: number; category: string }>(sql`${head}
        SELECT substr(s.date, 1, 10) day, SUM(CASE WHEN fs.transaction_id IS NULL THEN s.counted_amount ELSE ${sql.raw(splitShareOf("s", "fs"))} END) total,
          COALESCE(fs.category, s.category, 'Other') category
        FROM s LEFT JOIN transaction_splits fs ON fs.transaction_id = s.id
        WHERE fs.transaction_id IS NULL OR (fs.transaction_id IS NOT NULL${splitFilter}) GROUP BY 1, 3`),
      db.all<{ id: number; merchant: string; amount: number; category: string; date: string }>(sql`${head} SELECT id, merchant, counted_amount amount, COALESCE(category, 'Other') category, date FROM s ORDER BY amount DESC LIMIT 120`),
      db.all<{ merchant: string; total: number; n: number }>(sql`${head} SELECT merchant, SUM(counted_amount) total, COUNT(*) n FROM s GROUP BY merchant ORDER BY total DESC LIMIT 8`),
      db.select().from(insights).where(isNull(insights.dismissedAt)).orderBy(desc(insights.createdAt)).limit(8),
    ]);
    // Same non-date filters, one calendar month each.
    const six = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
      const key = shiftMonth(month, index - 5);
      const where = and(...listWhere({ ...q, from: undefined, to: undefined, month: key })) ?? sql`1 = 1`;
      const row = await db.all<{ total: number }>(sql`${scoped(where)} SELECT COALESCE(SUM(counted_amount), 0) total FROM s`);
      return { month: key, total: Number(row[0]?.total ?? 0), current: key === month };
    }));
    const values = moneyRows(waterfall)[0] ?? { income: 0, investments: 0, spending: 0 };
    return { month, from: data.from, to: data.to, waterfall: { ...values, saved: values.income - values.investments - values.spending }, daily: moneyRows(daily), bees: moneyRows(bees), merchants: moneyRows(merchants), insights: allInsights, six };
}

export const dismissInsight = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => { await getDb().update(insights).set({ dismissedAt: sql`(datetime('now'))` }).where(eq(insights.id, data.id)); });
