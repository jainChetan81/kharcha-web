import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { DeskPage } from "../components/app-shell";
import { PlanError, PlanHeader, PlanPending } from "../components/plan-screen";
import { Empty, Segmented, StatusTag } from "../components/ui";
import { money, monthLabel, shortDate, thisMonth } from "../lib/format";
import { listOwed, type OwedRow } from "../server/daily/reimburse";

const searchSchema = z.object({
  view: z.enum(["pending", "done"]).default("pending").optional(),
});

export const Route = createFileRoute("/plan/owed")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ view: search.view ?? "pending" }),
  loader: ({ deps }) => listOwed({ data: { view: deps.view } }),
  pendingComponent: PlanPending,
  errorComponent: PlanError,
  component: OwedScreen,
});

function OwedScreen() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const view = search.view ?? "pending";

  const setView = (v: "pending" | "done") => {
    void router.navigate({
      to: "/plan/owed",
      search: { view: v },
    });
  };

  const tagTone = (status: OwedRow["status"], isOverdue: boolean) => {
    if (isOverdue) return "over" as const;
    if (status === "pending") return "pending" as const;
    if (status === "partly") return "partly" as const;
    if (status === "reimbursed") return "reimbursed" as const;
    if (status === "extra") return "extra" as const;
    return "cancelled" as const;
  };

  const tagLabel = (status: OwedRow["status"], isOverdue: boolean, daysOld: number) => {
    if (isOverdue) return `Overdue · ${daysOld}d`;
    if (status === "pending") return "Pending";
    if (status === "partly") return "Partly back";
    if (status === "reimbursed") return "Reimbursed";
    if (status === "extra") return "Extra back";
    return "Cancelled";
  };

  // Rail on desktop: By person breakdown
  const rail = (
    <div className="flex flex-col gap-6">
      {data.byPerson.length > 0 && (
        <section>
          <h2 className="m-0 border-b border-ink pb-2 font-serif text-lg font-medium">By person</h2>
          <div className="divide-y divide-hairline">
            {data.byPerson.map((p) => (
              <div
                key={p.counterparty}
                className="flex min-h-11 items-center justify-between gap-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  {p.counterparty} · {p.count}
                </span>
                <strong className="shrink-0 font-semibold">{money(p.totalDue)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );

  return (
    <DeskPage reserveRail rail={rail}>
      <PlanHeader sub={monthLabel(thisMonth())} />

      {/* Header totals */}
      <section className="mx-5 mt-4 flex flex-col gap-3 border-b-[3px] border-double border-ink pb-5 desk:mx-0">
        <span className="label-caps text-ink-3">Owed to you</span>
        <div className="flex flex-wrap items-baseline gap-6">
          <strong className="font-serif text-[44px] leading-none font-medium desk:text-[52px]">
            {money(data.totalOwed)}
          </strong>
          {view === "pending" && data.overdueCount > 0 && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-over">
              Overdue {money(data.overdueTotal)} · {data.overdueCount}
            </span>
          )}
          {view === "pending" && data.oldestDays > 0 && (
            <span className="text-sm text-ink-2">Oldest: {data.oldestDays} days</span>
          )}
        </div>

        {/* By person pills/summary on mobile */}
        {data.byPerson.length > 0 && (
          <div className="flex flex-wrap gap-3 pt-1 text-sm desk:hidden">
            {data.byPerson.map((p) => (
              <span key={p.counterparty} className="inline-flex min-w-0 items-center gap-1.5">
                <span className="size-2 shrink-0 rounded-dot bg-brand" />
                <span className="truncate">{p.counterparty}</span> <strong className="shrink-0 font-semibold">{money(p.totalDue)}</strong>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Pending / Done view switch */}
      <div className="mx-5 mt-4 desk:mx-0">
        <Segmented
          label="View"
          options={[
            {
              value: "pending",
              label:
                data.view === "pending" && data.rows.length
                  ? `Pending · ${data.rows.length}`
                  : "Pending",
            },
            { value: "done", label: "Done" },
          ]}
          value={view}
          onChange={(v) => setView(v as "pending" | "done")}
        />
      </div>

      {/* Rows */}
      <section className="mx-5 mt-2 desk:mx-0">
        {data.rows.length === 0 ? (
          <Empty
            text={
              view === "pending"
                ? "Nothing owed to you."
                : "No completed or cancelled reimbursements."
            }
            action={
              view === "pending" ? (
                <Link to="/activity" className="text-sm font-medium text-brand">
                  Mark a transaction
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => setView("pending")}
                  className="text-sm font-medium text-brand"
                >
                  View pending
                </button>
              )
            }
          />
        ) : (
          <div>
            {/* Desktop table header */}
            <div
              className="hidden min-h-9 items-center gap-3.5 border-b border-ink text-xs font-semibold tracking-[0.06em] text-ink-3 uppercase desk:grid desk:grid-cols-[76px_minmax(0,1.4fr)_90px_96px_96px_96px_120px]"
            >
              <span>Date</span>
              <span>Spend</span>
              <span>From</span>
              <span className="text-right">Paid</span>
              <span className="text-right">Yours</span>
              <span className="text-right">Due</span>
              <span>Status</span>
            </div>

            {/* List / Table rows */}
            <div className="divide-y divide-hairline">
              {data.rows.map((r) => (
                <Link
                  key={r.id}
                  to="/txn/$id"
                  params={{ id: String(r.transactionId) }}
                  className="flex flex-col gap-1 py-3 text-ink hover:bg-sunken/40 desk:grid desk:grid-cols-[76px_minmax(0,1.4fr)_90px_96px_96px_96px_120px] desk:items-center desk:gap-3.5 desk:py-2.5"
                >
                  {/* Mobile Row */}
                  <div className="flex min-w-0 items-baseline justify-between gap-2 desk:hidden">
                    <span className="min-w-0 truncate text-[15px] font-medium">{r.merchant}</span>
                    <strong className="shrink-0 text-[15px] font-semibold">
                      {r.status === "extra"
                        ? `+${money(r.linkedTotal - r.claimAmount)}`
                        : money(r.dueAmount)}
                    </strong>
                  </div>

                  <div className="flex min-w-0 items-center justify-between gap-2 text-[13px] text-ink-3 desk:hidden">
                    <span className="min-w-0 truncate">
                      {shortDate(r.spendDate)} · {r.counterparty}
                      {r.note ? ` · ${r.note}` : ""}
                    </span>
                    <StatusTag tone={tagTone(r.status, r.isOverdue)} className="shrink-0">
                      {tagLabel(r.status, r.isOverdue, r.daysOld)}
                    </StatusTag>
                  </div>

                  {/* Desktop columns */}
                  <span className="hidden text-sm text-ink-2 desk:block">
                    {shortDate(r.spendDate)}
                  </span>
                  <span className="hidden truncate text-sm font-medium desk:block">
                    {r.merchant}
                    {r.note && <span className="ml-1 text-xs text-ink-3">({r.note})</span>}
                  </span>
                  <span className="hidden truncate text-sm desk:block">{r.counterparty}</span>
                  <span className="hidden text-right text-sm desk:block">{money(r.spendAmount)}</span>
                  <span className="hidden text-right text-sm text-ink-2 desk:block">
                    {money(r.yoursAmount)}
                  </span>
                  <span className="hidden text-right text-sm font-semibold desk:block">
                    {r.status === "extra"
                      ? `+${money(r.linkedTotal - r.claimAmount)}`
                      : money(r.dueAmount)}
                  </span>
                  <span className="hidden desk:block">
                    <StatusTag tone={tagTone(r.status, r.isOverdue)}>
                      {tagLabel(r.status, r.isOverdue, r.daysOld)}
                    </StatusTag>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>
    </DeskPage>
  );
}
