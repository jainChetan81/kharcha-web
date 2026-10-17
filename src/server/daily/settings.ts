import { createServerFn } from "@tanstack/react-start";
import { and, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { aiConfig } from "../ai/client";
import { modelCosts } from "../ai/pricing";
import { getMeta, setMeta } from "../db/queries";
import { budgets, categories, merchantRules, transactionItems, transactionSplits, transactions } from "../db/schema";

const name = z.string().trim().min(1).max(40);
const type = z.enum(["expense", "income"]);
const colorToken = z.string().regex(/^cat-[a-z-]+$/);
const sortOrder = z.number().int().min(0).max(99);
const ruleFields = z.object({
  match: z.string().trim().min(1).max(120),
  displayMerchant: z.string().trim().min(1).max(120),
  category: name,
});
const settingKey = z.enum(["openrouter_model", "openrouter_daily_cap"]);
const settingsSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("openrouter_model"), value: z.string().trim().max(100) }),
  z.object({ key: z.literal("openrouter_daily_cap"), value: z.enum(["50", "100", "200", "500"]) }),
]);

export const getSettings = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb();
  const keys = [...settingKey.options, "last_ingest_at"];
  const entries = await Promise.all(keys.map(async (key) => [key, await getMeta(db, key)] as const));
  // Count is type-scoped: income categories count income rows, expense categories count the rest.
  const transactionCount = count(transactions.id);
  const aiOn = process.env.KHARCHA_AI === "on";
  const ai = await aiConfig(db);
  return {
    categories: await db.select({ name: categories.name, type: categories.type, colorToken: categories.colorToken, sortOrder: categories.sortOrder, transactionCount })
      .from(categories)
      .leftJoin(transactions, and(eq(transactions.category, categories.name), isNull(transactions.deletedAt), sql`((${categories.type} = 'income') = (${transactions.type} = 'income'))`))
      .groupBy(categories.name, categories.type)
      .orderBy(categories.type, categories.sortOrder),

    rules: await db.select().from(merchantRules).orderBy(desc(merchantRules.id)),
    values: Object.fromEntries(entries),
    aiOn,
    ai,
    costs: await modelCosts(db, aiOn),
  };
});

// Real counts for the delete sheet. Same scoping rules as deleteCategory.
export const getCategoryDeleteCounts = createServerFn({ method: "GET" })
  .validator(z.object({ name, type }))
  .handler(async ({ data }) => {
    const db = getDb();
    const ofType = data.type === "income" ? eq(transactions.type, "income") : ne(transactions.type, "income");
    const shared = await db.select({ name: categories.name }).from(categories).where(and(eq(categories.name, data.name), ne(categories.type, data.type))).get();
    const [txns, budget, rules] = await Promise.all([
      db.select({ count: count() }).from(transactions).where(and(eq(transactions.category, data.name), isNull(transactions.deletedAt), ofType)).get(),
      data.type === "expense" ? db.select({ count: count() }).from(budgets).where(eq(budgets.category, data.name)).get() : Promise.resolve({ count: 0 }),
      data.type === "expense" || !shared ? db.select({ count: count() }).from(merchantRules).where(eq(merchantRules.category, data.name)).get() : Promise.resolve({ count: 0 }),
    ]);
    return { transactions: txns?.count ?? 0, budgets: budget?.count ?? 0, rules: rules?.count ?? 0 };
  });

export const saveSettings = createServerFn({ method: "POST" })
  .validator(settingsSchema)
  .handler(({ data }) => setMeta(getDb(), data.key, data.value));

// Rename cascades to every denormalized category name in one atomic batch.
// Budgets are keyed by name only, so a clash there rolls the whole batch back.
export const saveCategory = createServerFn({ method: "POST" })
  .validator(z.object({ oldName: name.optional(), name, type, colorToken, sortOrder }))
  .handler(async ({ data }) => {
    const db = getDb();
    if (!data.oldName || data.oldName === data.name) {
      await db.insert(categories).values({ name: data.name, type: data.type, colorToken: data.colorToken, sortOrder: data.sortOrder }).onConflictDoUpdate({ target: [categories.name, categories.type], set: { colorToken: data.colorToken, sortOrder: data.sortOrder } });
      return;
    }
    const clash = await db.select({ name: categories.name }).from(categories).where(and(eq(categories.name, data.name), eq(categories.type, data.type))).get();
    if (clash) throw new Error("A category with that name already exists.");
    // Income and expense can share a name (both have "Other"), so every cascade is scoped by type.
    // Investment rows use expense categories. Budgets are expense-only. Rules carry no type: they follow
    // the expense side when the name is shared, and whichever side owns it otherwise.
    const ofType = data.type === "income" ? eq(transactions.type, "income") : ne(transactions.type, "income");
    const owned = db.select({ id: transactions.id }).from(transactions).where(ofType);
    const shared = await db.select({ name: categories.name }).from(categories).where(and(eq(categories.name, data.oldName), ne(categories.type, data.type))).get();
    const ops = [
      db.update(categories).set({ name: data.name, colorToken: data.colorToken, sortOrder: data.sortOrder }).where(and(eq(categories.name, data.oldName), eq(categories.type, data.type))),
      db.update(transactions).set({ category: data.name }).where(and(eq(transactions.category, data.oldName), ofType)),
      db.update(transactionItems).set({ category: data.name }).where(and(eq(transactionItems.category, data.oldName), inArray(transactionItems.transactionId, owned))),
      db.update(transactionSplits).set({ category: data.name }).where(and(eq(transactionSplits.category, data.oldName), inArray(transactionSplits.transactionId, owned))),
      ...(data.type === "expense" ? [db.update(budgets).set({ category: data.name }).where(eq(budgets.category, data.oldName))] : []),
      ...(data.type === "expense" || !shared ? [db.update(merchantRules).set({ category: data.name }).where(eq(merchantRules.category, data.oldName))] : []),
    ];
    await db.batch(ops as [(typeof ops)[number], ...(typeof ops)[number][]]);
  });

