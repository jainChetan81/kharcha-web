// Validators for server functions. No drizzle import here: the Start compiler keeps validators
// in the browser bundle, so importing the schema from this file would ship Drizzle with them.
import { z } from "zod";
import { TXN_TYPES } from "./enums.ts";
import { realDate } from "../../lib/dates.ts";

const dateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  .refine(realDate, "not a real date");
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

export const editSchema = z.object({
  id: z.number().int().positive(),
  merchant: z.string().trim().min(1).max(120),
  category: z.string().trim().max(40),
  amount: z.number().positive().max(1e9),
  type: z.enum(TXN_TYPES),
  excluded: z.boolean().optional(),
  date: dateTime.optional(),
});

export const flagSchema = z.object({
  id: z.number().int().positive(),
  excluded: z.boolean().optional(),
  duplicateOf: z.number().int().positive().nullable().optional(),
  needsReview: z.boolean().optional(),
  category: z.string().trim().min(1).max(40).optional(),
});

export const addSchema = z.object({
  type: z.enum(TXN_TYPES),
  amount: z.number().positive().max(1e9),
  merchant: z.string().trim().min(1).max(120),
  category: z.string().trim().max(40),
  date: dateTime,
  source: z.enum(["manual", "paste"]).optional(),
  rawText: z.string().max(2000).optional(),
  accountLast4: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  originalAmount: z.number().positive().optional(),
  excluded: z.boolean().optional(),
});

/** Status chips (Activity filter screen). Accepts a comma list ("review,split") or an array. */
export const STATUSES = ["review", "receipt", "split", "reimbursable"] as const;
const statusList = z.preprocess((v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v), z.array(z.enum(STATUSES)).max(4));
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => realDate(v), "not a real date");
const listShape = z.object({
  month: monthSchema.optional(),
  from: daySchema.optional(),
  to: daySchema.optional(),
  search: z.string().trim().max(60).optional(),
  review: z.boolean().optional(),
  category: z
    .string()
    .trim()
    .max(49)
    .refine((v) => (v.includes(":") ? v.slice(v.lastIndexOf(":") + 1).length <= 40 : v.length <= 40))
    .optional(),
  categories: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(49)
        .refine((v) => (v.includes(":") ? v.slice(v.lastIndexOf(":") + 1).length <= 40 : v.length <= 40)),
    )
    .max(40)
    .optional(),
  card: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  type: z.enum([...TXN_TYPES, "transfer"]).optional(),
  min: z.number().finite().min(0).max(1e9).optional(),
  max: z.number().finite().min(0).max(1e9).optional(),
  sort: z.enum(["newest", "oldest", "amount-desc", "amount-asc"]).optional(),
  status: statusList.optional(),
  tripId: z.number().int().positive().optional(),
  merchant: z.string().trim().max(120).optional(),
  ids: z.array(z.number().int().positive()).max(500).optional(),
});
const ordered = <T extends z.ZodType<{ from?: string; to?: string; min?: number; max?: number }>>(schema: T) =>
  schema
    .refine((q) => !q.from || !q.to || q.from <= q.to, { path: ["to"], message: "to must not precede from" })
    .refine((q) => q.min === undefined || q.max === undefined || q.min <= q.max, { path: ["max"], message: "max must be at least min" });
export const listSchema = ordered(listShape);
export type ListQuery = z.infer<typeof listSchema>;
/** Activity's filters minus list-only keys: what Insights and Ask scope accept. */
export const scopeSchema = ordered(listShape.omit({ sort: true, ids: true, review: true }));
export type Scope = z.infer<typeof scopeSchema>;

export const budgetSchema = z.object({
  category: z.string().trim().min(1).max(40),
  // 0 removes the budget.
  monthlyLimit: z.number().min(0).max(1e9),
});

/** "Always file X as Y": one rule, applied to this and future rows. Past rows are not rewritten. */
export const ruleSchema = z.object({
  match: z.string().trim().min(2).max(120),
  displayMerchant: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(40),
  createdFromTxnId: z.number().int().positive().optional(),
});
