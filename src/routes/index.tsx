import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { monthLabel, money, shiftMonth, shortDate, thisMonth } from "../lib";
import { getOverview } from "../server/fns";

export const Route = createFileRoute("/")({
  validateSearch: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
  loaderDeps: ({ search }) => ({ month: search.month ?? thisMonth() }),
  loader: ({ deps }) => getOverview({ data: deps }),
  component: Today,
});

function Today() {
  const { summary, recent } = Route.useLoaderData();
  const total = (type: string) => summary.totals.find((t) => t.type === type)?.total ?? 0;
  const spent = total("expense");
  const top = summary.categories[0]?.total ?? 1;
  return (
    <>
      <header className="flex items-center justify-between">
        <Link to="/" search={{ month: shiftMonth(summary.month, -1) }} className="btn-ghost" aria-label="Previous month">
          ‹
        </Link>
        <h1 className="text-lg font-semibold">{monthLabel(summary.month)}</h1>
        <Link to="/" search={{ month: shiftMonth(summary.month, 1) }} className="btn-ghost" aria-label="Next month">
          ›
        </Link>
      </header>

      <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
        <p className="text-sm text-ink/60">Spent</p>
        <p className="text-4xl font-bold tracking-tight text-spend">{money(spent)}</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-ink/60">Income</dt>
            <dd className="font-semibold text-earn">{money(total("income"))}</dd>
          </div>
          <div>
            <dt className="text-ink/60">Invested</dt>
            <dd className="font-semibold">{money(total("investment"))}</dd>
          </div>
        </dl>
        {summary.reviewCount > 0 && (
          <Link to="/history" search={{ review: true }} className="mt-4 block text-sm font-semibold text-brand">
            {summary.reviewCount} to review →
          </Link>
        )}
      </section>

      <section className="mt-6" aria-labelledby="cat-h">
        <h2 id="cat-h" className="font-semibold">By category</h2>
        {summary.categories.length === 0 && <p className="mt-2 text-sm text-ink/60">No spending yet.</p>}
        <ul className="mt-2 space-y-2">
          {summary.categories.map((c) => (
            <li key={c.category}>
              <Link to="/history" search={{ month: summary.month, search: c.category }} className="block">
                <div className="flex justify-between text-sm">
                  <span>{c.category}</span>
                  <span className="font-semibold">{money(c.total)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-line">
                  <div className="h-full rounded bg-brand" style={{ width: `${(c.total / top) * 100}%` }} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6" aria-labelledby="recent-h">
        <h2 id="recent-h" className="font-semibold">Recent</h2>
        <ul className="mt-2 divide-y divide-line rounded-2xl bg-white">
          {recent.map((t) => (
            <li key={t.id} className="flex justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium">{t.merchant}</span>
                <span className="text-ink/60">{shortDate(t.date)} · {t.category ?? "Uncategorised"}</span>
              </span>
              <span className={t.type === "income" ? "font-semibold text-earn" : "font-semibold"}>
                {t.type === "income" ? "+" : ""}
                {money(t.amount)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-6 text-xs text-ink/50">
        Last sync from Mac mini: {summary.lastIngestAt ? new Date(summary.lastIngestAt).toLocaleString("en-IN") : "never"}
      </p>
    </>
  );
}
