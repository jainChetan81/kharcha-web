// AppShell (§5): phone tab bar + add button; ≥840px sidebar with trip card, sync pill, Settings.
import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { dayMonth } from "../lib/format";
import { ActivityIcon, InsightsIcon, PlanIcon, PlusIcon, TodayIcon, WealthIcon } from "./icons";
import { SyncPill } from "./sync-pill";

export type ShellData = { reviewCount: number; trip: { id: number; name: string; startDate: string; endDate: string; autoTag: boolean; active: boolean } | null };

const tabs = [
  { to: "/", label: "Today", icon: TodayIcon, match: (p: string) => p === "/" || p === "/review" },
  { to: "/activity", label: "Activity", icon: ActivityIcon, match: (p: string) => p.startsWith("/activity") || p.startsWith("/txn") },
  { to: "/plan/budgets", label: "Plan", icon: PlanIcon, match: (p: string) => p.startsWith("/plan") },
  { to: "/wealth", label: "Wealth", icon: WealthIcon, match: (p: string) => p.startsWith("/wealth") },
  { to: "/insights", label: "Insights", icon: InsightsIcon, match: (p: string) => p.startsWith("/insights") },
] as const;

const side = [
  { to: "/", label: "Today", match: (p: string) => p === "/" },
  { to: "/review", label: "Review", match: (p: string) => p.startsWith("/review") },
  { to: "/activity", label: "Activity", match: (p: string) => p.startsWith("/activity") || p.startsWith("/txn") },
  { to: "/plan/budgets", label: "Plan", match: (p: string) => p.startsWith("/plan") },
  { to: "/wealth", label: "Wealth", match: (p: string) => p.startsWith("/wealth") },
  { to: "/insights", label: "Insights", match: (p: string) => p.startsWith("/insights") },
  { to: "/ask", label: "Ask", match: (p: string) => p.startsWith("/ask") },
] as const;

/** Full-screen routes on phones: no tab bar, no add button. */
const bare = (p: string) => /^\/(review(?:\/|$)|add|paste|ask|settings|txn\/.+\/(edit|receipt)|plan\/(trips|recurring)\/(new|\d+)|wealth\/(new|\d+\/edit))/.test(p);

export function AppShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const hideChrome = bare(path);
  const planAction = path === "/plan/trips" || path === "/plan/recurring";
  const { trip } = data;
  return (
    <div className="min-h-dvh desk:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-rule bg-card px-4 py-7 desk:flex">
        <span className="px-3 font-serif text-[26px] font-medium">Kharcha</span>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {side.map((n) => {
            const on = n.match(path);
            return (
              <Link
                key={n.to}
                to={n.to}
                aria-current={on ? "page" : undefined}
                className={cn("flex min-h-11 items-center justify-between rounded-button px-3 text-[15px]", on ? "bg-brand-soft font-semibold text-brand-deep" : "text-ink hover:bg-sunken hover:text-ink")}
              >
                <span>{n.label}</span>
                {n.to === "/review" && data.reviewCount > 0 && <span className="text-[13px] font-semibold text-brand">{data.reviewCount}</span>}
              </Link>
            );
          })}
        </nav>
        {trip && (
          <Link to="/plan/trips/$id" params={{ id: String(trip.id) }} className="mx-1 flex flex-col gap-0.5 rounded-button bg-trip p-3 text-on-ink hover:text-on-ink">
            <span className="font-serif text-[18px]">{trip.name}</span>
            <span className="text-xs text-trip-muted">
              {trip.active ? `Until ${dayMonth(trip.endDate)}` : `Starts ${dayMonth(trip.startDate)}`}
              {trip.autoTag ? " · auto-tag on" : ""}
            </span>
          </Link>
        )}
        <div className="mt-auto flex flex-col gap-2.5 px-3">
          <span className="self-start"><SyncPill /></span>
          <Link to="/settings" className="flex min-h-10 items-center self-start text-sm font-medium">Settings</Link>
        </div>
      </aside>

      <div className={cn("mx-auto w-full min-w-0 tablet:max-w-[640px] desk:mx-0 desk:max-w-none desk:flex-1", !hideChrome && "pb-[calc(138px+env(safe-area-inset-bottom))] desk:pb-0", planAction && "pb-[calc(184px+env(safe-area-inset-bottom))]")}>
        {children}
      </div>

      {!hideChrome && (
        <>
          <Link
            to="/add"
            aria-label="Add transaction"
            className="fixed right-5 bottom-[calc(66px+env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-2xl bg-ink text-paper shadow-[0_6px_16px_rgba(28,34,48,0.22)] hover:text-paper desk:hidden"
          >
            <PlusIcon />
          </Link>
          <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid h-[calc(50px+env(safe-area-inset-bottom))] grid-cols-5 border-t border-rule bg-card pb-[env(safe-area-inset-bottom)] desk:hidden">
            {tabs.map((t) => {
              const on = t.match(path);
              const Icon = t.icon;
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  aria-current={on ? "page" : undefined}
                  className={cn("-mt-px flex flex-col items-center justify-center gap-[3px] text-[11px]", on ? "border-t-2 border-brand font-semibold text-brand" : "text-ink-3")}
                >
                  <Icon />
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </>
      )}
    </div>
  );
}

/** Desktop page frame: main column plus a 300px right rail (§5). Rail stacks under main on phones. */
export function DeskPage({ children, rail, className, railClassName }: { children: ReactNode; rail?: ReactNode; className?: string; railClassName?: string }) {
  return (
    <div className={cn("desk:flex desk:items-start desk:gap-8 desk:px-[clamp(20px,3vw,40px)] desk:pt-7 desk:pb-10", className)}>
      <main className="min-w-0 desk:flex-1">{children}</main>
      {rail && <aside className={cn("flex flex-col gap-5 px-5 pt-6 desk:sticky desk:top-7 desk:w-[300px] desk:shrink-0 desk:px-0 desk:pt-0", railClassName)}>{rail}</aside>}
    </div>
  );
}
