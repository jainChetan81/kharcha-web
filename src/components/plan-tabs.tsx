import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "../lib/cn";

const tabs = [{ to: "/plan/budgets", label: "Budgets" }, { to: "/plan/recurring", label: "Recurring" }, { to: "/plan/trips", label: "Trips" }] as const;
export function PlanTabs() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  return <nav aria-label="Plan sections" className="mx-5 grid grid-cols-3 gap-1 rounded-card bg-sunken p-1 desk:mx-0">{tabs.map((tab) => <Link key={tab.to} to={tab.to} aria-current={path === tab.to ? "page" : undefined} className={cn("flex min-h-[38px] items-center justify-center rounded-[9px] text-sm font-medium", path === tab.to ? "bg-card text-ink shadow-[0_1px_2px_rgba(28,34,48,0.12)]" : "text-ink-2")}>{tab.label}</Link>)}</nav>;
}
