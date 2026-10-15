import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

// Row shape kharcha-mini pushes (its drizzle select, camelCase). Unknown keys are dropped.
export const miniRowSchema = z.object({
  id: z.number().int().positive(),
  type: z.enum(["income", "expense", "investment"]),
  amount: z.number().nonnegative(),
  merchant: z.string(),
  merchantCanonical: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  // Old manual rows in the mini are date-only; normalise to midnight.
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?$/)
    .transform((d) => (d.length === 10 ? `${d} 00:00` : d)),
  rawText: z.string(),
  senderId: z.string(),
  bankName: z.string().nullable().optional(),
  parsedBy: z.string(),
  confidence: z.string().nullable().optional(),
  referenceNumber: z.string().nullable().optional(),
  accountLast4: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  originalAmount: z.number().nullable().optional(),
  needsReview: z.number().int().optional(),
  deletedAt: z.string().nullable().optional(),
});
export type MiniRow = z.output<typeof miniRowSchema>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  mini_id INTEGER UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('sms','manual')),
  type TEXT NOT NULL CHECK (type IN ('income','expense','investment')),
  amount REAL NOT NULL,
  merchant TEXT NOT NULL,
  category TEXT,
  date TEXT NOT NULL,
  raw_text TEXT,
  bank_name TEXT,
  account_last4 TEXT,
  reference_number TEXT,
  parsed_by TEXT,
  currency TEXT,
  original_amount REAL,
  needs_review INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  edited_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export function open(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}

let shared: DatabaseSync | undefined;
// ponytail: one process, one connection; node:sqlite is synchronous so calls never interleave.
export function getDb(): DatabaseSync {
  shared ??= open(
    path.join(process.env.STATE_DIRECTORY ?? ".data", "kharcha.db"),
  );
  return shared;
}

/**
 * Upsert pushed rows by mini_id. Rows edited in the app keep their edits;
 * a tombstone from either side sticks.
 */
