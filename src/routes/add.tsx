import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { nowLocal } from "../lib";
import { addTransaction, getCategories } from "../server/fns";

export const Route = createFileRoute("/add")({
  loader: () => getCategories(),
  component: Add,
});

const TYPES = ["expense", "income", "investment"] as const;

function Add() {
  const categoryList = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setStatus("");
    try {
      await addTransaction({
        data: {
          type: TYPES.find((t) => t === form.get("type")) ?? "expense",
          amount: Number(form.get("amount")),
          merchant: String(form.get("merchant")),
          category: String(form.get("category")),
          date: String(form.get("date")).replace("T", " "),
        },
      });
      // Drop cached loader data so Today shows the new row.
      await router.invalidate();
      await navigate({ to: "/" });
    } catch {
      setStatus("Could not save. Check the fields and your connection.");
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-lg font-semibold">Add transaction</h1>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <fieldset className="flex gap-2">
          <legend className="sr-only">Type</legend>
          {TYPES.map((t) => (
            <label key={t} className="flex-1">
              <input type="radio" name="type" value={t} defaultChecked={t === "expense"} className="peer sr-only" />
              <span className="btn-ghost w-full capitalize peer-checked:bg-brand peer-checked:text-white peer-focus-visible:outline-3">
                {t}
              </span>
            </label>
          ))}
        </fieldset>
        <label className="block text-sm font-medium">
          Amount (₹)
          <input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" required className="field mt-1" />
        </label>
        <label className="block text-sm font-medium">
          Merchant
          <input name="merchant" required maxLength={120} className="field mt-1" />
        </label>
        <label className="block text-sm font-medium">
          Category
          <input name="category" list="categories" maxLength={40} className="field mt-1" />
          <datalist id="categories">
            {categoryList.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="block text-sm font-medium">
          When
          <input name="date" type="datetime-local" required defaultValue={nowLocal().replace(" ", "T")} className="field mt-1" />
        </label>
        <button type="submit" disabled={busy} className="btn w-full">
          {busy ? "Saving…" : "Save"}
        </button>
        <p role="status" className="text-sm text-spend">{status}</p>
      </form>
    </>
  );
}
