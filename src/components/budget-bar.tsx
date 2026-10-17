// BudgetBar: progress against monthly limit with pace tick mark (§5, Budgets board).
import { cn } from "../lib/cn";
import { money } from "../lib/format";

export function BudgetBar({
  spent,
  limit,
  pacePct,
  showLabels = false,
  className,
  reimbursable = 0,
}: {
  spent: number;
  limit: number;
  reimbursable?: number;
  /** Fraction 0..1 or percentage 0..100. */
  pacePct: number;
  showLabels?: boolean;
  className?: string;
}) {
  const normPace = pacePct > 1 ? pacePct / 100 : pacePct;
  const pacePercent = Math.min(100, Math.max(0, normPace * 100));
  const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
  const reimbursablePct = spent > 0 ? Math.min(pct, Math.max(0, reimbursable / spent * pct)) : 0;
  const projected = normPace > 0 ? spent / normPace : spent;
  const tone =
    projected > limit ? "bg-over"
    : projected > limit * 0.9 ? "bg-watch"
    : "bg-brand";

  return (
    <div
      role="img"
      aria-label={limit > 0 ? `Spent ${money(spent)} of ${money(limit)}` : `Spent ${money(spent)}, no budget set`}
      className={cn("flex flex-col gap-1.5", className)}
    >
      {showLabels && (
        <div className="flex justify-between text-sm">
          <span className="font-medium">{money(spent)}</span>
          <span className="text-ink-3">/ {money(limit)}</span>
        </div>
      )}
      <div className="relative h-1.5 rounded-chip bg-sunken">
        <span
          className={cn("absolute inset-y-0 left-0 rounded-chip", tone)}
          style={{ width: `${pct}%` }}
        />
        {reimbursablePct > 0 && (
          <span
            aria-hidden
            className="absolute inset-y-0 rounded-chip"
            style={{ left: `${pct - reimbursablePct}%`, width: `${reimbursablePct}%`, background: "repeating-linear-gradient(135deg, var(--field) 0 2px, transparent 2px 5px)" }}
          />
        )}
        {limit > 0 && <span
          className="absolute -top-1 h-3.5 w-0.5 bg-ink"
          style={{ left: `${pacePercent}%` }}
        />}
      </div>
    </div>
  );
}
