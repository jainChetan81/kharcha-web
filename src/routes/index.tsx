import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { MessageCircle, Plus, Settings } from "lucide-react";
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
import { money, navsOf, overOrLeft, signed, thisMonth } from "../lib/format";
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
  const hero = <InkHero className="desk:gap-5">
    <header className="-ml-3 flex min-w-0 items-center justify-between gap-1 desk:ml-0">
      <MonthSwitcher month={month} compact />
      <div className="flex shrink-0 items-center gap-0 desk:gap-3">
        <span className="hidden min-[420px]:inline-flex"><SyncPill onInk short /></span>
        <Link to="/settings" aria-label="Settings" className="flex size-11 items-center justify-center text-on-ink hover:text-on-ink"><Settings size={20} strokeWidth={1.75} /></Link>
        <Link to="/ask" className="flex min-h-9 items-center gap-1 rounded-chip bg-paper px-3 text-sm font-medium text-ink hover:text-ink"><MessageCircle size={16} />Ask</Link>
        <Link to="/add" className="hidden min-h-9 items-center gap-1 rounded-chip bg-paper px-3 text-sm font-medium text-ink hover:text-ink desk:flex"><Plus size={16} />Add</Link>
      </div>
    </header>
    <div className="flex items-end justify-between gap-2">
      <div className="min-w-0"><span className="text-xs tracking-[0.08em] text-on-ink-2 uppercase">Spent this month</span><div className="mt-1"><HeroAmount value={money(today.spent)} size="lg" /></div></div>
      <span className="pb-1 text-right text-[13px] whitespace-nowrap text-on-ink-2 desk:hidden">of {money(today.limit)}<br /><b className="text-on-ink-month">{overOrLeft(today.spent, today.limit)}</b></span>
    </div>
    <div className="hidden grid-cols-3 border-t border-on-ink/20 pt-3 desk:grid">
      <span className="text-sm text-on-ink-2">Budget <b className="block font-serif text-2xl font-medium text-on-ink">{money(today.limit)}</b></span>
      <span className="text-sm text-on-ink-2">Left <b className="block font-serif text-2xl font-medium text-on-ink-month">{overOrLeft(today.spent, today.limit)}</b></span>
      <span className="text-sm text-on-ink-2">Due in 10 days <Link to="/plan/recurring" className="block font-serif text-2xl font-medium text-on-ink hover:text-on-ink">{money(due)}</Link></span>
    </div>
    <PaceChart month={month} points={today.points} previous={today.previous} limit={today.limit} />
  </InkHero>;
  const upcomingSection = upcoming.length > 0 && <section>
    <SectionHead title="Next 10 days" action={<Link to="/plan/recurring">{money(due)} due</Link>} />
    <div className="mt-3 grid grid-cols-3 gap-2">{upcoming.slice(0, 3).map((item) => <Card key={`${item.seriesId}-${item.date}`} className="flex min-w-0 flex-col gap-1 p-2.5"><span className="font-serif text-[22px] leading-none">{item.date.slice(-2)} <small className="font-sans text-[11px] text-ink-3">{new Date(`${item.date}T00:00:00`).toLocaleString("en-IN", { weekday: "short" })}</small></span><span className="truncate text-[13px] font-medium">{item.name}</span><span className="text-[13px] text-ink-2">{money(item.amount)}</span></Card>)}</div>
  </section>;
  const review = today.reviewCount > 0 && <Link to="/review" className="flex min-h-[52px] items-center justify-between gap-2 rounded-card border border-brand px-3.5 text-[15px] text-ink hover:text-ink"><span className="flex items-center gap-2"><i className="size-2 shrink-0 rounded-full bg-brand" /><strong>{today.reviewCount} to review</strong><span className="text-ink-2">· {money(today.reviewOther)} in Other</span></span><strong className="text-sm text-brand">Start</strong></Link>;
  const wealthRow = wealth && <Link to="/wealth" className="grid min-h-[92px] grid-cols-[1fr_auto] items-center gap-3 rounded-card border border-rule bg-card px-4 py-3.5 text-ink hover:text-ink"><span><small className="text-xs tracking-[0.08em] text-ink-3 uppercase">Wealth</small><strong className="block font-serif text-[26px] font-medium leading-tight">{money(wealth.value)}</strong>{wealth.navDate && <span className="text-xs text-ink-3">{navsOf(wealth.navDate)} · {signed(wealth.dayChange)} since previous NAV</span>}</span><span className="flex flex-col items-end gap-1"><Sparkline values={wealth.spark} label="Net contributions by transaction, ending at current value" /><small className="text-[10px] text-ink-3">Contributions</small></span></Link>;
  return <DeskPage rail={<><DigestCard digest={digest} />{upcomingSection}</>}>
    {hero}
    <div className="mt-4 desk:hidden">{shell.trip && <div className="mb-4"><TripBand trip={shell.trip} /></div>}<DigestCard digest={digest} /></div>
    <div className="space-y-6 px-5 pt-6 desk:px-0">
      <div className="desk:hidden">{upcomingSection}</div>
      {review}
      <div className="hidden desk:block">{wealthRow}</div>
      <section><SectionHead title="Where it went" action={<Link to="/insights" search={{ month }}>Insights</Link>} /><div className="mt-3"><Treemap rows={today.categories} month={month} /></div></section>
      <div className="desk:hidden">{wealthRow}</div>
      <section><SectionHead title="Recent" action={<Link to="/activity">Activity</Link>} />{today.recent.length ? today.recent.map((item) => <LedgerRow key={item.id} t={item} withDate />) : <Empty text="No transactions yet" action={<Link to="/add">Add one</Link>} />}</section>
    </div>
  </DeskPage>;
}
