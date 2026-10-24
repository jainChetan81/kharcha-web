import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Beeswarm } from "../components/charts/beeswarm";
import { DayRings } from "../components/charts/day-rings";
import { SixMonths } from "../components/charts/six-months";
import { Waterfall } from "../components/charts/waterfall";
import { DeskPage } from "../components/app-shell";
import { InsightCard, type InsightView } from "../components/insight-card";
import { Empty, ErrorState, PageHeader, SectionHead, Skeleton } from "../components/ui";
import { compact, money, monthLabel, rangeLabel, signed } from "../lib/format";
import { ActivityFilters } from "../components/activity-filters";
import { MonthStepper } from "../components/month-stepper";
import { pickScope, scopeSearch, type ScopeSearch } from "../lib/filters";
import { getActivityMeta } from "../server/daily/fns";
import { dismissInsight, getInsights } from "../server/insights/fns";
import { AiMark } from "../components/ai-mark";
import { getTransactionSummary } from "../server/fns";

export const Route = createFileRoute("/insights")({
  validateSearch: scopeSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [data, meta] = await Promise.all([getInsights({ data: deps }), getActivityMeta()]);
    return { ...data, meta };
  },
  pendingComponent: () => <div className="p-5"><Skeleton rows={8} /></div>,
  errorComponent: () => { const router = useRouter(); return <ErrorState retry={() => router.invalidate()} />; },
  component: Insights,
});

function Figure({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return <section className="flex flex-col gap-4"><div className="border-b border-ink pb-2"><span className="label-caps text-ink-3">Fig. {number}</span><h2 className="m-0 mt-0.5 font-serif text-xl font-medium">{title}</h2></div>{children}</section>;
}

function Insights() {
  const data = Route.useLoaderData(); const search = Route.useSearch(); const router = useRouter(); const [dateOpen, setDateOpen] = useState(false);
  // The server defaults to this month; links must say so, or Activity/Ask widen to all time.
  const scope = { ...pickScope(search), ...(search.from || search.to ? {} : { month: data.month }) };
  // Same count Activity shows for this scope; a whole month stays the default when no range is set.
  const getCount = async (draft: Record<string, unknown>) => { const s = pickScope(draft); return (await getTransactionSummary({ data: { ...s, month: s.from || s.to ? undefined : s.month ?? data.month } })).count; };
  const change = (next: Partial<ScopeSearch>) => void router.navigate({ to: "/insights", search: { ...search, ...next } });
  const period = data.from && data.to ? rangeLabel(data.from, data.to) : data.from || data.to ? `${data.from ?? "…"} – ${data.to ?? "now"}` : monthLabel(data.month);
  const [hidden, setHidden] = useState<number[]>([]); const cards = data.insights.filter((item) => !hidden.includes(item.id)).map((item) => ({ id: item.id, detector: item.detector, payload: JSON.parse(item.payloadJson) as Record<string, unknown> })) as InsightView[];
  const dismiss = async (id: number) => { setHidden((list) => [...list, id]); try { await dismissInsight({ data: { id } }); } catch { setHidden((list) => list.filter((item) => item !== id)); } };
  const total = data.waterfall.spending;
  const kpis = [["Spent", money(total)], ["Income", money(data.waterfall.income)], ["Saved", signed(data.waterfall.saved)], ["Payments", String(data.bees.length)]];
  const rail = <><section className="flex flex-col gap-3"><span className="label-caps text-ink-3">Worth a look · {cards.length}</span>{cards.length ? cards.map((card) => <InsightCard key={card.id} insight={card} onDismiss={dismiss} />) : <Empty text="Nothing needs a closer look." action={<Link to="/activity" search={scope} className="text-sm font-medium text-brand">View activity</Link>} />}</section><section className="flex flex-col gap-1"><SectionHead title="Top merchants" /><MerchantTable rows={data.merchants} scope={scope} /></section></>;
  return <DeskPage rail={rail}><PageHeader title="Insights" sub={period} actions={<Link to="/ask" search={scope} className="ai-button inline-flex min-h-11 desk:min-h-10 items-center gap-2 rounded-chip px-3.5 text-sm font-medium text-white hover:text-white"><AiMark />Ask</Link>} /><div className="flex flex-col gap-7 px-5 pb-4 desk:px-0"><ActivityFilters search={search} categories={data.meta.categories} cards={data.meta.cards} trips={data.meta.trips} getCount={getCount} onApply={change} onClear={() => void router.navigate({ to: "/insights", search: { month: search.month } })} dateOpen={dateOpen} onDateClose={() => setDateOpen(false)} month={<MonthStepper to="/insights" month={data.month} label={data.from || data.to ? period : undefined} onOpen={() => setDateOpen(true)} />} /><div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-rule bg-rule tablet:grid-cols-4">{kpis.map(([label, value]) => <div key={label} className="flex min-h-[92px] flex-col justify-between bg-card p-3"><span className="text-xs text-ink-3">{label}</span><strong className="font-serif text-2xl font-medium whitespace-nowrap">{value}</strong></div>)}</div><section className="flex flex-col gap-3 desk:hidden"><span className="label-caps text-ink-3">Worth a look · {cards.length}</span>{cards.length ? cards.map((card) => <InsightCard key={card.id} insight={card} onDismiss={dismiss} />) : <Empty text="Nothing needs a closer look." action={<Link to="/activity" search={scope} className="text-sm font-medium text-brand">View activity</Link>} />}</section><div className="grid gap-7 desk:grid-cols-2"><Figure number={1} title={`Where ${period}’s money went`}><Waterfall values={data.waterfall} /></Figure><Figure number={2} title={`${monthLabel(data.month)}, day by day`}><DayRings rows={data.daily} month={data.month} /></Figure></div><Figure number={3} title="Every payment in view"><Beeswarm rows={data.bees} /></Figure><div className="desk:grid desk:grid-cols-[minmax(0,1fr)_300px] desk:gap-8"><Figure number={4} title="Six months, same scale"><SixMonths rows={data.six} /></Figure><section className="mt-7 desk:mt-0 desk:hidden"><SectionHead title="Top merchants" /><MerchantTable rows={data.merchants} scope={scope} /></section></div></div></DeskPage>;
}

function MerchantTable({ rows, scope }: { rows: { merchant: string; total: number; n: number }[]; scope: ScopeSearch }) {
  if (!rows.length) return <Empty text="No spending in this period." action={<Link to="/activity" search={scope} className="text-sm font-medium text-brand">View activity</Link>} />;
  return <div>{rows.map((row) => <Link key={row.merchant} to="/activity" search={{ ...scope, merchant: row.merchant }} className="flex min-h-11 items-center justify-between gap-2 border-b border-hairline text-[14px] text-ink"><span className="min-w-0 truncate">{row.merchant} <small className="text-xs text-ink-3">· {row.n} {row.n === 1 ? "row" : "rows"}</small></span><strong className="shrink-0 font-medium">{compact(row.total)}</strong></Link>)}</div>;
}
