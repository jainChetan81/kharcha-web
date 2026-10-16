import { and, count, desc, eq, gte, inArray, isNull, like, lt, or, sql, sum } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./client.ts";
import { budgets, categories, merchantRules, meta, TXN_TYPES, transactions, type MerchantRule } from "./schema.ts";

/** True when "YYYY-MM-DD[ HH:mm]" is a real calendar date and time. */
function realDate(value: string): boolean {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== m - 1 || day.getUTCDate() !== d) return false;
  if (value.length === 10) return true;
  const [h, min] = value.slice(11).split(":").map(Number);
  return h < 24 && min < 60;
}
const dateTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/).refine(realDate, "not a real date");
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
    .refine(realDate, "not a real date")
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
/** Half-open [first of month, first of next month). */
function inMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  return sql`${gte(transactions.date, `${month}-01`)} AND ${lt(transactions.date, `${next}-01`)}`;
}

/** Mini categories that are transfers, not spend. Kept in the ledger, excluded from totals. */
const TRANSFER_CATEGORIES = new Set(["Credit Card Payment"]);

/** Rule match: case-insensitive; trailing * = starts with, otherwise contains. */
export function ruleMatches(rule: Pick<MerchantRule, "match">, merchant: string): boolean {
  const m = rule.match.trim().toUpperCase();
  const text = merchant.toUpperCase();
  return m.endsWith("*") ? text.startsWith(m.slice(0, -1)) : text.includes(m);
}

/** Upsert pushed rows by mini_id atomically. A tombstone from either side sticks. */
export async function ingest(db: Db, rows: MiniRow[]): Promise<number> {
  // A ₹0 row is a parser miss (OTP, balance alert). Skip it rather than reject the batch, so the mini never retries forever.
  rows = rows.filter((r) => r.amount !== 0 || r.deletedAt);
  const [rules, cats] = await Promise.all([
    db.select().from(merchantRules).orderBy(desc(merchantRules.id)),
    db.select({ name: categories.name, type: categories.type }).from(categories),
  ]);
  const known = (type: string, name: string) => cats.some((c) => c.name === name && c.type === type);
  const upserts = rows.map((r) => {
    const raw = r.merchantCanonical || r.merchant;
    // Newest rule wins. Rules never touch investments; those belong to Wealth.
    const rule = r.type === "investment" ? undefined : rules.find((x) => ruleMatches(x, r.merchant) || ruleMatches(x, raw));
    const excluded = TRANSFER_CATEGORIES.has(r.category ?? "");
    const wanted = rule?.category ?? r.category ?? "";
    // No FK on category: anything unknown files as Other so ingest never fails.
    const category = r.type === "investment" ? r.category || null : known(r.type, wanted) ? wanted : "Other";
    return db
      .insert(transactions)
      .values({
        miniId: r.id,
        source: "sms",
        type: r.type,
        amount: r.amount,
        merchant: rule?.displayMerchant ?? raw,
        rawMerchant: raw,
        category,
        date: r.date,
        rawText: r.rawText,
        bankName: r.bankName ?? null,
        accountLast4: r.accountLast4 ?? null,
        referenceNumber: r.referenceNumber ?? null,
        parsedBy: r.parsedBy,
        currency: r.currency ?? null,
        originalAmount: r.originalAmount ?? null,
        needsReview: rule ? false : r.needsReview === 1,
        excluded,
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
          excluded: mini("excluded"),
          rawMerchant: sql`excluded."raw_merchant"`,
          rawText: sql`excluded."raw_text"`,
        },
      });
  });
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
  excluded: z.boolean().optional(),
  date: dateTime.optional(),
});

export async function editTxn(db: Db, e: z.infer<typeof editSchema>): Promise<void> {
  await db
    .update(transactions)
    .set({
      merchant: e.merchant,
      category: e.category || null,
      amount: e.amount,
      type: e.type,
      ...(e.excluded === undefined ? {} : { excluded: e.excluded }),
      ...(e.date ? { date: e.date } : {}),
      needsReview: false,
      editedAt: sql`(datetime('now'))`,
    })
    .where(eq(transactions.id, e.id));
}

