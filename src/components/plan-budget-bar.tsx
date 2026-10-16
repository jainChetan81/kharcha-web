import { cn } from "../lib/cn";

export function PlanBudgetBar({ spent, limit, pacePct }: { spent: number; limit: number; pacePct: number }) {
  const projected = pacePct > 0 ? spent / pacePct : spent;
  const tone = projected > limit ? "bg-over" : projected > limit * 0.9 ? "bg-watch" : "bg-brand";
  return <div role="img" aria-label={`Spent ${spent} of ${limit}`} className="relative h-1.5 rounded-chip bg-[#E6E2D7]"><span className={cn("absolute inset-y-0 left-0 rounded-chip", tone)} style={{ width: `${Math.min(100, limit ? spent / limit * 100 : 0)}%` }} /><span className="absolute -top-1 h-3.5 w-0.5 bg-ink" style={{ left: `${Math.min(100, pacePct * 100)}%` }} /></div>;
}
