import { monthLabel } from "../lib/format";
import { MonthArrow } from "./month-arrow";

export function MonthSwitcher({ month, to = "/", compact = false }: { month: string; to?: "/" | "/activity"; compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center">
      <MonthArrow to={to} month={month} direction={-1} hero />
      <h1 className={`m-0 min-w-0 font-serif font-medium ${compact ? "text-section leading-tight min-[440px]:text-title" : "text-title"}`}>
        {monthLabel(month)}
      </h1>
      <MonthArrow to={to} month={month} direction={1} hero />
    </div>
  );
}
