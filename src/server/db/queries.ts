import { and, count, desc, eq, gte, inArray, isNull, like, lt, lte, or, sql, sum } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./client.ts";
import { budgets, categories, merchantRules, meta, TXN_TYPES, transactions, transactionSplits, type MerchantRule } from "./schema.ts";

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

// DESIGN.md §15. Correlated subqueries, so joins never multiply ledger rows. Cancelled claims and their links are ignored.
const claimedOf = (t: string) =>
  `COALESCE((SELECT SUM(r.amount) FROM reimbursements r WHERE r.transaction_id = ${t}.id AND r.status != 'cancelled'), 0)`;
const linkedOf = (t: string) =>
  `COALESCE((SELECT SUM(l.amount) FROM reimbursement_links l JOIN reimbursements r ON r.id = l.reimbursement_id WHERE l.credit_transaction_id = ${t}.id AND r.status != 'cancelled'), 0)`;
/** Links beyond their claim, split across the links pro rata. Counts as income in the month the credit arrived. */
const extraOf = (t: string) =>
  `COALESCE((SELECT SUM(l.amount * MAX(0, (SELECT SUM(l2.amount) FROM reimbursement_links l2 WHERE l2.reimbursement_id = r.id) - r.amount) / (SELECT SUM(l2.amount) FROM reimbursement_links l2 WHERE l2.reimbursement_id = r.id)) FROM reimbursement_links l JOIN reimbursements r ON r.id = l.reimbursement_id WHERE l.credit_transaction_id = ${t}.id AND r.status != 'cancelled'), 0)`;
/** Your share of a spend: amount minus open and settled claims, never below zero. */
const shareOf = (t: string) => `MAX(0, ${t}.amount - ${claimedOf(t)})`;
export const shareSql = (t = "transactions") => sql<number>`${sql.raw(shareOf(t))}`.mapWith(Number);
/** Per-row counted amount: spend → your share; income → unlinked part plus extra back. */
const countedOf = (t: string) =>
  `CASE WHEN ${t}.type = 'income' THEN ${t}.amount - ${linkedOf(t)} + ${extraOf(t)} WHEN ${t}.type = 'expense' THEN ${shareOf(t)} ELSE ${t}.amount END`;
const countedSql = (t = "transactions") => sql.raw(countedOf(t));

/** Own share of a saved split; item claims reduce only their chosen categories. */
export const splitShareOf = (txn: string, split: string) => `MAX(0, ${split}.amount
          - (SELECT COALESCE(SUM(i.amount), 0) FROM reimbursements r JOIN json_each(r.item_ids) j JOIN transaction_items i ON i.id = CAST(j.value AS INTEGER)
             WHERE r.transaction_id = ${txn}.id AND r.status != 'cancelled' AND r.item_ids IS NOT NULL AND i.category = ${split}.category)
          - (SELECT COALESCE(SUM(r.amount), 0) FROM reimbursements r
             WHERE r.transaction_id = ${txn}.id AND r.status != 'cancelled' AND r.item_ids IS NULL) * ${split}.amount / NULLIF(${txn}.amount, 0))`;

/**
 * Spend per category for a period. Rows with splits count per split (§7: budgets use splits).
 * from/to are "YYYY-MM-DD", half-open.
 */
