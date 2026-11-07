import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthLabel, shiftMonth } from "../lib/format";

// Sits on the ink hero only.
export function MonthSwitcher({ month, to = "/", compact = false }: { month: string; to?: "/" | "/activity"; compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center">
      <Link
        to={to}
        search={{ month: shiftMonth(month, -1) }}
        aria-label="Previous month"
        className="flex size-11 shrink-0 items-center justify-center rounded-button text-on-ink transition-[background-color,transform] duration-150 hover:bg-hero-raised active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        <ChevronLeft size={20} strokeWidth={1.75} />
      </Link>
      <h1 className={`m-0 min-w-0 font-serif font-medium ${compact ? "text-section leading-tight min-[440px]:text-title" : "text-title"}`}>
        {monthLabel(month)}
      </h1>
      <Link
        to={to}
        search={{ month: shiftMonth(month, 1) }}
        aria-label="Next month"
        className="flex size-11 shrink-0 items-center justify-center rounded-button text-on-ink transition-[background-color,transform] duration-150 hover:bg-hero-raised active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        <ChevronRight size={20} strokeWidth={1.75} />
      </Link>
    </div>
  );
}
