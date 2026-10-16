import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { useState } from "react";
import { Beeswarm } from "../components/charts/beeswarm";
import { DayRings } from "../components/charts/day-rings";
import { SixMonths } from "../components/charts/six-months";
import { Waterfall } from "../components/charts/waterfall";
import { DeskPage } from "../components/app-shell";
import { InsightCard, type InsightView } from "../components/insight-card";
import { Empty, ErrorState, PageHeader, SectionHead, Skeleton } from "../components/ui";
import { compact, money, monthLabel } from "../lib/format";
import { dismissInsight, getInsights } from "../server/insights/fns";

export const Route = createFileRoute("/insights")({
  validateSearch: (search: Record<string, unknown>) => ({ month: typeof search.month === "string" && /^\d{4}-\d{2}$/.test(search.month) ? search.month : undefined }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getInsights({ data: deps }),
  pendingComponent: () => <div className="p-5"><Skeleton rows={8} /></div>,
  errorComponent: () => { const router = useRouter(); return <ErrorState retry={() => router.invalidate()} />; },
  component: Insights,
});

function Figure({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return <section className="flex flex-col gap-4"><div className="border-b border-ink pb-2"><span className="label-caps text-ink-3">Fig. {number}</span><h2 className="m-0 mt-0.5 font-serif text-xl font-medium">{title}</h2></div>{children}</section>;
}

function Insights() {
  const data = Route.useLoaderData(); const [hidden, setHidden] = useState<number[]>([]); const cards = data.insights.filter((item) => !hidden.includes(item.id)).map((item) => ({ id: item.id, detector: item.detector, payload: JSON.parse(item.payloadJson) as Record<string, unknown> })) as InsightView[];
  const dismiss = async (id: number) => { setHidden((list) => [...list, id]); try { await dismissInsight({ data: { id } }); } catch { setHidden((list) => list.filter((item) => item !== id)); } };
  const total = data.waterfall.spending;
  const kpis = [["Spent", money(total)], ["Income", money(data.waterfall.income)], ["Saved", money(data.waterfall.saved)], ["Payments", String(data.bees.length)]];
  const rail = <><section className="flex flex-col gap-3"><span className="label-caps text-ink-3">Worth a look · {cards.length}</span>{cards.length ? cards.map((card) => <InsightCard key={card.id} insight={card} onDismiss={dismiss} />) : <Empty text="Nothing needs a closer look." />}</section><section className="flex flex-col gap-1"><SectionHead title="Top merchants" /><MerchantTable rows={data.merchants} /></section></>;
  return <DeskPage rail={rail}><PageHeader title={`Insights · ${monthLabel(data.month)}`} actions={<Link to="/ask" className="inline-flex min-h-10 items-center gap-2 rounded-button bg-ink px-3.5 text-sm font-medium text-on-ink"><MessageCircle size={16} strokeWidth={1.75} />Ask</Link>} /><div className="flex flex-col gap-7 px-5 pb-4 desk:px-0"><div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-rule bg-rule tablet:grid-cols-4">{kpis.map(([label, value]) => <div key={label} className="flex min-h-[92px] flex-col justify-between bg-card p-3"><span className="text-xs text-ink-3">{label}</span><strong className="font-serif text-2xl font-medium">{value}</strong></div>)}</div><section className="flex flex-col gap-3 desk:hidden"><span className="label-caps text-ink-3">Worth a look · {cards.length}</span>{cards.length ? cards.map((card) => <InsightCard key={card.id} insight={card} onDismiss={dismiss} />) : <Empty text="Nothing needs a closer look." />}</section><div className="grid gap-7 desk:grid-cols-2"><Figure number={1} title={`Where ${monthLabel(data.month)}’s money went`}><Waterfall values={data.waterfall} /></Figure><Figure number={2} title={`${monthLabel(data.month)}, day by day`}><DayRings rows={data.daily} month={data.month} /></Figure></div><Figure number={3} title="Every payment this month"><Beeswarm rows={data.bees} /></Figure><div className="desk:grid desk:grid-cols-[minmax(0,1fr)_300px] desk:gap-8"><Figure number={4} title="Six months, same scale"><SixMonths rows={data.six} /></Figure><section className="mt-7 desk:mt-0 desk:hidden"><SectionHead title="Top merchants" /><MerchantTable rows={data.merchants} /></section></div></div></DeskPage>;
}

function MerchantTable({ rows }: { rows: { merchant: string; total: number; n: number }[] }) {
  if (!rows.length) return <Empty text="No spending this month." />;
  return <div>{rows.map((row) => <Link key={row.merchant} to="/activity" className="flex min-h-11 items-center justify-between border-b border-hairline text-[14px] text-ink"><span>{row.merchant} <small className="text-xs text-ink-3">· {row.n} rows</small></span><strong className="font-medium">{compact(row.total)}</strong></Link>)}</div>;
}