/** `gross`: spend before claims (used to size the reimbursable hatch on budgets). */
export async function spendByCategory(db: Db, from: string, to: string, gross = false): Promise<{ category: string; total: number; n: number }[]> {
  // Unsplit spend: the row's share. Split spend: each split less the claim on its items, plus its pro rata part of any whole/part claim.
  const filter = sql`t.deleted_at IS NULL AND t.type = 'expense' AND t.excluded = 0 AND t.duplicate_of IS NULL AND t.date >= ${from} AND t.date < ${to}`;
  const unsplitAmt = gross ? "t.amount" : `MAX(0, t.amount - ${claimedOf("t")})`;
  const splitAmt = gross ? "s.amount" : splitShareOf("t", "s");
  const rows = await db.all<{ category: string; total: number; n: number }>(sql`
    SELECT category, SUM(amt) AS total, COUNT(DISTINCT id) AS n FROM (
      SELECT t.id AS id, COALESCE(t.category, 'Other') AS category, ${sql.raw(unsplitAmt)} AS amt
      FROM transactions t
      WHERE ${filter} AND NOT EXISTS (SELECT 1 FROM transaction_splits x WHERE x.transaction_id = t.id)
      UNION ALL
      SELECT t.id, s.category, ${sql.raw(splitAmt)}
      FROM transactions t JOIN transaction_splits s ON s.transaction_id = t.id
      WHERE ${filter}
    ) GROUP BY category ORDER BY total DESC`);
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
      .select({ type: transactions.type, total: sum(countedSql()).mapWith(Number), n: count() })
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

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => realDate(v), "not a real date");
const listShape = z.object({
  month: monthSchema.optional(),
  from: daySchema.optional(),
  to: daySchema.optional(),
  search: z.string().trim().max(60).optional(),
  review: z.boolean().optional(),
  category: z.string().trim().max(49).refine((v) => v.includes(":") ? v.slice(v.lastIndexOf(":") + 1).length <= 40 : v.length <= 40).optional(),
  categories: z.array(z.string().trim().min(1).max(49).refine((v) => v.includes(":") ? v.slice(v.lastIndexOf(":") + 1).length <= 40 : v.length <= 40)).max(40).optional(),
  card: z.string().regex(/^\d{4}$/).optional(),
  type: z.enum([...TXN_TYPES, "transfer"]).optional(),
  min: z.number().finite().min(0).max(1e9).optional(),
  max: z.number().finite().min(0).max(1e9).optional(),
  sort: z.enum(["newest", "oldest", "amount-desc", "amount-asc"]).optional(),
  tripId: z.number().int().positive().optional(),
  merchant: z.string().trim().max(120).optional(),
  ids: z.array(z.number().int().positive()).max(500).optional(),
});
const ordered = <T extends z.ZodType<{ from?: string; to?: string; min?: number; max?: number }>>(schema: T) =>
  schema.refine((q) => !q.from || !q.to || q.from <= q.to, { path: ["to"], message: "to must not precede from" })
    .refine((q) => q.min === undefined || q.max === undefined || q.min <= q.max, { path: ["max"], message: "max must be at least min" });
export const listSchema = ordered(listShape);
export type ListQuery = z.infer<typeof listSchema>;
/** Activity's filters minus list-only keys: what Insights and Ask scope accept. */
export const scopeSchema = ordered(listShape.omit({ sort: true, ids: true, review: true }));
export type Scope = z.infer<typeof scopeSchema>;

export function listWhere(q: ListQuery) {
  const where = [live];
  if (q.from) where.push(gte(transactions.date, `${q.from} 00`));
  if (q.to) where.push(lt(transactions.date, `${q.to} 24`));
  if (!q.from && !q.to && q.month) where.push(inMonth(q.month));
  const selectedCategories = q.categories?.length ? q.categories : q.category ? [q.category] : [];
  if (selectedCategories.length) {
    const matches = selectedCategories.map((value) => {
      const split = value.lastIndexOf(":");
      const type = split > 0 && ["expense", "income", "investment"].includes(value.slice(0, split)) ? value.slice(0, split) : undefined;
      const category = split > 0 ? value.slice(split + 1) : value;
      const splitMatch = sql`EXISTS (SELECT 1 FROM transaction_splits fs WHERE fs.transaction_id = ${transactions.id} AND fs.category = ${category}${type ? sql` AND ${transactions.type} = ${type}` : sql``})`;
      const noSplits = sql`NOT EXISTS (SELECT 1 FROM transaction_splits fs WHERE fs.transaction_id = ${transactions.id})`;
      const rowMatch = type
        ? and(eq(transactions.type, type as typeof TXN_TYPES[number]), eq(transactions.category, category), noSplits)
        : and(eq(transactions.category, category), noSplits);
      return or(rowMatch, splitMatch);
    });
    const match = or(...matches);
    if (match) where.push(match);
  }
  if (q.search) {
    const p = `%${q.search}%`;
    const match = or(like(transactions.merchant, p), like(transactions.category, p), like(transactions.rawText, p));
    if (match) where.push(match);
  }
  if (q.review) where.push(eq(transactions.needsReview, true));
  if (q.card) where.push(eq(transactions.accountLast4, q.card));
  if (q.type === "transfer") where.push(eq(transactions.excluded, true));
  else if (q.type) where.push(eq(transactions.type, q.type));
  if (q.min !== undefined) where.push(gte(transactions.amount, q.min));
  if (q.max !== undefined) where.push(lte(transactions.amount, q.max));
  if (q.merchant) where.push(eq(transactions.merchant, q.merchant));
  if (q.ids) where.push(inArray(transactions.id, q.ids.length ? q.ids : [0]));
  if (q.tripId) where.push(sql`${transactions.id} IN (SELECT transaction_id FROM transaction_trips WHERE trip_id = ${q.tripId})`);
  return where;
}

