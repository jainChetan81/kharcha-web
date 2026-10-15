import { and, between, count, desc, eq, isNotNull, isNull, like, ne, or, sql, sum } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./client.ts";
import { budgets, meta, TXN_TYPES, transactions } from "./schema.ts";

const dateTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

// Row shape kharcha-mini pushes (its drizzle select, camelCase). Unknown keys are dropped.
export const miniRowSchema = z.object({
  id: z.number().int().positive(),
  type: z.enum(TXN_TYPES),
  amount: z.number().nonnegative(),
  merchant: z.string(),
  merchantCanonical: z.string().nullish(),
  category: z.string().nullish(),
  // Old manual rows in the mini are date-only; normalise to midnight.
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?$/)
    .transform((d) => (d.length === 10 ? `${d} 00:00` : d)),
  rawText: z.string(),
  bankName: z.string().nullish(),
  parsedBy: z.string(),
  referenceNumber: z.string().nullish(),
  accountLast4: z.string().nullish(),
  currency: z.string().nullish(),
  originalAmount: z.number().nullish(),
  needsReview: z.number().int().optional(),
  deletedAt: z.string().nullish(),
});
export type MiniRow = z.output<typeof miniRowSchema>;

const live = isNull(transactions.deletedAt);

/** Keep the app's value once a human edited the row; otherwise take the mini's. */
const mini = (column: string) =>
  sql.raw(`CASE WHEN "transactions"."edited_at" IS NULL THEN excluded."${column}" ELSE "transactions"."${column}" END`);
const inMonth = (month: string) => between(transactions.date, `${month}-01`, `${month}-31 99:99`);

