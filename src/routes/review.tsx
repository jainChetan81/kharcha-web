import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { DeskPage } from "../components/app-shell";
import { CategoryPicker } from "../components/category-picker";
import { ReviewDeck } from "../components/review-deck";
import { Sheet, saveFailed, snack } from "../components/sheet";
import { useOnline } from "../components/sync-pill";
import { Button, CategoryDot, Empty, ErrorState, PageHeader, Skeleton } from "../components/ui";
import { usePageKeys } from "../keybindings";
import { card, money, shortDate } from "../lib/format";
import { getReview } from "../server/daily/fns";
import { createRule, flagTransaction, getCategories, getTransactions } from "../server/fns";

type Row = Awaited<ReturnType<typeof getReview>>[number];
type Duplicate = { id: number; merchant: string; amount: number };

const grid = "grid-cols-[36px_64px_minmax(0,1fr)_64px_120px_84px]";
const keys = [
  { key: "J/K", label: "move" },
  { key: "X", label: "select" },
  { key: "⏎", label: "confirm" },
  { key: "C", label: "category" },
  { key: "E", label: "not a spend" },
];

export const Route = createFileRoute("/review")({
  loader: async () => {
    const [rows, categories] = await Promise.all([getReview(), getCategories()]);
    return { rows, categories };
  },
  pendingComponent: () => <Skeleton />,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return <ErrorState text={error instanceof Error ? error.message : "Couldn't load review."} retry={() => void router.invalidate()} />;
  },
  component: Review,
});

