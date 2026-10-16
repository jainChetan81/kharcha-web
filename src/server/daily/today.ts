import { createServerFn } from "@tanstack/react-start";
import { and, asc, count, eq, gte, isNull, lt, sum } from "drizzle-orm";
import { z } from "zod";
import { shiftMonth } from "../../lib/format";
import { getDb } from "../db/client";
import { listTxns, monthBounds, monthSchema, shareSql, spendByCategory, spendable } from "../db/queries";
import { budgets, categories, transactions } from "../db/schema";

export const getTodayData = createServerFn({ method: "GET" })
  .validator(z.object({ month: monthSchema }))
  .handler(async ({ data }) => {
    const db = getDb();
    const [from, to] = monthBounds(data.month);
    const [previousFrom] = monthBounds(shiftMonth(data.month, -1));
    const [byCategory, current, previous, recent, [budget], [review], colors] = await Promise.all([
      spendByCategory(db, from, to),
      db.select({ date: transactions.date, amount: shareSql(), merchant: transactions.merchant })
        .from(transactions).where(and(spendable, gte(transactions.date, from), lt(transactions.date, to))).orderBy(asc(transactions.date)),
      db.select({ date: transactions.date, amount: shareSql() })
        .from(transactions).where(and(spendable, gte(transactions.date, previousFrom), lt(transactions.date, from))).orderBy(asc(transactions.date)),
      listTxns(db, { limit: 5 }),
      db.select({ total: sum(budgets.monthlyLimit) }).from(budgets),
      db.select({ total: count() }).from(transactions).where(and(isNull(transactions.deletedAt), eq(transactions.needsReview, true))),
      db.select({ name: categories.name, colorToken: categories.colorToken }).from(categories).where(eq(categories.type, "expense")),
    ]);
    const token = new Map(colors.map((item) => [item.name, item.colorToken]));
    return {
      month: data.month,
      spent: byCategory.reduce((total, item) => total + item.total, 0),
      limit: Number(budget?.total ?? 0),
      categories: byCategory.map((item) => ({ ...item, colorToken: token.get(item.category) ?? "cat-other" })),
      points: current,
      previous,
      recent,
      reviewCount: review?.total ?? 0,
      // Same number as the Other tile, so the card and the treemap agree.
      reviewOther: byCategory.find((item) => item.category === "Other")?.total ?? 0,
      colors,
    };
  });
