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
};

/** Excluded rows (card bills, own-account moves, anything marked "Not a spend") stay listed but don't count. Ingest files card bills as Other, so the tag can't tell them apart. */
const label = (t: LedgerTxn) =>
  t.excluded ? "Not counted" : t.type === "income" ? "Income" : t.type === "investment" ? "Investment" : (t.category ?? "Other");

/** Row meta line with the category in its colour; "Other" and uncounted rows stay neutral. */
export function RowMeta({ t, withDate, color }: { t: LedgerTxn; withDate?: boolean; color?: string }) {
  const tone = t.excluded || t.type !== "expense" ? undefined : (color ?? "cat-other");
  return (
    <span className="flex min-w-0 items-center gap-1.5 truncate text-[13px] text-ink-3">
      <span className="shrink-0">{withDate ? shortDate(t.date) : time(t.date)}</span>
      <span aria-hidden>·</span>
      <span className={cn("inline-flex min-w-0 items-center gap-1 truncate", t.excluded ? "rounded-[4px] bg-sunken px-1.5 text-ink-2" : "text-ink-2")}>
        {tone && <i aria-hidden className="inline-block size-2 shrink-0 rounded-[2px]" style={{ background: `var(--color-${tone})` }} />}
        <span className="truncate">{label(t)}</span>
      </span>
      {t.accountLast4 && <><span aria-hidden>·</span><span className="shrink-0">{card(t.accountLast4)}</span></>}
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
    if (!g || g.date !== d) {
      g = { date: d, total: 0, rows: [] };
      out.push(g);
    }
    g.rows.push(r);
    if (r.type === "expense" && !r.excluded) g.total += r.amount;
  }
  return out;
}