/** Review actions that touch one flag only. */
export const flagSchema = z.object({
  id: z.number().int().positive(),
  excluded: z.boolean().optional(),
  duplicateOf: z.number().int().positive().nullable().optional(),
  needsReview: z.boolean().optional(),
  category: z.string().trim().min(1).max(40).optional(),
});
export async function flagTxn(db: Db, f: z.infer<typeof flagSchema>): Promise<void> {
  const { id, ...set } = f;
  await db.update(transactions).set({ ...set, editedAt: sql`(datetime('now'))` }).where(eq(transactions.id, id));
}

export const addSchema = z.object({
  type: z.enum(TXN_TYPES),
  amount: z.number().positive().max(1e9),
  merchant: z.string().trim().min(1).max(120),
  category: z.string().trim().max(40),
  date: dateTime,
  source: z.enum(["manual", "paste"]).optional(),
  rawText: z.string().max(2000).optional(),
  accountLast4: z.string().regex(/^\d{4}$/).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  originalAmount: z.number().positive().optional(),
});

/** Returns the new row id. */
export async function addTxn(db: Db, a: z.infer<typeof addSchema>): Promise<number> {
  const [row] = await db
    .insert(transactions)
    .values({
      source: a.source ?? "manual",
      type: a.type,
      amount: a.amount,
      merchant: a.merchant,
      category: a.category || null,
      date: a.date,
      rawText: a.rawText ?? null,
      accountLast4: a.accountLast4 ?? null,
      currency: a.currency ?? null,
      originalAmount: a.originalAmount ?? null,
      editedAt: sql`(datetime('now'))`,
    })
    .returning({ id: transactions.id });
  return row?.id ?? 0;
}

export async function removeTxn(db: Db, id: number): Promise<void> {
  await db
    .update(transactions)
    .set({ deletedAt: sql`(datetime('now'))`, editedAt: sql`(datetime('now'))` })
    .where(eq(transactions.id, id));
}

/** Undo for a delete: clears the app tombstone. A mini tombstone would come back on the next push anyway. */
export async function restoreTxn(db: Db, id: number): Promise<void> {
  await db.update(transactions).set({ deletedAt: null }).where(eq(transactions.id, id));
}

/** Rows that count as spend: live, expense, not excluded, not a duplicate. */
export const spendable = and(live, eq(transactions.type, "expense"), eq(transactions.excluded, false), isNull(transactions.duplicateOf));

/**
 * Spend per category for a period. Rows with splits count per split (§7: budgets use splits).
 * from/to are "YYYY-MM-DD", half-open.
 */
export async function spendByCategory(db: Db, from: string, to: string): Promise<{ category: string; total: number; n: number }[]> {
  const rows = await db.all<{ category: string; total: number; n: number }>(sql`
    SELECT COALESCE(s.category, t.category, 'Other') AS category, SUM(COALESCE(s.amount, t.amount)) AS total, COUNT(DISTINCT t.id) AS n
    FROM transactions t LEFT JOIN transaction_splits s ON s.transaction_id = t.id
    WHERE t.deleted_at IS NULL AND t.type = 'expense' AND t.excluded = 0 AND t.duplicate_of IS NULL
      AND t.date >= ${from} AND t.date < ${to}
    GROUP BY 1 ORDER BY 2 DESC`);
  return rows.map((r) => (Array.isArray(r) ? { category: String(r[0]), total: Number(r[1]), n: Number(r[2]) } : r));
}

export function monthBounds(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  return [`${month}-01`, `${new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)}-01`];
}

