import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Plus, Settings } from "lucide-react";
import { AiMark } from "../components/ai-mark";
import { z } from "zod";
import { DeskPage } from "../components/app-shell";
import { DigestCard } from "../components/digest-card";
import { HeroAmount, InkHero } from "../components/ink-hero";
import { LedgerRow } from "../components/ledger";
import { Sparkline } from "../components/charts/sparkline";
import { TripBand } from "../components/trip-band";
import { MonthSwitcher } from "../components/month-switcher";
import { PaceChart } from "../components/pace-chart";
import { SyncPill } from "../components/sync-pill";
import { Card, Empty, ErrorState, SectionHead, Skeleton } from "../components/ui";
import { Treemap } from "../components/treemap";
import { dayMonth, money, navsOf, overOrLeft, signed, statementOf, thisMonth, weekday } from "../lib/format";
import { getTodayData } from "../server/daily/today";
import { getDigest } from "../server/insights/fns";
import { getUpcoming } from "../server/plan/fns";
import { getWealthSummary } from "../server/wealth/fns";
import { Route as RootRoute } from "./__root";

export const Route = createFileRoute("/")({
  validateSearch: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => Promise.all([
    getTodayData({ data: { month: deps.month ?? thisMonth() } }),
    getDigest(), getUpcoming({ data: { days: 10 } }), getWealthSummary(),
  ]),
  pendingComponent: () => <main className="px-5"><Skeleton rows={8} /></main>,
  errorComponent: ({ error }) => { const router = useRouter(); return <ErrorState text={error instanceof Error ? error.message : "Couldn't load today."} retry={() => void router.invalidate()} />; },
  component: Today,
});

