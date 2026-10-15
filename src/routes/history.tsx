import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { money, shortDate } from "../lib";
import type { TxnRow as Txn } from "../server/db/queries";
import { deleteTransaction, getTransactions, saveEdit } from "../server/fns";

const searchSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  search: z.string().max(60).optional(),
  review: z.boolean().optional(),
});

export const Route = createFileRoute("/history")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getTransactions({ data: deps }),
  component: History,
});

const TYPES = ["expense", "income", "investment"] as const;

function History() {
  const { transactions, categories } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [editing, setEditing] = useState<Txn | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  function open(t: Txn) {
    setEditing(t);
    dialog.current?.showModal();
  }

  return (
    <>
      <h1 className="text-lg font-semibold">History</h1>
      <search>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
          void navigate({ search: (s) => ({ ...s, search: q || undefined }) });
        }}
      >
        <label className="sr-only" htmlFor="q">Search</label>
        <input id="q" name="q" type="search" defaultValue={search.search} placeholder="Merchant, category, SMS text" className="field" />
        <button type="submit" className="btn">Search</button>
      </form>
      </search>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {search.month && (
          <button type="button" className="btn-ghost" onClick={() => void navigate({ search: (s) => ({ ...s, month: undefined }) })}>
            {search.month} ✕
          </button>
        )}
        <button
          type="button"
          aria-pressed={!!search.review}
          className={search.review ? "btn" : "btn-ghost"}
          onClick={() => void navigate({ search: (s) => ({ ...s, review: s.review ? undefined : true }) })}
        >
          Needs review
        </button>
      </div>

      <p className="mt-4 text-sm text-ink/60">{transactions.length === 500 ? "Showing latest 500" : `${transactions.length} transactions`}</p>
      <ul className="mt-2 divide-y divide-line rounded-2xl bg-white">
        {transactions.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => open(t)} className="flex w-full justify-between gap-3 px-4 py-3 text-left text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {t.needsReview ? "• " : ""}
                  {t.merchant}
                </span>
                <span className="text-ink/60">
                  {shortDate(t.date)} · {t.category ?? "Uncategorised"}
                  {t.accountLast4 ? ` · ${t.accountLast4}` : ""}
                </span>
              </span>
              <span className={t.type === "income" ? "font-semibold text-earn" : t.type === "investment" ? "font-semibold text-brand" : "font-semibold"}>
                {t.type === "income" ? "+" : ""}
                {money(t.amount)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <dialog ref={dialog} onClose={() => setEditing(null)} className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-2xl p-0 backdrop:bg-ink/40">
        {editing && <EditForm key={editing.id} txn={editing} categories={categories} close={() => dialog.current?.close()} />}
      </dialog>
    </>
  );
}

function EditForm({ txn, categories, close }: { txn: Txn; categories: string[]; close: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setStatus("");
    try {
      await task();
      await router.invalidate();
      close();
    } catch {
      setStatus("Could not save. Your changes are still here.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() =>
      saveEdit({
        data: {
          id: txn.id,
          merchant: String(form.get("merchant")),
          category: String(form.get("category")),
          amount: Number(form.get("amount")),
          type: TYPES.find((t) => t === form.get("type")) ?? txn.type,
        },
      }),
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <h2 className="font-semibold">Edit transaction</h2>
      {txn.rawText && <p className="rounded-lg bg-paper p-3 text-xs text-ink/70">{txn.rawText}</p>}
      <label className="block text-sm font-medium">
        Merchant
        <input name="merchant" defaultValue={txn.merchant} required maxLength={120} className="field mt-1" />
      </label>
      <label className="block text-sm font-medium">
        Category
        <input name="category" list="edit-categories" defaultValue={txn.category ?? ""} maxLength={40} className="field mt-1" />
        <datalist id="edit-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <div className="flex gap-3">
        <label className="block flex-1 text-sm font-medium">
          Amount (₹)
          <input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" defaultValue={txn.amount} required className="field mt-1" />
        </label>
        <label className="block flex-1 text-sm font-medium">
          Type
          <select name="type" defaultValue={txn.type} className="field mt-1">
            {TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      <p role="status" className="text-sm text-spend">{status}</p>
      <div className="flex justify-between gap-2">
        <button
          type="button"
          disabled={busy}
          className="btn-ghost text-spend"
          onClick={() => {
            if (window.confirm("Delete this transaction?")) void run(() => deleteTransaction({ data: { id: txn.id } }));
          }}
        >
          Delete
        </button>
        <span className="flex gap-2">
          <button type="button" className="btn-ghost" onClick={close}>Cancel</button>
          <button type="submit" disabled={busy} className="btn">{busy ? "Saving…" : "Save"}</button>
        </span>
      </div>
    </form>
  );
}
