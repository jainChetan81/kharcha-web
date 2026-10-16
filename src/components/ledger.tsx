// LedgerRow and DayHeader (§5): 56px rows; day total under a 1px ink rule.
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { card, foreign, money, weekdayDate } from "../lib/format";

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
};

/** "14:44 · Food · ••2047" or "15 Oct, 14:44 · needs review". */
export function rowMeta(t: LedgerTxn, withDate = false): string {
  const when = withDate ? `${weekdayDate(t.date).split(" ").slice(1).join(" ")}, ${t.date.slice(11, 16)}` : t.date.slice(11, 16);
  const what = t.needsReview ? "needs review" : t.excluded ? "not a spend" : t.type === "income" ? "Income" : t.type === "investment" ? "Investment" : (t.category ?? "Other");
  return [when, what, card(t.accountLast4)].filter(Boolean).join(" · ");
}

export function Amount({ t, className }: { t: LedgerTxn; className?: string }) {
  const value = foreign(t.currency, t.originalAmount, t.amount);
  return (
    <span className={cn("shrink-0 text-[15px] font-medium whitespace-nowrap", t.type === "income" && "text-earn", t.excluded && "text-ink-3 line-through decoration-1", className)}>
      {t.type === "income" ? "+" : ""}
      {value}
    </span>
  );
}

export function LedgerRow({ t, withDate, trailing, className }: { t: LedgerTxn; withDate?: boolean; trailing?: ReactNode; className?: string }) {
  return (
    <Link
      to="/txn/$id"
      params={{ id: String(t.id) }}
      className={cn("flex min-h-14 items-center justify-between gap-3 border-b border-hairline py-1.5 text-ink hover:bg-sunken/50 hover:text-ink", className)}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 truncate text-[15px] font-medium">
          {t.needsReview && <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-brand" />}
          <span className="truncate">{t.merchant}</span>
        </span>
        <span className="truncate text-[13px] text-ink-3">{rowMeta(t, withDate)}</span>
      </span>
      {trailing ?? <Amount t={t} />}
    </Link>
  );
}

export function DayHeader({ date, total, label }: { date: string; total: number; label?: string }) {
  return (
    <div className="flex justify-between border-b border-ink pt-[18px] pb-1.5 text-xs tracking-[0.06em] text-ink-2 uppercase">
      <span>{label ?? weekdayDate(date)}</span>
      <span className="font-semibold text-ink">{money(total)}</span>
    </div>
  );
}

/** Group rows by day, newest first, with the day's spend total (expenses that count). */
export function byDay<T extends LedgerTxn>(rows: T[]): { date: string; total: number; rows: T[] }[] {
  const out: { date: string; total: number; rows: T[] }[] = [];
  for (const r of rows) {
    const d = r.date.slice(0, 10);
    let g = out.at(-1);
    if (!g || g.date !== d) out.push((g = { date: d, total: 0, rows: [] }));
    g.rows.push(r);
    if (r.type === "expense" && !r.excluded) g.total += r.amount;
  }
  return out;
}