export async function monthSummary(db: Db, month: string) {
  const [from, to] = monthBounds(month);
  const [totals, byCategory, [review], [last], limits] = await Promise.all([
    db
      .select({ type: transactions.type, total: sum(transactions.amount).mapWith(Number), n: count() })
      .from(transactions)
      .where(and(live, eq(transactions.excluded, false), isNull(transactions.duplicateOf), inMonth(month)))
      .groupBy(transactions.type),
    spendByCategory(db, from, to),
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
  category: z.string().trim().max(40).optional(),
  card: z.string().regex(/^\d{4}$/).optional(),
  type: z.enum(TXN_TYPES).optional(),
  tripId: z.number().int().positive().optional(),
  merchant: z.string().trim().max(120).optional(),
  ids: z.array(z.number().int().positive()).max(500).optional(),
});
export type ListQuery = z.infer<typeof listSchema>;

/** withRaw adds the SMS text; only Detail, Review and Activity's pane need it. */
export function listTxns(db: Db, q: ListQuery & { limit: number; withRaw?: boolean }) {
  const where = [live];
  if (q.month) where.push(inMonth(q.month));
  if (q.search) {
    const p = `%${q.search}%`;
    const match = or(like(transactions.merchant, p), like(transactions.category, p), like(transactions.rawText, p));
    if (match) where.push(match);
  }
  if (q.review) where.push(eq(transactions.needsReview, true));
  if (q.category) where.push(eq(transactions.category, q.category));
  if (q.card) where.push(eq(transactions.accountLast4, q.card));
  if (q.type) where.push(eq(transactions.type, q.type));
  if (q.merchant) where.push(eq(transactions.merchant, q.merchant));
  if (q.ids) where.push(inArray(transactions.id, q.ids.length ? q.ids : [0]));
  if (q.tripId)
    where.push(sql`${transactions.id} IN (SELECT transaction_id FROM transaction_trips WHERE trip_id = ${q.tripId})`);
  return db
    .select({
      id: transactions.id,
      source: transactions.source,
      type: transactions.type,
      amount: transactions.amount,
      merchant: transactions.merchant,
      rawMerchant: transactions.rawMerchant,
      category: transactions.category,
      date: transactions.date,
      accountLast4: transactions.accountLast4,
      bankName: transactions.bankName,
      currency: transactions.currency,
      originalAmount: transactions.originalAmount,
      rawText: q.withRaw ? transactions.rawText : sql<null>`NULL`,
      needsReview: transactions.needsReview,
      excluded: transactions.excluded,
      duplicateOf: transactions.duplicateOf,
    })
    .from(transactions)
    .where(and(...where))
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(q.limit);
}


export async function getTxn(db: Db, id: number) {
  const [row] = await listTxns(db, { ids: [id], limit: 1, withRaw: true });
  return row;
}

/** Categories table in display order; expense first. */
export function categoryList(db: Db) {
  return db.select().from(categories).orderBy(categories.type, categories.sortOrder);
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

/** "Always file X as Y": one rule, applied to this and future rows. Past rows are not rewritten. */
export const ruleSchema = z.object({
  match: z.string().trim().min(2).max(120),
  displayMerchant: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(40),
  createdFromTxnId: z.number().int().positive().optional(),
});
export async function addRule(db: Db, r: z.infer<typeof ruleSchema>): Promise<number> {
  const [row] = await db.insert(merchantRules).values(r).returning({ id: merchantRules.id });
  return row?.id ?? 0;
}

export async function getMeta(db: Db, key: string): Promise<string | undefined> {
  const row = await db.select({ value: meta.value }).from(meta).where(eq(meta.key, key)).get();
  return row?.value;
}
export async function setMeta(db: Db, key: string, value: string): Promise<void> {
  await db.insert(meta).values({ key, value }).onConflictDoUpdate({ target: meta.key, set: { value } });
}

export async function health(db: Db) {
  const [[rows], [last]] = await Promise.all([
    db.select({ n: count() }).from(transactions),
    db.select({ value: meta.value }).from(meta).where(eq(meta.key, "last_ingest_at")),
  ]);
  return { ok: true, rows: rows?.n ?? 0, lastIngestAt: last?.value ?? null };
}
