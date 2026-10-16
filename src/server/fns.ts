// Core server functions: shell, transactions, categories, budgets, rules. Feature areas live in
// src/server/{plan,wealth,insights,ai}/fns.ts. Every function here is behind the auth middleware.
import { createServerFn } from "@tanstack/react-start";
import { and, count, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db/client";
import {
  addRule, addSchema, addTxn, budgetSchema, categoryList, editSchema, editTxn, flagSchema, flagTxn, getTxn, listSchema,
  listTxns, removeTxn, restoreTxn, ruleSchema, setBudget, splitsByTxnIds, summarizeTxns,
} from "./db/queries";
import { transactions, trips } from "./db/schema";
import { afterWrite } from "./jobs";

const id = z.object({ id: z.number().int().positive() });
const localToday = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Shell data on every page: review count and the trip card (active, or starting within 7 days). */
export const getShell = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb();
  const today = localToday();
  const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const [[review], trip] = await Promise.all([
    db.select({ n: count() }).from(transactions).where(and(isNull(transactions.deletedAt), eq(transactions.needsReview, true))),
    db
      .select()
      .from(trips)
      .where(and(isNull(trips.endedAt), gte(trips.endDate, today), lte(trips.startDate, week)))
      .orderBy(trips.startDate)
      .get(),
  ]);
  return {
    reviewCount: review?.n ?? 0,
    trip: trip
      ? { id: trip.id, name: trip.name, startDate: trip.startDate, endDate: trip.endDate, autoTag: trip.autoTag, active: trip.startDate <= today }
      : null,
  };
});

export const getTransactions = createServerFn({ method: "GET" })
  .validator(listSchema.safeExtend({ limit: z.number().int().min(1).max(500).optional(), withRaw: z.boolean().optional() }))
  .handler(async ({ data }) => {
    const rows = await listTxns(getDb(), { ...data, limit: data.limit ?? 500 });
    const splits = await splitsByTxnIds(getDb(), rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, splits: splits[r.id] ?? [] }));
  });

export const getTransactionSummary = createServerFn({ method: "GET" })
  .validator(listSchema)
  .handler(({ data }) => summarizeTxns(getDb(), data));

export const getTransaction = createServerFn({ method: "GET" })
  .validator(id)
  .handler(async ({ data }) => (await getTxn(getDb(), data.id)) ?? null);

export const getCategories = createServerFn({ method: "GET" }).handler(() => categoryList(getDb()));

export const saveEdit = createServerFn({ method: "POST" })
  .validator(editSchema)
  .handler(async ({ data }) => {
    await editTxn(getDb(), data);
    await afterWrite([data.id]);
  });

export const flagTransaction = createServerFn({ method: "POST" })
  .validator(flagSchema)
  .handler(({ data }) => flagTxn(getDb(), data));

export const addTransaction = createServerFn({ method: "POST" })
  .validator(addSchema)
  .handler(async ({ data }) => {
    const newId = await addTxn(getDb(), data);
    await afterWrite([newId]);
    return newId;
  });

export const deleteTransaction = createServerFn({ method: "POST" })
  .validator(id)
  .handler(({ data }) => removeTxn(getDb(), data.id));

export const restoreTransaction = createServerFn({ method: "POST" })
  .validator(id)
  .handler(({ data }) => restoreTxn(getDb(), data.id));

export const saveBudget = createServerFn({ method: "POST" })
  .validator(budgetSchema)
  .handler(({ data }) => setBudget(getDb(), data));

/** "Always file X as Y" from Review/Edit: creates the rule and files the source row. */
export const createRule = createServerFn({ method: "POST" })
  .validator(ruleSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const ruleId = await addRule(db, data);
    if (data.createdFromTxnId)
      await db
        .update(transactions)
        .set({ category: data.category, merchant: data.displayMerchant, needsReview: false, editedAt: sql`(datetime('now'))` })
        .where(eq(transactions.id, data.createdFromTxnId));
    return ruleId;
  });
