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

type FilterCount = { month?: string; from?: string; to?: string; category?: string; categories?: string[]; card?: string; type?: string; tripId?: number; min?: number; max?: number; status?: string[]; review?: boolean; sort?: string };
/** Local-time date presets for the Date filter. */
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const shiftDay = (date: string, delta: number) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + delta); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export function preset(label: string) {
  const now = today(); const d = new Date(`${now}T12:00:00`); const weekday = (d.getDay() + 6) % 7;
  if (label === "Today") return { from: now, to: now, month: undefined };
  if (label === "This week") return { from: shiftDay(now, -weekday), to: now, month: undefined };
  if (label === "Last 7 days") return { from: shiftDay(now, -6), to: now, month: undefined };
  // Whole months stay a month, so the stepper keeps its arrows and no range pill appears (§16).
  if (label === "This month") return { from: undefined, to: undefined, month: now.slice(0, 7) };
  if (label === "Last month") { const first = new Date(d.getFullYear(), d.getMonth() - 1, 1); return { from: undefined, to: undefined, month: `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}` }; }
  if (label === "This year") return { from: `${now.slice(0, 4)}-01-01`, to: now, month: undefined };
  return { from: undefined, to: undefined, month: undefined };
}
export function presetOn(v: { from?: string; to?: string; month?: string }, label: string) {
  const p = preset(label);
  return p.month ? v.month === p.month && !v.from && !v.to : Boolean(p.from) && v.from === p.from && v.to === p.to;
}
export const selectedCategories = (s: FilterCount) => s.categories ?? (s.category ? [s.category] : []);
/** Applied-filter count for the Filter pill; a whole month is not a filter (§16). */
export const countFor = (s: FilterCount, includeSort = true) => Number(Boolean((s.from || s.to) && !s.month)) + selectedCategories(s).length + Number(Boolean(s.card)) + Number(Boolean(s.type)) + Number(Boolean(s.tripId)) + Number(s.min !== undefined || s.max !== undefined) + (s.status?.length ?? 0) + Number(Boolean(s.review && !s.status?.includes("review"))) + Number(Boolean(includeSort && s.sort && s.sort !== "newest"));
