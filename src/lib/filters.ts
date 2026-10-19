// Client-safe URL filters shared by Activity, Insights and Ask. Server twin: listSchema/scopeSchema in db/queries.ts.
import { z } from "zod";

/** Same check as the server's realDate, so a URL the client accepts never 400s. */
const realDay = (value: string) => { const [y, m, d] = value.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(realDay, "not a real date");
const category = z.string().trim().max(49).refine((v) => v.includes(":") ? v.slice(v.lastIndexOf(":") + 1).length <= 40 : v.length <= 40);
export const scopeShape = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  from: day.optional(),
  to: day.optional(),
  search: z.string().trim().max(60).optional(),
  category: category.optional(),
  categories: z.array(category.pipe(z.string().min(1))).max(40).optional(),
  merchant: z.string().trim().max(120).optional(),
  card: z.string().regex(/^\d{4}$/).optional(),
  type: z.enum(["income", "expense", "investment", "transfer"]).optional(),
  status: z.preprocess((v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v), z.array(z.enum(["review", "receipt", "split", "reimbursable"])).max(4)).optional(),
  tripId: z.number().int().positive().optional(),
  min: z.number().finite().min(0).max(1e9).optional(),
  max: z.number().finite().min(0).max(1e9).optional(),
});
export const ordered = <T extends z.ZodType<{ from?: string; to?: string; min?: number; max?: number }>>(schema: T) =>
  schema.refine((q) => !q.from || !q.to || q.from <= q.to, { path: ["to"], message: "to must not precede from" })
    .refine((q) => q.min === undefined || q.max === undefined || q.min <= q.max, { path: ["max"], message: "max must be at least min" });
export const scopeSearch = ordered(scopeShape);
export type ScopeSearch = z.infer<typeof scopeShape>;

/** Keeps only scope keys, so list-only params (sort, ids, review) don't leak into Insights or Ask. */
export const pickScope = (search: Record<string, unknown>): ScopeSearch =>
  Object.fromEntries(Object.keys(scopeShape.shape).filter((key) => search[key] !== undefined).map((key) => [key, search[key]])) as ScopeSearch;