export function ingest(db: DatabaseSync, rows: MiniRow[]): number {
  const upsert = db.prepare(`
    INSERT INTO transactions (mini_id, source, type, amount, merchant, category, date, raw_text,
      bank_name, account_last4, reference_number, parsed_by, currency, original_amount, needs_review, deleted_at)
    VALUES (?, 'sms', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mini_id) DO UPDATE SET
      deleted_at = COALESCE(excluded.deleted_at, deleted_at),
      type = CASE WHEN edited_at IS NULL THEN excluded.type ELSE type END,
      amount = CASE WHEN edited_at IS NULL THEN excluded.amount ELSE amount END,
      merchant = CASE WHEN edited_at IS NULL THEN excluded.merchant ELSE merchant END,
      category = CASE WHEN edited_at IS NULL THEN excluded.category ELSE category END,
      date = CASE WHEN edited_at IS NULL THEN excluded.date ELSE date END,
      needs_review = CASE WHEN edited_at IS NULL THEN excluded.needs_review ELSE needs_review END`);
  db.exec("BEGIN");
  try {
    for (const r of rows)
      upsert.run(
        r.id,
        r.type,
        r.amount,
        r.merchantCanonical || r.merchant,
        r.category || null,
        r.date,
        r.rawText,
        r.bankName ?? null,
        r.accountLast4 ?? null,
        r.referenceNumber ?? null,
        r.parsedBy,
        r.currency ?? null,
        r.originalAmount ?? null,
        r.needsReview ?? 0,
        r.deletedAt ?? null,
      );
    db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_ingest_at', ?)",
    ).run(new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return rows.length;
}

export const editSchema = z.object({
  id: z.number().int().positive(),
  merchant: z.string().trim().min(1).max(120),
  category: z.string().trim().max(40),
  amount: z.number().positive().max(1e9),
  type: z.enum(["income", "expense", "investment"]),
});

export function edit(db: DatabaseSync, e: z.infer<typeof editSchema>): void {
  db.prepare(
    `UPDATE transactions SET merchant = ?, category = ?, amount = ?, type = ?, needs_review = 0,
       edited_at = datetime('now') WHERE id = ?`,
  ).run(e.merchant, e.category || null, e.amount, e.type, e.id);
}

export const addSchema = z.object({
  type: z.enum(["income", "expense", "investment"]),
  amount: z.number().positive().max(1e9),
  merchant: z.string().trim().min(1).max(120),
  category: z.string().trim().max(40),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
});

export function add(db: DatabaseSync, a: z.infer<typeof addSchema>): void {
  db.prepare(
    `INSERT INTO transactions (source, type, amount, merchant, category, date, edited_at)
     VALUES ('manual', ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(a.type, a.amount, a.merchant, a.category || null, a.date);
}

export function remove(db: DatabaseSync, id: number): void {
  db.prepare(
    "UPDATE transactions SET deleted_at = datetime('now'), edited_at = datetime('now') WHERE id = ?",
  ).run(id);
}

const LIVE = "deleted_at IS NULL";

export type Txn = {
  id: number;
  source: "sms" | "manual";
  type: "income" | "expense" | "investment";
  amount: number;
  merchant: string;
  category: string | null;
  date: string;
  bank_name: string | null;
  account_last4: string | null;
  raw_text: string | null;
  needs_review: number;
};

/** month is YYYY-MM. Totals by type and expense by category for that month. */
export function monthSummary(db: DatabaseSync, month: string) {
  const range = [`${month}-01`, `${month}-31 99:99`];
  const totals = db
    .prepare(
      `SELECT type, SUM(amount) AS total, COUNT(*) AS n FROM transactions
       WHERE ${LIVE} AND date BETWEEN ? AND ? GROUP BY type`,
    )
    .all(...range) as { type: Txn["type"]; total: number; n: number }[];
  const categories = db
    .prepare(
      `SELECT COALESCE(category, 'Uncategorised') AS category, SUM(amount) AS total, COUNT(*) AS n
       FROM transactions WHERE ${LIVE} AND type = 'expense' AND date BETWEEN ? AND ?
       GROUP BY 1 ORDER BY total DESC`,
    )
    .all(...range) as { category: string; total: number; n: number }[];
  const review = db
    .prepare(`SELECT COUNT(*) AS n FROM transactions WHERE ${LIVE} AND needs_review = 1`)
    .get() as { n: number };
  const lastIngest = db
    .prepare("SELECT value FROM meta WHERE key = 'last_ingest_at'")
    .get() as { value: string } | undefined;
  return {
    month,
    totals,
    categories,
    reviewCount: review.n,
    lastIngestAt: lastIngest?.value ?? null,
  };
}

export function listTransactions(
  db: DatabaseSync,
  q: { month?: string; search?: string; review?: boolean; limit: number },
): Txn[] {
  const where = [LIVE];
  const args: (string | number)[] = [];
  if (q.month) {
    where.push("date BETWEEN ? AND ?");
    args.push(`${q.month}-01`, `${q.month}-31 99:99`);
  }
  if (q.search) {
    where.push("(merchant LIKE ? OR category LIKE ? OR raw_text LIKE ?)");
    const like = `%${q.search}%`;
    args.push(like, like, like);
  }
  if (q.review) where.push("needs_review = 1");
  return db
    .prepare(
      `SELECT id, source, type, amount, merchant, category, date, bank_name, account_last4, raw_text, needs_review
       FROM transactions WHERE ${where.join(" AND ")} ORDER BY date DESC, id DESC LIMIT ?`,
    )
    .all(...args, q.limit) as Txn[];
}

export function categories(db: DatabaseSync): string[] {
  return (
    db
      .prepare(
        `SELECT category FROM transactions WHERE category IS NOT NULL AND category != ''
         GROUP BY category ORDER BY COUNT(*) DESC`,
      )
      .all() as { category: string }[]
  ).map((r) => r.category);
}
