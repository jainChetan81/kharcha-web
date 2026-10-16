import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { aiConfig } from "../ai/client";
import { categoryList, getMeta, setMeta } from "../db/queries";
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
const settingKey = z.enum(["openrouter_model", "openrouter_vision_model", "openrouter_daily_cap"]);
const settingsSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("openrouter_model"), value: z.string().trim().max(100) }),
  z.object({ key: z.literal("openrouter_vision_model"), value: z.string().trim().max(100) }),
  z.object({ key: z.literal("openrouter_daily_cap"), value: z.string().regex(/^\d{0,3}$/).refine((value) => Number(value) <= 500, "Daily cap must be at most 500") }),
]);

export const getSettings = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb();
  const keys = [...settingKey.options, "last_ingest_at"];
  const entries = await Promise.all(keys.map(async (key) => [key, await getMeta(db, key)] as const));
  return {
    categories: await categoryList(db),
    rules: await db.select().from(merchantRules).orderBy(desc(merchantRules.id)),
    values: Object.fromEntries(entries),
    aiOn: process.env.KHARCHA_AI === "on",
    ai: await aiConfig(db),
  };
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
    await db.batch([
      db.update(categories).set({ name: data.name, colorToken: data.colorToken, sortOrder: data.sortOrder }).where(and(eq(categories.name, data.oldName), eq(categories.type, data.type))),
      db.update(transactions).set({ category: data.name }).where(eq(transactions.category, data.oldName)),
      db.update(budgets).set({ category: data.name }).where(eq(budgets.category, data.oldName)),
      db.update(merchantRules).set({ category: data.name }).where(eq(merchantRules.category, data.oldName)),
      db.update(transactionItems).set({ category: data.name }).where(eq(transactionItems.category, data.oldName)),
      db.update(transactionSplits).set({ category: data.name }).where(eq(transactionSplits.category, data.oldName)),
    ]);
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

