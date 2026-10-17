// Formatting rules: DESIGN.md §4. Checked by scripts/check-format.ts.

const inr = (whole: boolean) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
const inrWhole = inr(true);
const inrPaise = inr(false);

/** ₹1,23,450 · ₹219 · ₹219.50 (paise only when present). */
export function money(n: number): string {
  const r = Math.round(n * 100) / 100;
  return (Number.isInteger(r) ? inrWhole : inrPaise).format(r);
}

const compactFmt = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
/** Axes and tight tiles: 1.2L · 45K. */
export const compact = (n: number) => compactFmt.format(n);

/** Income and gains: "+₹85,000". Expenses carry no sign. */
export const signed = (n: number) => (n > 0 ? `+${money(n)}` : n < 0 ? `−${money(-n)}` : money(0));

/** "₹3,088 over" or "₹2,146 left". */
export const overOrLeft = (spent: number, limit: number) =>
  spent > limit ? `${money(spent - limit)} over` : `${money(limit - spent)} left`;

/** Foreign spend: "$12.99 · ₹1,143". */
export function foreign(currency: string | null | undefined, original: number | null | undefined, inrAmount: number) {
  if (!currency || currency === "INR" || original == null) return money(inrAmount);
  const f = new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: 2 }).format(original);
  return `${f} · ${money(inrAmount)}`;
}

/** Card or account: "••2047". */
export const card = (last4: string | null | undefined) => (last4 ? `••${last4}` : "");

const p2 = (n: number) => String(n).padStart(2, "0");
const day = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00`);
const dm = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** "24 Sept". */
export const dayMonth = (date: string) => dm(day(date));
/** "Thu 15 Oct". */
export const weekdayDate = (date: string) => {
  const d = day(date);
  return `${d.toLocaleDateString("en-IN", { weekday: "short" })} ${dm(d)}`;
};
/** 12-hour clock from local "YYYY-MM-DD HH:mm" or a Date: "2:44 PM". Hand-built: en-IN Intl says "pm". */
export function time(value: string | Date): string {
  const [h, m] = typeof value === "string" ? value.slice(11, 16).split(":").map(Number) : [value.getHours(), value.getMinutes()];
  return `${h % 12 || 12}:${p2(m)} ${h < 12 ? "AM" : "PM"}`;
}
/** "15 Oct, 2:44 PM". */
export const shortDate = (date: string) => (date.length > 10 ? `${dayMonth(date)}, ${time(date)}` : dayMonth(date));
/** "Thu". */
export const weekday = (date: string) => day(date).toLocaleDateString("en-IN", { weekday: "short" });
/** Prices carry their date: "NAVs of 15 Oct". */
export const navsOf = (date: string) => `NAVs of ${dayMonth(date)}`;
/** Manual values carry theirs: "Statement of 9 Oct". */
export const statementOf = (date: string) => `Statement of ${dayMonth(date)}`;

/** "Oct" · "October" for a "YYYY-MM". */
export const monthName = (month: string, width: "short" | "long" = "long") =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", { month: width });

export const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

/** "1–15 Oct" or "29 Sept–3 Oct" for an inclusive date range. */
export function rangeLabel(from: string, to: string): string {
  const a = day(from);
  const b = day(to);
  const sameMonth = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  const sameYear = a.getFullYear() === b.getFullYear();
  if (sameMonth) return `${a.getDate()}–${dm(b)}`;
  const left = `${dm(a)}${sameYear ? "" : ` ${a.getFullYear()}`}`;
  const right = `${dm(b)}${sameYear ? "" : ` ${b.getFullYear()}`}`;
  return `${left}–${right}`;
}

/** Local "YYYY-MM" for this month. */
export const thisMonth = () => nowLocal().slice(0, 7);

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/** Local "YYYY-MM-DD HH:mm" for now. */
export function nowLocal(d = new Date()): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** "3 min ago" · "6 h ago" · "2 d ago". */
export function ago(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
}

/** Evaluate a keypad expression like "450+120-30". Undefined when invalid. */
export function evalAmount(expr: string): number | undefined {
  const clean = expr.replace(/\s|,/g, "");
  if (!/^\d+(\.\d{1,2})?([+-]\d+(\.\d{1,2})?)*$/.test(clean)) return undefined;
  const total = (clean.match(/[+-]?\d+(\.\d+)?/g) ?? []).reduce((s, t) => s + Number(t), 0);
  return Math.round(total * 100) / 100;
}
