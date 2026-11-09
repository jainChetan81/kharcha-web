import { monthLabel } from "../lib/format";
import { MonthArrow } from "./month-arrow";

/** Activity/Insights header chip: "October 2026" with ‹ ›. A custom range replaces the label and drops the arrows. */
export function MonthStepper({
  to,
  month,
  label,
  onOpen,
}: {
  to: "/activity" | "/insights";
  month: string;
  label?: string;
  onOpen: () => void;
}) {
  const text = label ?? monthLabel(month);
  return (
    <span className="flex min-h-11 items-center rounded-full border border-field bg-card text-ink">
      {!label && <MonthArrow to={to} month={month} direction={-1} />}
      <button
        type="button"
        onClick={onOpen}
        className={`min-h-11 ${label ? "px-4" : "px-1"} rounded-control text-control font-medium whitespace-nowrap transition-[background-color,transform] duration-150 hover:bg-sunken active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100`}
      >
        {text}
      </button>
      {!label && <MonthArrow to={to} month={month} direction={1} />}
    </span>
  );
}
