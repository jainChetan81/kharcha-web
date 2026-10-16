import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { money, shortDate, signed } from "../lib/format";

type Summary = {
  count: number;
  spent: number;
  income: number;
  transferred: number;
  net: number;
  top: { category: string; total: number }[];
  biggest: { merchant: string; amount: number; date: string } | null;
  frequent: { merchant: string; n: number } | null;
  avgPerDay: number | null;
};

/** One server query (getTransactionSummary). Collapsed: one row of figures. Expanded: the rest. */
export function SummaryStrip({ summary, colors }: { summary: Summary; colors: Record<string, string> }) {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion();
  const figures = [
    { value: String(summary.count), label: "rows", tone: "" },
    { value: money(summary.spent), label: "spent", tone: "" },
    ...(summary.income ? [{ value: money(summary.income), label: "income", tone: "text-earn" }] : []),
    ...(summary.transferred ? [{ value: money(summary.transferred), label: "not counted", tone: "" }] : []),
  ];
  const max = Math.max(1, ...summary.top.map((c) => c.total));
  const tone = (category: string) => `var(--color-${colors[category] ?? "cat-other"})`;
  return (
    <section aria-label="Activity summary" className="overflow-hidden rounded-card bg-sunken text-ink">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex min-h-[52px] w-full items-center gap-2 px-3 text-left focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
      >
        <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
          {figures.map((f) => (
            <span key={f.label} className="flex min-w-0 flex-col">
              <strong className={`truncate text-[14px] font-semibold tabular-nums ${f.tone}`}>{f.value}</strong>
              <span className="text-[11px] text-ink-3">{f.label}</span>
            </span>
          ))}
        </span>
        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 18 }}
          aria-hidden="true"
        >
          <ChevronDown size={17} />
        </motion.span>
      </button>
      <motion.div
        initial={false}
        animate={{ height: expanded ? "auto" : 0, opacity: expanded ? 1 : 0 }}
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 36 }}
        style={{ overflow: "hidden" }}
        inert={!expanded}
      >
        <div className="flex flex-col gap-3 border-t border-hairline px-3 pt-3 pb-3 text-[13px]">
          <div className="flex justify-between">
            <span className="label-caps text-ink-3">Net</span>
            <strong className={summary.net < 0 ? "text-over" : "text-earn"}>{signed(summary.net)}</strong>
          </div>
          {summary.top.map((item) => (
            <div key={item.category} className="grid grid-cols-[minmax(88px,1fr)_2fr_auto] items-center gap-2">
              <span className="flex min-w-0 items-center gap-1.5 truncate">
                <i aria-hidden className="size-2 shrink-0 rounded-sm" style={{ background: tone(item.category) }} />
                {item.category}
              </span>
              <span className="h-1 overflow-hidden rounded-full bg-track">
                <span className="block h-full rounded-full" style={{ width: `${(item.total / max) * 100}%`, background: tone(item.category) }} />
              </span>
              <strong>{money(item.total)}</strong>
            </div>
          ))}
          {summary.biggest && (
            <div className="flex justify-between gap-3">
              <span className="text-ink-2">Biggest · {summary.biggest.merchant}, {shortDate(summary.biggest.date)}</span>
              <strong className="shrink-0">{money(summary.biggest.amount)}</strong>
            </div>
          )}
          {summary.frequent && (
            <div className="flex justify-between gap-3">
              <span className="text-ink-2">Most frequent · {summary.frequent.merchant}</span>
              <strong className="shrink-0">{summary.frequent.n} rows</strong>
            </div>
          )}
          {summary.avgPerDay !== null && (
            <div className="flex justify-between">
              <span className="text-ink-2">Avg/day</span>
              <strong>{money(summary.avgPerDay)}</strong>
            </div>
          )}
          <Link to="/insights" className="min-h-11 self-start pt-2 font-medium text-brand">See insights</Link>
        </div>
      </motion.div>
    </section>
  );
}
