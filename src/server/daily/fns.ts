import { createServerFn } from "@tanstack/react-start";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { categoryList, getMeta } from "../db/queries";
import { attachments, categories, transactionItems, transactionSplits, transactions, trips } from "../db/schema";
import { receiptSplitMatches, scrubItemName } from "../ai/receipt";
import { afterWrite } from "../jobs";
import { parseMessage } from "../parsers/index.ts";

const id = z.object({ id: z.number().int().positive() });
const live = isNull(transactions.deletedAt);

export const getLastIngestAt = createServerFn({ method: "GET" }).handler(async () => ({
  lastIngestAt: (await getMeta(getDb(), "last_ingest_at")) ?? null,
}));

export const getReview = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb();
  const rows = await db.select().from(transactions).where(and(live, eq(transactions.needsReview, true))).orderBy(desc(transactions.date)).limit(500); // ponytail: badge counts all; page past 500 if a backlog ever gets that big.
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
  const [more, files, items, splits, categoryRows] = await Promise.all([
    db.select().from(transactions).where(and(live, eq(transactions.merchant, txn.merchant), sql`${transactions.id} != ${txn.id}`)).orderBy(desc(transactions.date)).limit(5),
    db.select().from(attachments).where(eq(attachments.transactionId, txn.id)),
    db.select().from(transactionItems).where(eq(transactionItems.transactionId, txn.id)).orderBy(transactionItems.sortOrder),
    db.select().from(transactionSplits).where(eq(transactionSplits.transactionId, txn.id)),
    db.select({ name: categories.name, colorToken: categories.colorToken }).from(categories),
  ]);
  return { txn, more, files, items, splits, categoryColors: Object.fromEntries(categoryRows.map((row) => [row.name, row.colorToken])) };
});

const receiptSchema = z.object({ id: z.number().int().positive(), split: z.boolean(), items: z.array(z.object({ name: z.string().trim().min(1).max(120), qty: z.number().positive().nullable(), amount: z.number().positive(), category: z.string().min(1).max(40), source: z.enum(["ai", "manual", "adjustment"]).optional(), confidence: z.number().min(0).max(1).nullable().optional() })).max(100) });
export const saveReceipt = createServerFn({ method: "POST" }).validator(receiptSchema).handler(async ({ data }) => {
  const db = getDb();
  const txn = await db.select({ amount: transactions.amount, type: transactions.type }).from(transactions).where(and(eq(transactions.id, data.id), live)).get();
  if (!txn) throw new Error("Transaction not found.");
  const known = new Set((await db.select({ name: categories.name }).from(categories).where(eq(categories.type, txn.type === "income" ? "income" : "expense"))).map((row) => row.name));
  if (data.items.some((row) => !known.has(row.category))) throw new Error("Unknown category.");
  const cleanItems = data.items.map((item, sortOrder) => ({ ...item, name: scrubItemName(item.name), transactionId: data.id, source: item.source ?? "manual" as const, confidence: item.confidence ?? null, sortOrder }));
  if (cleanItems.some((item) => !item.name)) throw new Error("Item name is empty after private-data removal.");
  // Splits are derived here, never trusted from the client.
  const grouped = new Map<string, number>();
  for (const item of cleanItems) grouped.set(item.category, (grouped.get(item.category) ?? 0) + item.amount);
  const splits = data.split ? [...grouped].map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 })) : [];
  if (data.split && !receiptSplitMatches(txn.amount, splits)) throw new Error("Splits must equal transaction amount.");
  const operations = [
    db.delete(transactionItems).where(eq(transactionItems.transactionId, data.id)),
    db.delete(transactionSplits).where(eq(transactionSplits.transactionId, data.id)),
    ...(cleanItems.length ? [db.insert(transactionItems).values(cleanItems)] : []),
    ...(splits.length ? [db.insert(transactionSplits).values(splits.map((item) => ({ ...item, transactionId: data.id })))] : []),
  ];
  await db.batch(operations as [typeof operations[number], ...typeof operations[number][]]);
});

export const removeSplit = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const db = getDb();
    await db.delete(transactionSplits).where(eq(transactionSplits.transactionId, data.id));
    return { ok: true };
  });

const pastedSchema = z.object({ text: z.string().trim().min(1).max(2000), bank: z.enum(["axis", "hdfc", "indusind"]).optional() });
function parseBankText(data: z.infer<typeof pastedSchema>) {
  const keys = data.bank ? [data.bank] : ["axis", "hdfc", "indusind"] as const;
  for (const key of keys) {
    const outcome = parseMessage(key, data.text);
    if (!outcome.parsed) continue;
    const row = outcome.parsed;
    // Foreign-only SMS has no verified INR amount. Never book its foreign figure as rupees.
    if (row.currency && row.currency !== "INR") return { status: "foreign" as const, ...row, bankName: outcome.bankName };
    if (!Number.isFinite(row.amount) || row.amount <= 0) return null;
    return { status: "parsed" as const, type: row.type, amount: row.amount, merchant: row.merchant, category: row.category ?? "Other", date: row.date, accountLast4: row.accountLast4, bankName: outcome.bankName };
  }
  return null;
}
export const parsePasted = createServerFn({ method: "POST" }).validator(pastedSchema).handler(({ data }) => parseBankText(data));

export const savePasted = createServerFn({ method: "POST" }).validator(pastedSchema).handler(async ({ data }) => {
  const parsed = parseBankText(data);
  if (!parsed || parsed.status !== "parsed") throw new Error("Message needs manual entry.");
  const db = getDb();
  const known = await db.select({ name: categories.name }).from(categories).where(eq(categories.type, parsed.type === "income" ? "income" : "expense"));
  const isTransfer = parsed.category === "Credit Card Payment";
  const category = known.some((item) => item.name === parsed.category) ? parsed.category : "Other";
  const [row] = await db.insert(transactions).values({
    source: "paste", type: parsed.type, amount: parsed.amount, merchant: parsed.merchant,
    rawMerchant: parsed.merchant, category, date: parsed.date ?? new Date().toISOString().slice(0, 16).replace("T", " "),
    rawText: data.text, bankName: parsed.bankName, accountLast4: parsed.accountLast4 ?? null,
    needsReview: !isTransfer && category === "Other", excluded: isTransfer,
    editedAt: sql`datetime('now')`,
  }).returning({ id: transactions.id });
  if (!row) throw new Error("Could not save transaction.");
  await afterWrite([row.id], db);
  return row.id;
});
