import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthLabel, shiftMonth } from "../lib/format";

/** Activity/Insights header chip: "October 2026" with ‹ ›. A custom range replaces the label and drops the arrows. */
export function MonthStepper({ to, month, label, onOpen }: { to: "/activity" | "/insights"; month: string; label?: string; onOpen: () => void }) {
  const text = label ?? monthLabel(month);
  return (
    <span className="flex min-h-11 items-center rounded-chip border border-field bg-card text-ink">
      {!label && (
        <Link to={to} search={(prev: Record<string, unknown>) => ({ ...prev, from: undefined, to: undefined, month: shiftMonth(month, -1) })} aria-label="Previous month" className="flex size-11 shrink-0 items-center justify-center">
          <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      )}
      <button type="button" onClick={onOpen} className={`min-h-11 ${label ? "px-4" : "px-1"} text-[14px] font-medium whitespace-nowrap`}>{text}</button>
      {!label && (
        <Link to={to} search={(prev: Record<string, unknown>) => ({ ...prev, from: undefined, to: undefined, month: shiftMonth(month, 1) })} aria-label="Next month" className="flex size-11 shrink-0 items-center justify-center">
          <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      )}
    </span>
  );
}
