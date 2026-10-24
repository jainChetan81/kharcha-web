// LedgerRow and DayHeader (§5): 56px rows; day total under a 1px ink rule.
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { card, foreign, money, shortDate, time, weekdayDate } from "../lib/format";

export type LedgerTxn = {
  id: number;
  type: "income" | "expense" | "investment";
  amount: number;
  merchant: string;
  category: string | null;
  date: string;
  accountLast4: string | null;
  currency?: string | null;
  originalAmount?: number | null;
  needsReview: boolean;
  excluded?: boolean;
  rawMerchant?: string | null;
  splits?: { category: string; amount: number }[];
  yours?: number;
  reimbursable?: number;
};

/** Excluded rows (card bills, own-account moves, anything marked "Not a spend") stay listed but don't count. Ingest files card bills as Other, so the tag can't tell them apart. */
const cardBill = (t: LedgerTxn) => /cred|credit card|card payment/i.test(`${t.merchant} ${t.rawMerchant ?? ""}`);
const label = (t: LedgerTxn) =>
  t.excluded ? (cardBill(t) ? "Card bill" : "Transfer") : t.type === "income" ? "Income" : t.type === "investment" ? "Investment" : (t.category ?? "Other");

/** ReimbursableBadge: U-turn arrow + "₹1,200 back" in brand, on rows with a claim (§5). */
export function ReimbursableBadge({ amount, className }: { amount?: number; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-chip border border-brand px-1.5 py-0.5 text-xs font-medium text-brand", className)}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
      {amount != null ? `${money(amount)} back` : "back"}
    </span>
  );
}

/** Row meta line with the category in its colour; "Other" and uncounted rows stay neutral. */
export function RowMeta({ t, withDate, color }: { t: LedgerTxn; withDate?: boolean; color?: string }) {
  const tone = t.excluded || t.type !== "expense" ? undefined : (color ?? "cat-other");
  return (
    <span className="flex min-w-0 items-center gap-1.5 truncate text-[13px] text-ink-3">
      <span className="shrink-0">{withDate ? shortDate(t.date) : time(t.date)}</span>
      <span aria-hidden>·</span>
      <span className={cn("inline-flex min-w-0 items-center gap-1 truncate", t.excluded ? "rounded-mark bg-sunken px-1.5 text-ink-2" : "text-ink-2")}>
        {tone && <i aria-hidden className="inline-block size-2 shrink-0 rounded-dot" style={{ background: `var(--color-${tone})` }} />}
        <span className="truncate">{label(t)}</span>
      </span>
      {t.accountLast4 && <><span aria-hidden>·</span><span className="shrink-0">{card(t.accountLast4)}</span></>}
    </span>
  );
}

/** Mini bar + first two categories for a split row. With a category filter, the row shows only that part. */
export function SplitMeta({ splits, only, ofTotal }: { splits: { category: string; amount: number }[]; only?: string; ofTotal?: number }) {
  const total = splits.reduce((s, x) => s + x.amount, 0) || 1;
  const shown = only ? splits.filter((s) => s.category === only) : splits;
  const names = shown.slice(0, 2).map((s) => s.category).join(", ") + (shown.length > 2 ? ` +${shown.length - 2}` : "");
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink-2">
      <span role="img" aria-label={`Split: ${splits.map((s) => `${s.category} ${money(s.amount)}`).join(", ")}`} className="flex h-1 w-12 shrink-0 gap-px overflow-hidden rounded-full">
        {splits.map((s) => <i key={s.category} aria-hidden className="h-full" style={{ width: `${(s.amount / total) * 100}%`, background: `var(--color-cat-${s.category.toLowerCase()})` }} />)}
      </span>
      <span className="truncate">{ofTotal !== undefined ? `${money(shown.reduce((s, x) => s + x.amount, 0))} of ${money(ofTotal)}` : names}</span>
    </span>
  );
}

export function Amount({ t, className }: { t: LedgerTxn; className?: string }) {
  const value = foreign(t.currency, t.originalAmount, t.amount);
  return (
    <span className={cn("shrink-0 text-[15px] font-medium whitespace-nowrap", t.type === "income" && "text-earn", t.excluded && "font-normal text-ink-3", className)}>
      {t.type === "income" ? "+" : ""}
      {value}
    </span>
  );
}

export function LedgerRow({ t, withDate, trailing, className, color }: { t: LedgerTxn; withDate?: boolean; trailing?: ReactNode; className?: string; color?: string }) {
  return (
    <Link
      to="/txn/$id"
      params={{ id: String(t.id) }}
      className={cn("flex min-h-14 items-center justify-between gap-3 border-b border-hairline py-1.5 text-ink hover:bg-sunken/50 hover:text-ink", className)}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 truncate text-[15px] font-medium">
          {t.needsReview && <><span aria-hidden className="size-[7px] shrink-0 rounded-full bg-brand" /><span className="sr-only">Needs review</span></>}
          <span className="truncate">{t.merchant}</span>
        </span>
        <RowMeta t={t} withDate={withDate} color={color} />
        {t.reimbursable != null && t.reimbursable > 0 && <ReimbursableBadge amount={t.reimbursable} className="self-start" />}
      </span>
      {trailing ?? (t.reimbursable ? (
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <Amount t={t} />
          <span className="text-[13px] whitespace-nowrap text-ink-3">{money(t.yours ?? 0)} yours · {money(t.reimbursable)} paid</span>
        </span>
      ) : <Amount t={t} />)}
    </Link>
  );
}

export function DayHeader({ date, total, label }: { date: string; total: number; label?: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2 border-b border-ink pt-[18px] pb-1.5 text-xs tracking-[0.06em] text-ink-2 uppercase">
      <span className="min-w-0 truncate">{label ?? weekdayDate(date)}</span>
      <span className="shrink-0 font-semibold text-ink">{money(total)}</span>
    </div>
  );
}

/** Group rows by day, newest first, with the day's spend total (expenses that count). */
export function byDay<T extends LedgerTxn>(rows: T[]): { date: string; total: number; rows: T[] }[] {
  const out: { date: string; total: number; rows: T[] }[] = [];
  for (const r of rows) {
    const d = r.date.slice(0, 10);
    let g = out.at(-1);
    if (!g || g.date !== d) {
      g = { date: d, total: 0, rows: [] };
      out.push(g);
    }
    g.rows.push(r);
    // Your share when the server sent one; reimbursed amounts don't count toward the day.
    if (r.type === "expense" && !r.excluded) g.total += r.yours ?? r.amount;
  }
  return out;
}
