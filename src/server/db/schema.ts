import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const TXN_TYPES = ["income", "expense", "investment"] as const;

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey(),
    // kharcha-mini row id; null for rows added in this app.
    miniId: integer("mini_id").unique(),
    source: text("source", { enum: ["sms", "manual"] }).notNull(),
    type: text("type", { enum: TXN_TYPES }).notNull(),
    amount: real("amount").notNull(),
    merchant: text("merchant").notNull(),
    category: text("category"),
    // Local "YYYY-MM-DD HH:mm", same as kharcha-mini.
    date: text("date").notNull(),
    rawText: text("raw_text"),
    bankName: text("bank_name"),
    accountLast4: text("account_last4"),
    referenceNumber: text("reference_number"),
    parsedBy: text("parsed_by"),
    currency: text("currency"),
    originalAmount: real("original_amount"),
    needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
    deletedAt: text("deleted_at"),
    // Set once a human edits the row; ingest stops overwriting user-owned fields.
    editedAt: text("edited_at"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index("transactions_date_idx").on(t.date),
    check("transactions_amount_check", sql`${t.amount} >= 0`),
  ],
);

export const budgets = sqliteTable("budgets", {
  category: text("category").primaryKey(),
  monthlyLimit: real("monthly_limit").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Txn = typeof transactions.$inferSelect;
export type TxnType = (typeof TXN_TYPES)[number];
