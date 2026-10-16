import { createServerFn } from "@tanstack/react-start";
import { and, asc, count, desc, eq, gte, isNull, lte, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { categoryList, getMeta, monthBounds, setMeta, spendByCategory } from "../db/queries";
import { attachments, categories, merchantRules, transactionItems, transactionSplits, transactions, trips } from "../db/schema";

const id = z.object({ id: z.number().int().positive() });
const month = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
const live = isNull(transactions.deletedAt);

export const getToday = createServerFn({ method: "GET" }).validator(month).handler(async ({ data }) => {
  const db = getDb();
  const [from, to] = monthBounds(data.month);
  const [summary, rows, lastRows] = await Promise.all([
    spendByCategory(db, from, to),
    db.select({ date: transactions.date, amount: transactions.amount, merchant: transactions.merchant }).from(transactions).where(and(live, eq(transactions.type, "expense"), eq(transactions.excluded, false), gte(transactions.date, from), lte(transactions.date, `${to} 00:00`))).orderBy(asc(transactions.date)),
    db.select().from(transactions).where(live).orderBy(desc(transactions.date), desc(transactions.id)).limit(5),
  ]);
  const limits = await db.select({ total: sum(sql`monthly_limit`) }).from((await import("../db/schema")).budgets);
  const spent = summary.reduce((n, x) => n + x.total, 0);
  return { spent, limit: Number(limits[0]?.total ?? 0), categories: summary, points: rows, recent: lastRows };
});

export const getReview = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb();
  const rows = await db.select().from(transactions).where(and(live, eq(transactions.needsReview, true))).orderBy(desc(transactions.date)).limit(100);
  const reviewed = await db.select({ merchant: transactions.merchant, category: transactions.category, n: count() }).from(transactions).where(and(live, eq(transactions.needsReview, false), sql`${transactions.category} IS NOT NULL`)).groupBy(transactions.merchant, transactions.category).orderBy(desc(count()));
  const suggestion = new Map<string, string>();
  for (const x of reviewed) if (x.category && !suggestion.has(x.merchant)) suggestion.set(x.merchant, x.category);
  return rows.map((row) => ({ ...row, suggestion: suggestion.get(row.merchant) ?? "Other" }));
});

export const getActivityMeta = createServerFn({ method: "GET" }).handler(async () => ({
  categories: await categoryList(getDb()),
  trips: await getDb().select({ id: trips.id, name: trips.name }).from(trips).where(isNull(trips.endedAt)).orderBy(desc(trips.startDate)),
}));

export const getDetail = createServerFn({ method: "GET" }).validator(id).handler(async ({ data }) => {
  const db = getDb();
  const txn = await db.select().from(transactions).where(and(eq(transactions.id, data.id), live)).get();
  if (!txn) return null;
  const [more, files, items, splits] = await Promise.all([
    db.select().from(transactions).where(and(live, eq(transactions.merchant, txn.merchant), sql`${transactions.id} != ${txn.id}`)).orderBy(desc(transactions.date)).limit(5),
    db.select().from(attachments).where(eq(attachments.transactionId, txn.id)),
    db.select().from(transactionItems).where(eq(transactionItems.transactionId, txn.id)),
    db.select().from(transactionSplits).where(eq(transactionSplits.transactionId, txn.id)),
  ]);
  return { txn, more, files, items, splits };
});

export const getSettings = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb();
  const keys = ["openrouter_model", "openrouter_vision_model", "openrouter_daily_cap", `ai_calls_${new Date().toISOString().slice(0, 10)}`, "last_ingest_at"];
  const values = Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await getMeta(db, key)])));
  return { categories: await categoryList(db), rules: await db.select().from(merchantRules).orderBy(desc(merchantRules.id)), values, aiOn: process.env.KHARCHA_AI === "on" };
});

export const saveSettings = createServerFn({ method: "POST" }).validator(z.object({ key: z.enum(["openrouter_model", "openrouter_vision_model", "openrouter_daily_cap"]), value: z.string().max(100) })).handler(({ data }) => setMeta(getDb(), data.key, data.value));
export const saveCategory = createServerFn({ method: "POST" }).validator(z.object({ oldName: z.string().max(40).optional(), name: z.string().trim().min(1).max(40), type: z.enum(["expense", "income"]), colorToken: z.string().regex(/^cat-[a-z-]+$/), sortOrder: z.number().int().min(0).max(99) })).handler(async ({ data }) => {
  const db = getDb();
  if (data.oldName && data.oldName !== data.name) {
    await db.update(categories).set({ name: data.name, colorToken: data.colorToken, sortOrder: data.sortOrder }).where(and(eq(categories.name, data.oldName), eq(categories.type, data.type)));
    await db.update(transactions).set({ category: data.name }).where(eq(transactions.category, data.oldName));
    await db.update(merchantRules).set({ category: data.name }).where(eq(merchantRules.category, data.oldName));
  } else await db.insert(categories).values({ name: data.name, type: data.type, colorToken: data.colorToken, sortOrder: data.sortOrder }).onConflictDoUpdate({ target: [categories.name, categories.type], set: { colorToken: data.colorToken, sortOrder: data.sortOrder } });
});
export const deleteRule = createServerFn({ method: "POST" }).validator(z.object({ id: z.number().int().positive() })).handler(async ({ data }) => { await getDb().delete(merchantRules).where(eq(merchantRules.id, data.id)); });

const receiptSchema = z.object({ id: z.number().int().positive(), items: z.array(z.object({ name: z.string().trim().min(1).max(120), qty: z.number().positive().nullable(), amount: z.number().positive(), category: z.string().min(1).max(40) })).max(100), splits: z.array(z.object({ category: z.string().min(1).max(40), amount: z.number().positive() })).max(30) });
export const saveReceipt = createServerFn({ method: "POST" }).validator(receiptSchema).handler(async ({ data }) => {
  const db = getDb();
  const txn = await db.select({ amount: transactions.amount }).from(transactions).where(eq(transactions.id, data.id)).get();
  if (!txn) throw new Error("Transaction not found.");
  if (data.splits.length && Math.abs(data.splits.reduce((n, x) => n + x.amount, 0) - txn.amount) > 0.01) throw new Error("Splits must equal transaction amount.");
  await db.delete(transactionItems).where(eq(transactionItems.transactionId, data.id));
  await db.delete(transactionSplits).where(eq(transactionSplits.transactionId, data.id));
  if (data.items.length) await db.insert(transactionItems).values(data.items.map((x) => ({ ...x, transactionId: data.id, source: "manual" as const })));
  if (data.splits.length) await db.insert(transactionSplits).values(data.splits.map((x) => ({ ...x, transactionId: data.id })));
});

export const parsePasted = createServerFn({ method: "POST" }).validator(z.object({ text: z.string().trim().min(1).max(2000) })).handler(({ data }) => {
  const amount = data.text.match(/(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1]?.replaceAll(",", "");
  const merchant = data.text.match(/(?:at|to)\s+([A-Z][A-Z .&'-]{2,}?)(?:\s+on|\.|,)/i)?.[1]?.trim();
  if (!amount || !merchant) return null;
  const card = data.text.match(/(?:xx|\*{2,})\s?(\d{4})/i)?.[1];
  return { amount: Number(amount), merchant: merchant.replace(/\s+/g, " "), accountLast4: card, type: "expense" as const, category: "Other", rawText: data.text };
});