function Review() {
  const { rows: loaded, categories } = Route.useLoaderData();
  // Keep the session's rows: refetches drop filed rows, but progress and "done" need them. New arrivals append.
  const [rows, setRows] = useState(loaded);
  useEffect(() => setRows((prev) => [...prev, ...loaded.filter((row) => !prev.some((item) => item.id === row.id))]), [loaded]);
  const busy = useRef(false);
  const router = useRouter();
  const online = useOnline();
  const [skipped, setSkipped] = useState<number[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [checked, setChecked] = useState<number[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [rule, setRule] = useState<{ id: number; on: boolean } | null>(null);
  const [category, setCategory] = useState<{ id: number; name: string } | null>(null);
  const [sheet, setSheet] = useState(false);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);

  const done = useMemo(() => new Set([...skipped, ...picked]), [picked, skipped]);
  const queue = useMemo(() => rows.filter((row) => !done.has(row.id)), [done, rows]);
  const current = queue[0];
  const open = queue.find((row) => row.id === activeId) ?? current;
  const selected = queue.filter((row) => checked.includes(row.id));
  const suggested = open && category?.id === open.id ? category.name : open?.suggestion ?? "Other";
  const makeRule = Boolean(open && rule?.id === open.id && rule.on);
  const colorOf = (name: string | null) => categories.find((item) => item.name === name)?.colorToken ?? "cat-other";

  useEffect(() => {
    if (activeId !== open?.id) setActiveId(open?.id ?? null);
  }, [activeId, open?.id]);

  const merchant = open?.merchant;
  const rowId = open?.id;
  useEffect(() => {
    if (!merchant || rowId === undefined) {
      setDuplicates([]);
      return;
    }
    let alive = true;
    getTransactions({ data: { merchant, limit: 6 } })
      .then((list) => alive && setDuplicates(list.filter((item) => item.id !== rowId).map(({ id, merchant, amount }) => ({ id, merchant, amount }))))
      .catch(() => alive && setDuplicates([]));
    return () => {
      alive = false;
    };
  }, [rowId, merchant]);

  async function run(work: () => Promise<void>, retry: () => void) {
    if (!online || busy.current) return;
    busy.current = true;
    try {
      await work();
      void router.invalidate();
    } catch {
      saveFailed(retry);
    } finally {
      busy.current = false;
    }
  }

  function finish(ids: number[]) {
    setPicked((previous) => [...new Set([...previous, ...ids])]);
    setChecked((previous) => previous.filter((id) => !ids.includes(id)));
  }

  const confirmOne = (row: Row, nextCategory: string, makeRule: boolean) =>
    run(
      async () => {
        // Same merchant still in the queue gets the same answer; no asking twice.
        const same = queue.filter((item) => item.merchant === row.merchant).map((item) => item.id);
        if (makeRule) {
          const { ids } = await createRule({
            data: {
              match: row.rawMerchant ?? row.merchant,
              displayMerchant: row.merchant,
              category: nextCategory,
              createdFromTxnId: row.id,
            },
          });
          const rest = same.filter((id) => !ids.includes(id));
          for (const id of rest) await flagTransaction({ data: { id, category: nextCategory, needsReview: false } });
          finish([...ids, ...rest]);
        } else {
          for (const id of same) await flagTransaction({ data: { id, category: nextCategory, needsReview: false } });
          finish(same);
        }
        snack(same.length > 1 ? `Filed ${same.length} · ${row.merchant} · ${nextCategory}` : `Saved ${money(row.amount)} · ${nextCategory}`);
      },
      () => confirmOne(row, nextCategory, makeRule),
    );

  const excludeOne = (row: Row) =>
    run(
      async () => {
        await flagTransaction({ data: { id: row.id, excluded: true, needsReview: false } });
        finish([row.id]);
        snack("Marked not a spend.");
      },
      () => excludeOne(row),
    );

  const duplicateOne = (row: Row, duplicateOf: number) =>
    run(
      async () => {
        await flagTransaction({ data: { id: row.id, duplicateOf, needsReview: false } });
        finish([row.id]);
        snack("Marked duplicate.");
      },
      () => duplicateOne(row, duplicateOf),
    );

  const confirmSelected = () =>
    run(
      async () => {
        for (const row of selected) {
          await flagTransaction({ data: { id: row.id, category: row.suggestion, needsReview: false } });
          finish([row.id]);
        }
        snack(`Filed ${selected.length} · suggestions kept`);
      },
      confirmSelected,
    );

  const setSelectedCategory = (nextCategory: string) =>
    run(
      async () => {
        for (const row of selected) {
          await flagTransaction({ data: { id: row.id, category: nextCategory, needsReview: false } });
          finish([row.id]);
        }
        snack(`Filed ${selected.length} · ${nextCategory}`);
      },
      () => setSelectedCategory(nextCategory),
    );

  const toggleChecked = (id: number) => {
    setActiveId(id);
    setChecked((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]));
  };

  const selectAll = () => setChecked(queue.map((row) => row.id));
  const move = (by: number) => {
    const at = queue.findIndex((row) => row.id === open?.id);
    const next = queue[Math.min(queue.length - 1, Math.max(0, (at < 0 ? 0 : at) + by))];
    if (next) setActiveId(next.id);
  };

  usePageKeys({
    j: () => move(1),
    k: () => move(-1),
    x: () => open && toggleChecked(open.id),
    c: () => setSheet(true),
    e: () => open && excludeOne(open),
    enter: () => open && confirmOne(open, suggested, makeRule),
  });

  if (!rows.length) {
    return (
      <DeskPage>
        <PageHeader title="Review" />
        <div className="px-5 desk:px-0">
          <Empty text="Nothing needs review." action={<Link to="/">Back to home</Link>} />
        </div>
      </DeskPage>
    );
  }

  const remaining = queue.length;
  const progress = ((rows.length - remaining) / rows.length) * 100;
  const allDone = !current;

  return (
    <DeskPage
      railClassName="hidden desk:flex"
      rail={
        open ? (
          <section aria-label="Selected transaction" className="flex flex-col gap-3.5 rounded-card border border-field bg-card p-5">
            <div className="flex items-start justify-between gap-3 border-b-[3px] border-double border-ink pb-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate font-serif text-2xl font-medium">{open.merchant}</span>
                <span className="text-[13px] text-ink-3">
                  {shortDate(open.date)} · {open.accountLast4 ? `Card ${card(open.accountLast4)}` : "Manual"}
                </span>
              </div>
              <strong className="shrink-0 font-serif text-[28px] font-medium">{money(open.amount)}</strong>
            </div>
            <CategoryPicker categories={categories} value={suggested} onChange={(name) => setCategory({ id: open.id, name })} />
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={makeRule} disabled={!online} onChange={(event) => setRule({ id: open.id, on: event.target.checked })} className="size-[18px] accent-brand" />
              Always file this merchant as {suggested}
            </label>
            {open.rawText && <p className="m-0 rounded-[8px] bg-sunken p-3 font-mono text-[12.5px] leading-6 text-ink-2">{open.rawText}</p>}
            <div className="flex flex-wrap gap-2">
              <Button disabled={!online} onClick={() => confirmOne(open, suggested, makeRule)} className="flex-1">
                Confirm · {suggested}
              </Button>
              <Button variant="outline" disabled={!online} onClick={() => excludeOne(open)} className="px-3 text-sm">
                Not a spend
              </Button>
              <Button variant="outline" disabled={!online || !duplicates.length} onClick={() => duplicates[0] && duplicateOne(open, duplicates[0].id)} className="px-3 text-sm">
                Duplicate
              </Button>
            </div>
          </section>
        ) : null
      }
    >
      <header className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 desk:hidden">
        <Link to="/" aria-label="Back" className="-ml-3 flex size-11 items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="m-0 font-serif text-[22px] font-medium">Review</h1>
        <span className="text-[13px] text-ink-3">{Math.min(rows.length - remaining + 1, rows.length)} of {rows.length}</span>
      </header>
      <div aria-hidden className="mx-5 h-[3px] rounded-sm bg-hairline desk:hidden">
        <div className="h-full rounded-sm bg-brand" style={{ width: `${progress}%` }} />
      </div>

      <div className="hidden desk:block">
        <header className="flex flex-wrap items-baseline justify-between gap-3 pt-7">
          <h1 className="m-0 font-serif text-[30px] font-medium">Review <span className="text-[22px] text-ink-3">{remaining}</span></h1>
          <div className="flex flex-wrap gap-2 text-xs text-ink-2">
            {keys.map((item) => (
              <span key={item.key} className="flex items-center gap-1.5">
                <span className="rounded-[4px] border border-field bg-card px-1.5 py-0.5 font-mono text-ink">{item.key}</span>
                {item.label}
              </span>
            ))}
          </div>
        </header>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-button border border-rule px-3 py-1.5">
          <span className="text-sm font-medium">{selected.length ? `${selected.length} selected` : "Nothing selected"}</span>
          <Button disabled={!online || !selected.length} onClick={confirmSelected} className="min-h-9 px-3.5 text-sm">Confirm suggested</Button>
          <Button variant="outline" disabled={!online || !selected.length} onClick={() => setSheet(true)} className="min-h-9 px-3 text-sm">Set category…</Button>
          <button type="button" onClick={selectAll} className="ml-auto min-h-9 px-3 text-sm font-medium text-brand">Select all</button>
        </div>

        <ul className="mt-6 min-w-[560px] list-none p-0">
          <div className={`grid ${grid} items-center gap-3 border-b border-ink pb-1.5 text-xs tracking-[0.06em] text-ink-3 uppercase`}>
            <span />
            <span>Date</span>
            <span>Merchant</span>
            <span>Card</span>
            <span>Suggested</span>
            <span className="text-right">Amount</span>
          </div>
          {rows.map((row) => {
            const active = row.id === open?.id;
            const handled = done.has(row.id);
            const isChecked = checked.includes(row.id);
            return (
              <li key={row.id} className={`grid ${grid} min-h-10 items-center gap-3 border-b border-hairline text-sm`} style={active ? { background: "var(--color-brand-soft)", boxShadow: "inset 3px 0 0 var(--color-brand)" } : undefined}>
                <input type="checkbox" aria-label={`Select ${row.merchant}`} checked={isChecked} disabled={handled} onChange={() => toggleChecked(row.id)} className="ml-2 size-[18px] accent-brand" />
                <span className="text-ink-3">{shortDate(row.date).split(",")[0]}</span>
                <button type="button" onClick={() => setActiveId(row.id)} className={`min-h-10 truncate text-left font-medium text-ink ${handled ? "opacity-45" : ""}`}>{row.merchant}</button>
                <span className="text-ink-3">{card(row.accountLast4)}</span>
                <span className={`flex items-center gap-1.5 truncate ${handled ? "opacity-45" : ""}`}>
                  <CategoryDot color={colorOf(row.suggestion)} />
                  {handled ? `Filed · ${row.suggestion}` : row.suggestion}
                </span>
                <span className="text-right font-medium">{money(row.amount)}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {current && (
        <div className="px-5 desk:px-0">
          <ReviewDeck key={current.id} row={current} categories={categories} duplicates={duplicates} disabled={!online} onConfirm={(nextCategory, makeRule) => confirmOne(current, nextCategory, makeRule)} onSkip={() => setSkipped((previous) => [...previous, current.id])} onExclude={() => excludeOne(current)} onDuplicate={(duplicateOf) => duplicateOne(current, duplicateOf)} />
        </div>
      )}

      {allDone && (
        <div className="flex flex-col items-center gap-3 px-5 pt-8 pb-4 text-center desk:px-0">
          <span className="flex size-10 items-center justify-center rounded-full bg-earn text-paper">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" /></svg>
          </span>
          <p className="m-0 font-serif text-[26px] font-medium">Nice. {picked.length} filed.</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setSkipped([]); setPicked([]); setChecked([]); }}>Start over</Button>
            <Link to="/" className="inline-flex min-h-11 items-center rounded-button bg-ink px-4.5 text-[15px] font-medium text-paper">Back to home</Link>
          </div>
        </div>
      )}

      {sheet && (
        <Sheet title="Set category" description={selected.length ? `For ${selected.length} selected rows.` : `For ${open?.merchant ?? "this row"}.`} onClose={() => setSheet(false)}>
          <CategoryPicker categories={categories} value={suggested} onChange={(name) => open && setCategory({ id: open.id, name })} />
          <div className="flex gap-2">
            <Button disabled={!online || (!open && !selected.length)} onClick={() => { if (selected.length) setSelectedCategory(suggested); else if (open) confirmOne(open, suggested, makeRule); setSheet(false); }}>
              Confirm · {suggested}
            </Button>
            <Button variant="outline" onClick={() => setSheet(false)}>Cancel</Button>
          </div>
        </Sheet>
      )}
    </DeskPage>
  );
}
