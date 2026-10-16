import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const TXN_TYPES = ["income", "expense", "investment"] as const;

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey(),
    // kharcha-mini row id; null for rows added in this app.
    miniId: integer("mini_id").unique(),
    source: text("source", { enum: ["sms", "manual", "paste"] }).notNull(),
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
    // "Not a spend": kept in the ledger, left out of spend, budgets and insights.
    excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
    duplicateOf: integer("duplicate_of"),
    // Merchant as the SMS said it, kept when a rule or edit renames it.
    rawMerchant: text("raw_merchant"),
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

// ---- Design rebuild tables (DESIGN.md §7). ----

export const CATEGORY_TYPES = ["expense", "income"] as const;
export const categories = sqliteTable(
  "categories",
  {
    name: text("name").notNull(),
    type: text("type", { enum: CATEGORY_TYPES }).notNull(),
    // Token name: "cat-food" -> var(--color-cat-food).
    colorToken: text("color_token").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.name, t.type] })],
);

export const merchantRules = sqliteTable("merchant_rules", {
  id: integer("id").primaryKey(),
  // Case-insensitive; a trailing * means "starts with", otherwise "contains".
  match: text("match").notNull(),
  displayMerchant: text("display_merchant").notNull(),
  category: text("category").notNull(),
  createdFromTxnId: integer("created_from_txn_id"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const trips = sqliteTable("trips", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  // Per-day budget in rupees.
  budget: real("budget").notNull().default(0),
  autoTag: integer("auto_tag", { mode: "boolean" }).notNull().default(true),
  skipRecurring: integer("skip_recurring", { mode: "boolean" }).notNull().default(true),
  endedAt: text("ended_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const transactionTrips = sqliteTable(
  "transaction_trips",
  {
    transactionId: integer("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
    tripId: integer("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["auto", "manual"] }).notNull(),
    // false for "Getting there" bookings outside the daily budget.
    inDailyBudget: integer("in_daily_budget", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.tripId] })],
);

export const SERIES_KINDS = ["subscription", "bill", "sip", "emi", "insurance"] as const;
export const recurringSeries = sqliteTable("recurring_series", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: SERIES_KINDS }).notNull(),
  match: text("match").notNull(),
  cadence: text("cadence", { enum: ["monthly", "quarterly", "yearly", "weekly"] }).notNull().default("monthly"),
  usualDay: integer("usual_day"),
  expectedAmount: real("expected_amount").notNull(),
  tolerancePct: real("tolerance_pct").notNull().default(10),
  holdingId: integer("holding_id"),
  status: text("status", { enum: ["active", "paused"] }).notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const recurringOccurrences = sqliteTable(
  "recurring_occurrences",
  {
    seriesId: integer("series_id").notNull().references(() => recurringSeries.id, { onDelete: "cascade" }),
    dueDate: text("due_date").notNull(),
    transactionId: integer("transaction_id"),
    status: text("status", { enum: ["upcoming", "cleared", "cleared_late", "past_due"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.seriesId, t.dueDate] })],
);

export const HOLDING_KINDS = ["fund", "gold", "nps", "other"] as const;
export const holdings = sqliteTable("holdings", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: HOLDING_KINDS }).notNull(),
  // Allocation group on Wealth, e.g. "Index equity", "Gold".
  assetClass: text("asset_class").notNull().default("Other"),
  schemeCode: text("scheme_code"),
  targetPct: real("target_pct"),
  isClosed: integer("is_closed", { mode: "boolean" }).notNull().default(false),
  manualValue: real("manual_value"),
  manualValueDate: text("manual_value_date"),
  sipAmount: real("sip_amount"),
  sipDay: integer("sip_day"),
  smsMatch: text("sms_match"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const holdingTxns = sqliteTable(
  "holding_txns",
  {
    id: integer("id").primaryKey(),
    holdingId: integer("holding_id").notNull().references(() => holdings.id, { onDelete: "cascade" }),
    transactionId: integer("transaction_id").unique(),
    date: text("date").notNull(),
    amount: real("amount").notNull(),
    units: real("units"),
    nav: real("nav"),
    source: text("source", { enum: ["sms", "csv", "manual"] }).notNull(),
  },
  (t) => [index("holding_txns_holding_idx").on(t.holdingId, t.date)],
);

export const prices = sqliteTable(
  "prices",
  {
    schemeCode: text("scheme_code").notNull(),
    date: text("date").notNull(),
    nav: real("nav").notNull(),
    source: text("source", { enum: ["mfapi", "amfi"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.schemeCode, t.date] })],
);

export const attachments = sqliteTable("attachments", {
  id: integer("id").primaryKey(),
  transactionId: integer("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
  // Path under $STATE_DIRECTORY/attachments; never served statically.
  path: text("path").notNull(),
  mime: text("mime").notNull(),
  bytes: integer("bytes").notNull(),
  // ok | failed | manual: whether AI read it.
  readStatus: text("read_status", { enum: ["pending", "ok", "failed", "manual"] }).notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const transactionItems = sqliteTable("transaction_items", {
  id: integer("id").primaryKey(),
  transactionId: integer("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  qty: real("qty"),
  amount: real("amount").notNull(),
  category: text("category").notNull(),
  source: text("source", { enum: ["ai", "manual", "adjustment"] }).notNull(),
  // 0–1 from the model; null for manual rows. Low values show a "?" until "Looks right".
  confidence: real("confidence"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const receiptJobs = sqliteTable("receipt_jobs", {
  id: integer("id").primaryKey(),
  transactionId: integer("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["queued", "reading", "done", "failed"] }).notNull().default("queued"),
  error: text("error", { enum: ["unreadable", "not_receipt", "ai_unavailable"] }),
  model: text("model"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
});

export const transactionSplits = sqliteTable(
  "transaction_splits",
  {
    transactionId: integer("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    amount: real("amount").notNull(),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.category] })],
);

export const insights = sqliteTable(
  "insights",
  {
    id: integer("id").primaryKey(),
    detector: text("detector").notNull(),
    // Stable per finding, so a nightly re-run does not duplicate or resurrect it.
    key: text("key").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    dismissedAt: text("dismissed_at"),
  },
  (t) => [uniqueIndex("insights_detector_key").on(t.detector, t.key)],
);

export const digests = sqliteTable("digests", {
  weekStart: text("week_start").primaryKey(),
  factsJson: text("facts_json").notNull(),
  text: text("text"),
  model: text("model"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export type Category = typeof categories.$inferSelect;
export type MerchantRule = typeof merchantRules.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type Series = typeof recurringSeries.$inferSelect;
export type Holding = typeof holdings.$inferSelect;

/** Ask history: the validated query spec and the answer shown (no raw SMS). */
export const askLog = sqliteTable("ask_log", {
  id: integer("id").primaryKey(),
  question: text("question").notNull(),
  specJson: text("spec_json"),
  answerJson: text("answer_json"),
  model: text("model"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});
