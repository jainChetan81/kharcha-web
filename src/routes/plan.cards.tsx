import { createFileRoute } from "@tanstack/react-router";
import { DeskPage } from "../components/app-shell";
import { PlanError, PlanHeader, PlanPending } from "../components/plan-screen";
import { SectionHead } from "../components/ui";
import { card, dayMonth, money, monthLabel, shortDate, thisMonth } from "../lib/format";
import { getCards } from "../server/plan/fns";

export const Route = createFileRoute("/plan/cards")({
  loader: () => getCards(),
  pendingComponent: PlanPending,
  errorComponent: PlanError,
  component: CardsScreen,
});

function CardsScreen() {
  const cards = Route.useLoaderData();
  const total = cards.reduce((sum, c) => sum + c.owed, 0);
  return (
    <DeskPage>
      <PlanHeader sub={monthLabel(thisMonth())} />
      <section className="mx-5 mt-4 flex flex-col gap-2 border-b-[3px] border-double border-ink pb-5 desk:mx-0">
        <span className="label-caps text-ink-3">Card spend not yet paid</span>
        <strong className="font-serif text-[44px] leading-none font-medium desk:text-[52px]">{money(total)}</strong>
        <span className="text-sm text-ink-2">Card spends count when made. A bill payment settles the card and is not counted again.</span>
      </section>
      {cards.map((c) => (
        <section key={c.card} className="mx-5 mt-5 desk:mx-0">
          <SectionHead title={`${c.name} ${card(c.card)}`} action={<strong className="font-semibold">{money(c.owed)}</strong>} />
          {c.bill && (
            <p className="mt-1 text-sm">
              {c.bill.amount !== null ? `Latest bill ${money(c.bill.amount)}` : `Statement generated ${dayMonth(c.bill.issued)}`}
              {c.bill.dueDate ? ` · due ${dayMonth(c.bill.dueDate)}` : ""}
              {c.lastPayment && c.bill.issued <= c.lastPayment.date.slice(0, 10) ? " · paid" : ""}
            </p>
          )}
          <p className="mt-1 text-sm text-ink-2">
            {c.spends} spends since {c.lastPayment ? `the ${money(c.lastPayment.amount)} payment on ${shortDate(c.lastPayment.date)}` : "the start"}.
          </p>
          {c.payments.length > 0 && (
            <div className="mt-2 divide-y divide-hairline">
              {c.payments.map((p) => (
                <div key={p.id} className="flex min-h-11 items-center justify-between gap-2 text-sm">
                  <span className="text-ink-2">Paid {shortDate(p.date)}</span>
                  <span className="font-medium">{money(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </DeskPage>
  );
}