/** withRaw adds the SMS text; only Detail, Review and Activity's pane need it. */
export function listTxns(db: Db, q: ListQuery & { limit: number; withRaw?: boolean }) {
  const where = listWhere(q);
  const order = q.sort === "oldest" ? [transactions.date, transactions.id] :
    q.sort === "amount-desc" ? [desc(transactions.amount), desc(transactions.date)] :
    q.sort === "amount-asc" ? [transactions.amount, desc(transactions.date)] :
    [desc(transactions.date), desc(transactions.id)];
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
      reimbursable: sql<number>`CASE WHEN ${transactions.type}='expense' THEN ${claimedOf('transactions')} ELSE 0 END`.mapWith(Number),
      yours: sql<number>`${shareSql('transactions')}`.mapWith(Number),
    })
    .from(transactions)
    .where(and(...where))
    .orderBy(...order)
    .limit(q.limit);
}

/** Days a filter covers, for avg/day. Null when the range is open-ended or absent. */
function dayCount(q: ListQuery): number | null {
  const dayMs = 864e5;
  if (q.from && q.to) return (Date.parse(q.to) - Date.parse(q.from)) / dayMs + 1;
  if (q.from || q.to) return null;
  if (q.month) {
    const [first, next] = monthBounds(q.month);
    // Current month: pace so far, not spend spread over days still to come.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    if (today.slice(0, 7) === q.month) return Number(today.slice(8, 10));
    return (Date.parse(next) - Date.parse(first)) / dayMs;
  }
  return null;
}

/** One query, same WHERE as listTxns. Spend excludes excluded and duplicate rows; transferred is the excluded rows. counted_amount is the filtered split part, scaled to your share (§15). */
/** Counted amount per row under a category filter: a split row counts only its selected parts (§15). */
export function filteredAmount(q: Pick<ListQuery, "category" | "categories">) {
  const selectedCategories = q.categories?.length ? q.categories : q.category ? [q.category] : [];
  const splitNames = selectedCategories.map((value) => {
    const i = value.lastIndexOf(":");
    return i > 0 ? value.slice(i + 1) : value;
  });
  const splitFilter = splitNames.length
    ? sql` AND fs.category IN (${sql.join(splitNames.map((name) => sql`${name}`), sql`, `)})`
    : sql``;
  const counted = splitNames.length
    ? sql`CASE WHEN transactions.type = 'expense' AND EXISTS (SELECT 1 FROM transaction_splits fs WHERE fs.transaction_id = transactions.id)
        THEN COALESCE((SELECT SUM(${sql.raw(splitShareOf("transactions", "fs"))}) FROM transaction_splits fs
          WHERE fs.transaction_id = transactions.id${splitFilter}), 0)
        ELSE ${sql.raw(countedOf("transactions"))} END`
    : sql.raw(countedOf("transactions"));
  return { counted, splitFilter };
}