/** Upsert pushed rows by mini_id atomically. A tombstone from either side sticks. */
export async function ingest(db: Db, rows: MiniRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const upserts = rows.map((r) =>
    db
      .insert(transactions)
      .values({
        miniId: r.id,
        source: "sms",
        type: r.type,
        amount: r.amount,
        merchant: r.merchantCanonical || r.merchant,
        category: r.category || null,
        date: r.date,
        rawText: r.rawText,
        bankName: r.bankName ?? null,
        accountLast4: r.accountLast4 ?? null,
        referenceNumber: r.referenceNumber ?? null,
        parsedBy: r.parsedBy,
        currency: r.currency ?? null,
        originalAmount: r.originalAmount ?? null,
        needsReview: r.needsReview === 1,
        deletedAt: r.deletedAt ?? null,
      })
      .onConflictDoUpdate({
        target: transactions.miniId,
        set: {
          deletedAt: sql`COALESCE(excluded."deleted_at", "transactions"."deleted_at")`,
          type: mini("type"),
          amount: mini("amount"),
          merchant: mini("merchant"),
          category: mini("category"),
          date: mini("date"),
          needsReview: mini("needs_review"),
          rawText: sql`excluded."raw_text"`,
        },
      }),
  );
  const stamp = db
    .insert(meta)
    .values({ key: "last_ingest_at", value: new Date().toISOString() })
    .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded."value"` } });
  await db.batch([stamp, ...upserts]);
  return rows.length;
}

export const editSchema = z.object({
  id: z.number().int().positive(),
  merchant: z.string().trim().min(1).max(120),
  category: z.string().trim().max(40),
  amount: z.number().positive().max(1e9),
  type: z.enum(TXN_TYPES),
});

export async function editTxn(db: Db, e: z.infer<typeof editSchema>): Promise<void> {
  await db
    .update(transactions)
    .set({
      merchant: e.merchant,
      category: e.category || null,
      amount: e.amount,
      type: e.type,
      needsReview: false,
      editedAt: sql`(datetime('now'))`,
    })
    .where(eq(transactions.id, e.id));
}

export const addSchema = z.object({
  type: z.enum(TXN_TYPES),
  amount: z.number().positive().max(1e9),
  merchant: z.string().trim().min(1).max(120),
  category: z.string().trim().max(40),
  date: dateTime,
});

export async function addTxn(db: Db, a: z.infer<typeof addSchema>): Promise<void> {
  await db.insert(transactions).values({
    source: "manual",
    type: a.type,
    amount: a.amount,
    merchant: a.merchant,
    category: a.category || null,
    date: a.date,
    editedAt: sql`(datetime('now'))`,
  });
}

export async function removeTxn(db: Db, id: number): Promise<void> {
  await db
    .update(transactions)
    .set({ deletedAt: sql`(datetime('now'))`, editedAt: sql`(datetime('now'))` })
    .where(eq(transactions.id, id));
}

export async function monthSummary(db: Db, month: string) {
  const [totals, byCategory, [review], [last], limits] = await Promise.all([
    db
      .select({ type: transactions.type, total: sum(transactions.amount).mapWith(Number), n: count() })
      .from(transactions)
      .where(and(live, inMonth(month)))
      .groupBy(transactions.type),
    db
      .select({
        category: sql<string>`COALESCE(${transactions.category}, 'Uncategorised')`,
        total: sum(transactions.amount).mapWith(Number),
        n: count(),
      })
      .from(transactions)
      .where(and(live, eq(transactions.type, "expense"), inMonth(month)))
      .groupBy(sql`1`)
      .orderBy(desc(sql`2`)),
    db.select({ n: count() }).from(transactions).where(and(live, eq(transactions.needsReview, true))),
    db.select({ value: meta.value }).from(meta).where(eq(meta.key, "last_ingest_at")),
    db.select().from(budgets),
  ]);
  const limitOf = new Map(limits.map((b) => [b.category, b.monthlyLimit]));
  const categories = byCategory.map((c) => ({ ...c, limit: limitOf.get(c.category) ?? null }));
  // Budgeted categories with no spend yet still show up.
  for (const b of limits)
    if (!categories.some((c) => c.category === b.category))
      categories.push({ category: b.category, total: 0, n: 0, limit: b.monthlyLimit });
  return { month, totals, categories, reviewCount: review?.n ?? 0, lastIngestAt: last?.value ?? null };
}

export const listSchema = z.object({
  month: monthSchema.optional(),
  search: z.string().trim().max(60).optional(),
  review: z.boolean().optional(),
});

/** withRaw adds the SMS text; only History's edit dialog needs it. */
export function listTxns(db: Db, q: z.infer<typeof listSchema> & { limit: number; withRaw?: boolean }) {
  const where = [live];
  if (q.month) where.push(inMonth(q.month));
  if (q.search) {
    const p = `%${q.search}%`;
    const match = or(like(transactions.merchant, p), like(transactions.category, p), like(transactions.rawText, p));
    if (match) where.push(match);
  }
  if (q.review) where.push(eq(transactions.needsReview, true));
  return db
    .select({
      id: transactions.id,
      source: transactions.source,
      type: transactions.type,
      amount: transactions.amount,
      merchant: transactions.merchant,
      category: transactions.category,
      date: transactions.date,
      accountLast4: transactions.accountLast4,
      rawText: q.withRaw ? transactions.rawText : sql<null>`NULL`,
      needsReview: transactions.needsReview,
    })
    .from(transactions)
    .where(and(...where))
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(q.limit);
}
export type TxnRow = Awaited<ReturnType<typeof listTxns>>[number];

export async function categoryNames(db: Db): Promise<string[]> {
  const rows = await db
    .select({ category: transactions.category })
    .from(transactions)
    .where(and(isNotNull(transactions.category), ne(transactions.category, "")))
    .groupBy(transactions.category)
    .orderBy(desc(count()));
  return rows.flatMap((r) => (r.category ? [r.category] : []));
}

export const budgetSchema = z.object({
  category: z.string().trim().min(1).max(40),
  // 0 removes the budget.
  monthlyLimit: z.number().min(0).max(1e9),
});

export async function setBudget(db: Db, b: z.infer<typeof budgetSchema>): Promise<void> {
  if (b.monthlyLimit === 0) {
    await db.delete(budgets).where(eq(budgets.category, b.category));
    return;
  }
  await db
    .insert(budgets)
    .values({ category: b.category, monthlyLimit: b.monthlyLimit })
    .onConflictDoUpdate({
      target: budgets.category,
      set: { monthlyLimit: b.monthlyLimit, updatedAt: sql`(datetime('now'))` },
    });
}

export async function health(db: Db) {
  const [[rows], [last]] = await Promise.all([
    db.select({ n: count() }).from(transactions),
    db.select({ value: meta.value }).from(meta).where(eq(meta.key, "last_ingest_at")),
  ]);
  return { ok: true, rows: rows?.n ?? 0, lastIngestAt: last?.value ?? null };
}
