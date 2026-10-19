import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthLabel, shiftMonth } from "../lib/format";

export function MonthSwitcher({ month, to = "/", compact = false }: { month: string; to?: "/" | "/activity"; compact?: boolean }) {
  return <div className="flex min-w-0 items-center">
    <Link to={to} search={{ month: shiftMonth(month, -1) }} aria-label="Previous month" className="flex size-11 shrink-0 items-center justify-center"><ChevronLeft size={20} strokeWidth={1.75} /></Link>
    <h1 className={`m-0 min-w-0 font-serif font-medium whitespace-nowrap ${compact ? "text-[18px] leading-tight min-[440px]:text-[22px]" : "text-[22px]"}`}>{monthLabel(month)}</h1>
    <Link to={to} search={{ month: shiftMonth(month, 1) }} aria-label="Next month" className="flex size-11 shrink-0 items-center justify-center"><ChevronRight size={20} strokeWidth={1.75} /></Link>
  </div>;
}
