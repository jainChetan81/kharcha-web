import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { DeskPage } from "../components/app-shell";
import { BudgetBar } from "../components/budget-bar";
import { PlanError, PlanHeader, PlanPending } from "../components/plan-screen";
import { saveFailed } from "../components/sheet";
import { Button, ButtonLink, Field, Suggestion } from "../components/ui";
import { money, monthLabel, overOrLeft, thisMonth } from "../lib/format";
import { saveBudget } from "../server/fns";
import { getPlanBudgets } from "../server/plan/fns";

export const Route = createFileRoute("/plan/budgets")({ loader: () => getPlanBudgets({ data: { month: thisMonth() } }), pendingComponent: PlanPending, errorComponent: PlanError, component: Budgets });
function Budgets() {
  const rows = Route.useLoaderData(); const router = useRouter(); const { reviewCount } = getRouteApi("__root__").useLoaderData(); const [open, setOpen] = useState<string>(); const [limit, setLimit] = useState(""); const [saving, setSaving] = useState(false); const days = new Date().getDate(); const count = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate(); const pace = days / count;
  const otherHasBudget = rows.some((row) => row.name === "Other" && row.limit);
  const spent = rows.reduce((sum, row) => sum + row.spent, 0); const gross = rows.reduce((sum, row) => sum + row.gross, 0); const total = rows.reduce((sum, row) => sum + (row.limit ?? 0), 0);
  const totalReimbursable = Math.max(0, gross - spent);
  const save = async (category: string, value: number) => {
    if (saving) return;
    setSaving(true);
    try {
      await saveBudget({ data: { category, monthlyLimit: value } });
      setOpen(undefined);
      void router.invalidate();
    } catch {
      saveFailed(() => void save(category, value));
    } finally {
      setSaving(false);
    }
  };
  const otherHint = !otherHasBudget && reviewCount > 0;
  return <DeskPage reserveRail rail={otherHint && <Suggestion><b>Other has no budget</b><p className="mt-1 text-sm text-ink-2">Review files most of it.</p><ButtonLink to="/review" variant="text" className="text-sm">Review</ButtonLink></Suggestion>}><PlanHeader sub={`${monthLabel(thisMonth())} · day ${days} of ${count}`} /><section className="mx-5 mt-4 flex flex-col gap-2.5 border-b-[3px] border-double border-ink pb-5 desk:mx-0"><div className="flex items-baseline justify-between"><strong className="font-serif text-[34px] font-medium">{money(spent)}</strong><span className="text-[15px] text-ink-2">{total ? `of ${money(total)}` : "no budget"}</span></div><BudgetBar spent={gross} limit={total} reimbursable={totalReimbursable} pacePct={pace} /><div className="flex justify-between text-[13px] text-ink-2"><span className="font-medium text-watch-text">{total ? `${overOrLeft(spent, total)} for ${count - days} days` : "No budget set yet"}</span>{total ? <span>Tick = where you should be today</span> : null}</div></section><section className="mx-5 desk:mx-0">{rows.map((row) => { const projected = pace ? row.spent / pace : row.spent; const tone = projected > (row.limit ?? Infinity) ? "text-over" : projected > (row.limit ?? Infinity) * .9 ? "text-watch-text" : "text-earn"; const rowReimbursable = Math.max(0, row.gross - row.spent); return <div key={row.name} className="border-b border-hairline"><button type="button" className="flex w-full flex-col gap-2 py-3.5 text-left" onClick={() => { setOpen(open === row.name ? undefined : row.name); setLimit(String(row.limit ?? "")); }}><span className="flex justify-between text-[15px]"><span className="font-medium"><i className="mr-2 inline-block size-2 rounded-[2px]" style={{ background: `var(--color-${row.colorToken})` }} />{row.name}</span><span className="font-medium">{money(row.spent)} <em className="not-italic text-ink-3">/ {row.limit ? money(row.limit) : "No budget"}</em></span></span>{row.limit && <BudgetBar spent={row.gross} limit={row.limit} reimbursable={rowReimbursable} pacePct={pace} />}<span className={`text-[13px] font-medium ${tone}`}>{row.limit ? projected > row.limit ? `${money(projected)} projected` : `On track to end at ${money(projected)}` : "Add a budget"}</span></button>{open === row.name && <div className="flex items-end gap-2 pb-4"><Field id={`limit-${row.name}`} label="Monthly limit" inputMode="decimal" value={limit} error={limit.trim() !== "" && !(Number(limit) > 0) ? "Enter an amount above 0" : undefined} onChange={(event) => setLimit(event.target.value)} className="flex-1" /><Button disabled={saving || !(Number(limit) > 0)} onClick={() => void save(row.name, Number(limit))}>{saving ? "Saving…" : "Save"}</Button>{row.limit ? <Button variant="danger" disabled={saving} onClick={() => void save(row.name, 0)}>{saving ? "Deleting…" : "Remove"}</Button> : null}</div>}</div>; })}</section>{otherHint && <Suggestion className="mx-5 mt-5 flex items-center justify-between desk:mx-0"><div><b>Other</b><p className="m-0 text-sm text-ink-2">No budget. Review files most of it.</p></div><ButtonLink to="/review" variant="text" className="text-sm">Review</ButtonLink></Suggestion>}</DeskPage>;
}