export async function summarizeTxns(db: Db, q: ListQuery) {
  const where = and(...listWhere(q)) ?? sql`1 = 1`;
  const { counted, splitFilter } = filteredAmount(q);
  const [row] = await db.all<{ n: number; spent: number; income: number; transferred: number; top: string; biggest: string | null; frequent: string | null }>(sql`
    WITH m AS (SELECT transactions.*, ${counted} AS counted_amount FROM transactions WHERE ${where}),
    s AS (SELECT * FROM m WHERE type = 'expense' AND excluded = 0 AND duplicate_of IS NULL)
    SELECT
      (SELECT COUNT(*) FROM m) AS n,
      (SELECT COALESCE(SUM(counted_amount), 0) FROM s) AS spent,
      (SELECT COALESCE(SUM(counted_amount), 0) FROM m WHERE type = 'income' AND excluded = 0 AND duplicate_of IS NULL) AS income,
      (SELECT COALESCE(SUM(amount), 0) FROM m WHERE excluded = 1) AS transferred,
      (SELECT COALESCE(json_group_array(json_object('category', c, 'total', t)), '[]')
         FROM (SELECT COALESCE(fs.category, s.category, 'Other') AS c,
                SUM(CASE WHEN fs.transaction_id IS NULL THEN s.counted_amount ELSE ${sql.raw(splitShareOf("s", "fs"))} END) AS t
               FROM s LEFT JOIN transaction_splits fs ON fs.transaction_id = s.id
               WHERE fs.transaction_id IS NULL OR (fs.transaction_id IS NOT NULL${splitFilter})
               GROUP BY c ORDER BY t DESC LIMIT 4)) AS top,
      (SELECT json_object('merchant', merchant, 'amount', counted_amount, 'date', date) FROM s ORDER BY counted_amount DESC LIMIT 1) AS biggest,
      (SELECT json_object('merchant', merchant, 'n', n)
         FROM (SELECT merchant, COUNT(*) AS n FROM s GROUP BY merchant ORDER BY n DESC LIMIT 1)) AS frequent`);
  const spent = Number(row?.spent ?? 0);
  const income = Number(row?.income ?? 0);
  const days = dayCount(q);
  return {
    count: Number(row?.n ?? 0),
    spent,
    income,
    transferred: Number(row?.transferred ?? 0),
    net: income - spent,
    top: JSON.parse(row?.top ?? "[]") as { category: string; total: number }[],
    biggest: row?.biggest ? (JSON.parse(row.biggest) as { merchant: string; amount: number; date: string }) : null,
    frequent: row?.frequent ? (JSON.parse(row.frequent) as { merchant: string; n: number }) : null,
    avgPerDay: days ? spent / days : null,
  };
}

export async function splitsByTxnIds(db: Db, txnIds: number[]): Promise<Record<number, { transactionId: number; category: string; amount: number }[]>> {
  if (!txnIds.length) return {};
  const rows = await db.select().from(transactionSplits).where(inArray(transactionSplits.transactionId, txnIds));
  const map: Record<number, { transactionId: number; category: string; amount: number }[]> = {};
  for (const r of rows) {
    const list = map[r.transactionId] ?? [];
    list.push(r);
    map[r.transactionId] = list;
  }
  return map;
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
/** Saves the rule, then files the source row and every pending row it matches so Review doesn't ask again. */
export async function addRule(db: Db, r: z.infer<typeof ruleSchema>): Promise<{ ruleId: number; ids: number[] }> {
  const [row] = await db.insert(merchantRules).values(r).returning({ id: merchantRules.id });
  const pending = await db.select({ id: transactions.id, merchant: transactions.merchant, rawMerchant: transactions.rawMerchant }).from(transactions)
    .where(and(live, eq(transactions.needsReview, true), sql`${transactions.type} != 'investment'`));
  const ids = new Set(pending.filter((t) => ruleMatches(r, t.merchant) || (t.rawMerchant !== null && ruleMatches(r, t.rawMerchant))).map((t) => t.id));
  if (r.createdFromTxnId) ids.add(r.createdFromTxnId);
  if (ids.size)
    await db.update(transactions)
      .set({ category: r.category, merchant: r.displayMerchant, needsReview: false, editedAt: sql`(datetime('now'))` })
      .where(inArray(transactions.id, [...ids]));
  return { ruleId: row?.id ?? 0, ids: [...ids] };
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