function Today() {
  const [today, digest, upcoming, wealth] = Route.useLoaderData();
  const shell = RootRoute.useLoaderData();
  const month = Route.useSearch().month ?? thisMonth();
  const due = upcoming.reduce((sum, item) => sum + item.amount, 0);
  const colorOf = new Map(today.colors.map((item) => [item.name, item.colorToken]));
  const budget = today.limit <= 0 ? "none" : today.spent > today.limit ? "over" : today.spent >= today.limit * 0.9 ? "near" : "under";
  const tone = { none: "text-on-ink-2", under: "text-on-ink-gain", near: "text-on-ink-month", over: "text-on-ink-over" }[budget];
  const hero = <InkHero className="desk:gap-5">
    <header className="-ml-3 flex min-w-0 flex-wrap items-center justify-between gap-2 desk:ml-0">
      <MonthSwitcher month={month} compact />
      <div className="flex shrink-0 items-center gap-0 desk:gap-3">
        <span className="hidden min-[420px]:inline-flex desk:hidden"><SyncPill onInk short /></span>
        <Link to="/settings" aria-label="Settings" className="flex size-11 items-center justify-center text-on-ink hover:text-on-ink desk:hidden"><Settings size={20} strokeWidth={1.75} /></Link>
        <Link to="/ask" className="ai-button flex min-h-11 items-center gap-1.5 rounded-chip px-3 text-sm font-medium text-white hover:text-white"><AiMark />Ask<span className="hidden pl-1 font-mono text-xs opacity-75 desk:inline">/</span></Link>
        <Link to="/add" className="hidden min-h-9 items-center gap-1 rounded-chip bg-paper px-3 text-sm font-medium text-ink hover:text-ink desk:flex"><Plus size={16} />Add</Link>
      </div>
    </header>
    <div className="flex items-end justify-between gap-2">
      <div className="min-w-0"><span className="text-xs tracking-[0.08em] text-on-ink-2 uppercase">Spent this month</span><div className="mt-1"><HeroAmount value={money(today.spent)} size="lg" /></div></div>
      {budget !== "none"
        ? <span className="pb-1 text-right text-[13px] whitespace-nowrap text-on-ink-2 desk:hidden">of {money(today.limit)}<br /><b className={tone}>{overOrLeft(today.spent, today.limit)}</b></span>
        : <Link to="/plan/budgets" className="pb-1 text-[13px] font-medium whitespace-nowrap text-on-ink hover:text-on-ink desk:hidden">Set a monthly budget</Link>}
    </div>
    <div className="hidden grid-cols-3 border-t border-on-ink/20 pt-3 desk:grid">
      <span className="text-sm text-on-ink-2">Budget {today.limit > 0 ? <b className="block font-serif text-[22px] font-medium text-on-ink">{money(today.limit)}</b> : <Link to="/plan/budgets" className="block font-serif text-[22px] font-medium text-on-ink hover:text-on-ink">Set one</Link>}</span>
      <span className="text-sm text-on-ink-2">Left <b className={`block font-serif text-[22px] font-medium ${tone}`}>{budget !== "none" ? overOrLeft(today.spent, today.limit) : "—"}</b></span>
      <span className="text-sm text-on-ink-2">Due in 10 days <Link to="/plan/recurring" className="block font-serif text-[22px] font-medium text-on-ink hover:text-on-ink">{money(due)}</Link></span>
    </div>
    <PaceChart month={month} points={today.points} previous={today.previous} limit={today.limit} />
  </InkHero>;
  const upcomingSection = upcoming.length > 0 && <section>
    <SectionHead title="Next 10 days" action={<Link to="/plan/recurring">{money(due)} due</Link>} />
    <div className="mt-3 grid grid-cols-3 gap-2">{upcoming.slice(0, 3).map((item) => <Card key={`${item.seriesId}-${item.date}`} className="flex min-w-0 flex-col gap-1 p-2.5"><span className="font-serif text-[22px] leading-none">{item.date.slice(-2)} <small className="font-sans text-[11px] text-ink-3">{weekday(item.date)}</small></span><span className="truncate text-[13px] font-medium">{item.name}</span><span className="text-[13px] text-ink-2">{money(item.amount)}</span></Card>)}</div>
  </section>;
  const review = today.reviewCount > 0 && <Link to="/review" className="flex min-h-[52px] items-center justify-between gap-2 rounded-card border border-brand px-3.5 text-[15px] text-ink hover:text-ink"><span className="flex items-center gap-2"><i className="size-2 shrink-0 rounded-full bg-brand" /><strong>{today.reviewCount} to review</strong>{today.reviewOther > 0 && <span className="text-ink-2">· {today.reviewOther} unreviewed in Other</span>}</span><strong className="text-sm text-brand">Start</strong></Link>;
  const wealthRow = wealth && <Link to="/wealth" className="block rounded-card border border-rule bg-card px-4 py-3 text-ink hover:text-ink">
    <div className="flex items-start justify-between gap-3"><span className="min-w-0"><small className="text-xs tracking-[0.08em] text-ink-3 uppercase">Wealth</small><strong className="block font-serif text-[26px] font-medium leading-tight">{money(wealth.value)}</strong></span><Sparkline values={wealth.spark} label="Net contributions by transaction, ending at current value" /></div>
    {(wealth.gain != null && wealth.gainPct != null) && <div className="mt-1 text-xs text-ink-2"><span className={wealth.gain >= 0 ? "text-earn" : "text-over"}>{signed(wealth.gain)}</span> · {wealth.gainPct.toFixed(1)}%{wealth.xirr != null && <> · XIRR {(wealth.xirr * 100).toFixed(1)}%</>}</div>}
    {wealth.nextSip && <div className="mt-1 text-xs text-ink-2">Next SIP {money(wealth.nextSip.amount)} · {dayMonth(wealth.nextSip.date)}</div>}
    {wealth.allocation.length > 0 && <div className="mt-2">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`Portfolio allocation by asset class: ${wealth.allocation.map((item) => `${item.name} ${Math.round(item.pct)}%`).join(", ")}`}>
        {wealth.allocation.map((item, index) => <span key={item.name} className="h-full" style={{ width: `${item.pct}%`, background: `var(--color-cat-${["food", "shopping", "transport", "utilities", "entertainment", "home", "health", "sports", "work", "other"][index % 10]})` }} />)}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] leading-tight text-ink-3">{wealth.allocation.slice(0, 3).map((item, index) => <span key={item.name} className="whitespace-nowrap"><i aria-hidden="true" className="mr-1 inline-block size-1.5 rounded-full align-middle" style={{ background: `var(--color-cat-${["food", "shopping", "transport", "utilities", "entertainment", "home", "health", "sports", "work", "other"][index]})` }} />{item.name} {Math.round(item.pct)}</span>)}</div>
    </div>}
    <div className="mt-1.5 text-[11px] text-ink-3">{wealth.holdings} holdings{wealth.navDate ? ` · ${navsOf(wealth.navDate)} · ${signed(wealth.dayChange)} since previous NAV` : wealth.asOf ? ` · ${statementOf(wealth.asOf)} · not live` : ""}</div>
  </Link>;
  return <DeskPage rail={<><DigestCard digest={digest} />{upcomingSection}</>} railClassName="hidden desk:flex">
    {hero}
    {(shell.trip || digest.status !== "none") && <div className="mt-4 desk:hidden">{shell.trip && <div className="mb-4"><TripBand trip={shell.trip} /></div>}<DigestCard digest={digest} /></div>}
    <div className="space-y-6 px-5 pt-6 desk:px-0">
      {upcomingSection && <div className="desk:hidden">{upcomingSection}</div>}
      {review}
      <div className="hidden desk:block">{wealthRow}</div>
      <section><SectionHead title="Where it went" action={<Link to="/insights" search={{ month }}>Insights</Link>} /><div className="mt-3"><Treemap rows={today.categories} month={month} reviewOther={today.reviewOther} /></div></section>
      <div className="desk:hidden">{wealthRow}</div>
      <section><SectionHead title="Recent" action={<Link to="/activity">Activity</Link>} />{today.recent.length ? today.recent.map((item) => <LedgerRow key={item.id} t={item} withDate color={colorOf.get(item.category ?? "Other")} />) : <Empty text="No transactions yet" action={<Link to="/add">Add one</Link>} />}</section>
    </div>
  </DeskPage>;
}