// Moves the category's rows to Other, drops its budget and rules, and removes it in one batch.
// Other (expense and income) is the fallback, so it cannot be deleted.
export const deleteCategory = createServerFn({ method: "POST" })
  .validator(z.object({ name, type }))
  .handler(async ({ data }) => {
    if (data.name === "Other") throw new Error("Other can't be deleted.");
    const db = getDb();
    const ofType = data.type === "income" ? eq(transactions.type, "income") : ne(transactions.type, "income");
    const owned = db.select({ id: transactions.id }).from(transactions).where(ofType);
    const shared = await db.select({ name: categories.name }).from(categories).where(and(eq(categories.name, data.name), ne(categories.type, data.type))).get();
    const ops = [
      db.update(transactions).set({ category: "Other" }).where(and(eq(transactions.category, data.name), ofType)),
      db.update(transactionItems).set({ category: "Other" }).where(and(eq(transactionItems.category, data.name), inArray(transactionItems.transactionId, owned))),
      // A transaction may already hold an "Other" split (PK is transaction_id + category), so fold the amount into it.
      db.insert(transactionSplits).select(db.select({ transactionId: transactionSplits.transactionId, category: sql<string>`'Other'`.as("category"), amount: transactionSplits.amount }).from(transactionSplits).where(and(eq(transactionSplits.category, data.name), inArray(transactionSplits.transactionId, owned))))
        .onConflictDoUpdate({ target: [transactionSplits.transactionId, transactionSplits.category], set: { amount: sql`${transactionSplits.amount} + excluded.amount` } }),
      db.delete(transactionSplits).where(and(eq(transactionSplits.category, data.name), inArray(transactionSplits.transactionId, owned))),
      ...(data.type === "expense" ? [db.delete(budgets).where(eq(budgets.category, data.name))] : []),
      ...(data.type === "expense" || !shared ? [db.delete(merchantRules).where(eq(merchantRules.category, data.name))] : []),
      db.delete(categories).where(and(eq(categories.name, data.name), eq(categories.type, data.type))),
    ];
    await db.batch(ops as [(typeof ops)[number], ...(typeof ops)[number][]]);
  });

// One atomic batch for all sortOrder writes, so a drag-reorder never half-applies.
export const reorderCategories = createServerFn({ method: "POST" })
  .validator(z.object({ items: z.array(z.object({ name, type, sortOrder })).min(1).max(200) }))
  .handler(async ({ data }) => {
    const db = getDb();
    const ops = data.items.map((x) => db.update(categories).set({ sortOrder: x.sortOrder }).where(and(eq(categories.name, x.name), eq(categories.type, x.type))));
    await db.batch(ops as [(typeof ops)[number], ...(typeof ops)[number][]]);
  });

export const updateRule = createServerFn({ method: "POST" })
  .validator(ruleFields.extend({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const { id, ...set } = data;
    await getDb().update(merchantRules).set(set).where(eq(merchantRules.id, id));
  });

// Returns the deleted row so the client can offer undo via restoreRule.
export const removeRule = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const db = getDb();
    const row = await db.select().from(merchantRules).where(eq(merchantRules.id, data.id)).get();
    if (!row) return null;
    await db.delete(merchantRules).where(eq(merchantRules.id, data.id));
    return row;
  });

export const restoreRule = createServerFn({ method: "POST" })
  .validator(ruleFields.extend({ id: z.number().int().positive(), createdFromTxnId: z.number().int().nullable() }))
  .handler(async ({ data }) => {
    await getDb().insert(merchantRules).values(data).onConflictDoNothing();
  });

