import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { shiftMonth } from "../lib/format";

export function MonthArrow({
  month,
  to,
  direction,
  hero = false,
}: {
  month: string;
  to: "/" | "/activity" | "/insights";
  direction: -1 | 1;
  hero?: boolean;
}) {
  const Icon = direction === -1 ? ChevronLeft : ChevronRight;
  const nextMonth = shiftMonth(month, direction);
  return (
    <Link
      to={to}
      search={
        hero ? { month: nextMonth } : (prev: Record<string, unknown>) => ({ ...prev, from: undefined, to: undefined, month: nextMonth })
      }
      aria-label={direction === -1 ? "Previous month" : "Next month"}
      className={
        hero
          ? "flex size-11 shrink-0 items-center justify-center rounded-control text-on-ink transition-[background-color,transform] duration-150 hover:bg-hero-raised active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100"
          : "flex size-11 shrink-0 items-center justify-center rounded-control transition-[background-color,transform] duration-150 hover:bg-sunken active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100"
      }
    >
      <Icon size={hero ? 20 : 18} strokeWidth={1.75} aria-hidden={hero ? undefined : "true"} />
    </Link>
  );
}
