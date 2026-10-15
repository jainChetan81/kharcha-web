import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { money, monthLabel, thisMonth } from "../lib";
import { getOverview, saveBudget } from "../server/fns";

export const Route = createFileRoute("/budgets")({
  loader: () => getOverview({ data: { month: thisMonth() } }),
  component: Budgets,
});

function Budgets() {
  const { summary } = Route.useLoaderData();
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const target = event.currentTarget;
    setBusy(true);
    setStatus("");
    try {
      await saveBudget({
        data: { category: String(form.get("category")), monthlyLimit: Number(form.get("limit")) },
      });
      await router.invalidate();
      target.reset();
      setStatus("Saved.");
    } catch {
      setStatus("Could not save. Check the fields and your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-lg font-semibold">Budgets · {monthLabel(summary.month)}</h1>
      <ul className="mt-4 space-y-3">
        {summary.categories.map((c) => {
          const pct = c.limit ? Math.min(100, (c.total / c.limit) * 100) : 0;
          const over = c.limit !== null && c.total > c.limit;
          return (
            <li key={c.category} className="rounded-2xl bg-white p-4">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{c.category}</span>
                <span className={over ? "font-semibold text-spend" : "font-semibold"}>
                  {money(c.total)}
                  {c.limit !== null && <span className="font-normal text-ink/60"> / {money(c.limit)}</span>}
                </span>
              </div>
              {c.limit !== null && (
                <div
                  className="mt-2 h-2 rounded bg-line"
                  role="progressbar"
                  aria-label={`${c.category} budget used`}
                  aria-valuenow={Math.round(pct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className={over ? "h-full rounded bg-spend" : "h-full rounded bg-brand"} style={{ width: `${pct}%` }} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <form onSubmit={submit} className="mt-6 space-y-3 rounded-2xl bg-white p-4">
        <h2 className="font-semibold">Set a monthly budget</h2>
        <label className="block text-sm font-medium">
          Category
          <input name="category" list="budget-categories" required maxLength={40} className="field mt-1" />
          <datalist id="budget-categories">
            {summary.categories.map((c) => (
              <option key={c.category} value={c.category} />
            ))}
          </datalist>
        </label>
        <label className="block text-sm font-medium">
          Limit (₹, 0 removes it)
          <input name="limit" type="number" inputMode="decimal" min="0" step="1" required className="field mt-1" />
        </label>
        <button type="submit" disabled={busy} className="btn w-full">
          {busy ? "Saving…" : "Save budget"}
        </button>
        <p role="status" className="text-sm">{status}</p>
      </form>
    </>
  );
}
