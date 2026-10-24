import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { DeskPage } from "../components/app-shell";
import { ActivityFilters, FilterToolbar } from "../components/activity-filters";
import { Amount, byDay, DayHeader, RowMeta, SplitMeta } from "../components/ledger";
import { MonthStepper } from "../components/month-stepper";
import { SummaryStrip } from "../components/summary-strip";
import { saveFailed, snack } from "../components/sheet";
import { useOnline } from "../components/sync-pill";
import { Button, CategoryDot, Empty, ErrorState, Skeleton } from "../components/ui";
import { card, money, rangeLabel, thisMonth, time, weekdayDate } from "../lib/format";
import { ordered, pickScope, scopeShape } from "../lib/filters";
import { getActivityMeta } from "../server/daily/fns";
import { deleteTransaction, getTransactions, getTransactionSummary, restoreTransaction } from "../server/fns";

const activitySearch = ordered(scopeShape.extend({
  review: z.preprocess((v) => (v === 1 || v === "1" ? true : v), z.boolean()).optional(), // old links use review=1
  ids: z.array(z.number().int().positive()).max(500).optional(),
  sort: z.enum(["newest", "oldest", "amount-desc", "amount-asc"]).optional(),
}));

type ActivitySearch = z.infer<typeof activitySearch>;
type Row = Awaited<ReturnType<typeof getTransactions>>[number];
// Same rule as ledger.tsx's row label; ingest files card bills as Other, so the category can't tell them apart.
const cardBill = (t: Row) => /cred|credit card|card payment/i.test(`${t.merchant} ${t.rawMerchant ?? ""}`);

export const Route = createFileRoute("/activity")({
  validateSearch: activitySearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const month = deps.from || deps.to ? undefined : deps.month ?? (deps.ids?.length || deps.merchant ? undefined : thisMonth());
    const query = { ...deps, month, withRaw: true };
    const [rows, summary, meta] = await Promise.all([
      getTransactions({ data: query }),
      getTransactionSummary({ data: query }),
      getActivityMeta(),
    ]);
    return { rows, summary, meta };
  },
  pendingComponent: () => <Skeleton rows={8} />,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return <ErrorState text={error instanceof Error ? error.message : "Couldn't load transactions."} retry={() => void router.invalidate()} />;
  },
  component: Activity,
});

function Activity() {
  const { rows, summary, meta } = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const online = useOnline();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(search.search ?? "");
  const [searchOpen, setSearchOpen] = useState(Boolean(search.search));
  const [activeId, setActiveId] = useState<number | null>(null);
  const [hiddenRail, setHiddenRail] = useState(false);
  const [swipedId, setSwipedId] = useState<number | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [showExcludedNote, setShowExcludedNote] = useState(false);
  const active = rows.find((row) => row.id === activeId);
  const month = search.month ?? thisMonth();
  const cards = [...new Set(rows.map((row) => row.accountLast4).filter((value): value is string => Boolean(value)))];
  const activeCategories = search.categories ?? (search.category ? [search.category] : []);
  const splitOnly = activeCategories.length === 1 ? activeCategories[0].split(":").at(-1) : undefined;
  // Project filtered split rows to selected parts. Day totals use the same share fraction.
  const viewRows = rows.map((r) => {
    if (!activeCategories.length || !r.splits.length) return r;
    const part = r.splits.filter((x) => activeCategories.some((value) => !/^(income|investment):/.test(value) && value.split(":").at(-1) === x.category)).reduce((sum, x) => sum + x.amount, 0);
    const ratio = r.amount > 0 ? part / r.amount : 0;
    return { ...r, amount: part, yours: r.yours * ratio, originalTotal: r.amount };
  });
  const groups = byDay(viewRows);
  const merchantRows = active ? rows.filter((row) => row.merchant === active.merchant) : [];
  const merchantTotal = merchantRows.reduce((sum, row) => sum + (row.type === "expense" && !row.excluded ? row.amount : 0), 0);
  const colors = Object.fromEntries(meta.categories.map((item) => [item.name, item.colorToken]));
  const reviewCount = rows.filter((row) => row.needsReview).length;
  const customRange = search.from && search.to ? rangeLabel(search.from, search.to) : undefined;

  useEffect(() => setQuery(search.search ?? ""), [search.search]);
  useEffect(() => {
    if (search.search) setSearchOpen(true);
  }, [search.search]);
  useEffect(() => {
    if (!searchOpen) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [searchOpen]);
  useEffect(() => {
    const next = query.trim() || undefined;
    if (next === search.search) return;
    const timer = window.setTimeout(() => void router.navigate({ to: "/activity", search: { ...search, search: next } }), 250);
    return () => window.clearTimeout(timer);
  }, [query, router, search]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editable = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !editable) {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        if (target === searchRef.current) (target as HTMLInputElement).blur();
        setActiveId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    if (!rows.some((row) => row.excluded)) return;
    try { setShowExcludedNote(window.localStorage.getItem("kharcha-activity-excluded-note") !== "dismissed"); }
    catch { setShowExcludedNote(true); }
  }, [rows]);

  const change = (next: Partial<ActivitySearch>) => void router.navigate({ to: "/activity", search: { ...search, ...next } });
  const clearFilters = () => void router.navigate({ to: "/activity", search: { month: search.month, search: search.search } });
  const getCount = async (draft: Record<string, unknown>) => {
    const { review, ids, sort, ...rest } = draft as ActivitySearch;
    void ids; void sort;
    // The Needs review pill sets review=true; count it the way the list does.
    const status = review && !rest.status?.includes("review") ? [...(rest.status ?? []), "review" as const] : rest.status;
    const data = { ...rest, status, month: rest.from || rest.to ? undefined : rest.month ?? month };
    return (await getTransactionSummary({ data })).count;
  };
  const remove = (row: Row) => {
    if (!online) return;
    void deleteTransaction({ data: { id: row.id } })
      .then(() => {
        setSwipedId(null);
        if (activeId === row.id) setActiveId(null);
        void router.invalidate();
        snack("Deleted.", {
          label: "Undo",
          onClick: () => {
            if (!online) return;
            void restoreTransaction({ data: { id: row.id } })
              .then(() => void router.invalidate())
              .catch(() => snack("Couldn’t undo the delete."));
          },
        });
      })
      .catch(() => saveFailed(() => remove(row)));
  };

  const header = searchOpen && (
    <div className="flex min-h-11 items-center gap-2">
      <label className="field flex min-h-11 min-w-0 flex-1 items-center gap-2 bg-card px-3">
        <Search className="size-[18px] shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
        <span className="sr-only">Search transactions</span>
        <input ref={searchRef} aria-label="Search transactions" placeholder="Merchant, category, SMS text" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-3" />
        {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="flex size-9 shrink-0 items-center justify-center text-ink-3"><X size={16} /></button>}
        <kbd className="hidden rounded-mark border border-rule px-1.5 py-0.5 font-mono text-xs text-ink-2 desk:inline">/</kbd>
      </label>
      <button type="button" onClick={() => { setSearchOpen(false); setQuery(""); }} className="min-h-11 shrink-0 px-2 text-sm font-medium text-brand desk:hidden">Cancel</button>
    </div>
  );

  return (
    <DeskPage>
      <div className="px-5 pt-5 pb-5 desk:px-0 desk:pt-7">
        <header className="flex flex-wrap items-center justify-between gap-3">
          {header || <>
            <h1 className="m-0 font-serif text-[26px] font-medium">Activity</h1>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Search transactions" onClick={() => setSearchOpen(true)} className="flex size-11 items-center justify-center rounded-button text-ink desk:hidden"><Search size={20} strokeWidth={1.75} /></button>
              <span><MonthStepper to="/activity" month={month} label={customRange} onOpen={() => setDateOpen(true)} /></span>
            </div>
          </>}
          {header && <span className="hidden desk:block"><MonthStepper to="/activity" month={month} label={customRange} onOpen={() => setDateOpen(true)} /></span>}
        </header>

        <div className={`mt-3 desk:grid desk:items-start desk:gap-6 ${hiddenRail ? "desk:grid-cols-[minmax(0,1fr)]" : "desk:grid-cols-[248px_minmax(0,1fr)]"}`}>
          <div className={hiddenRail ? "desk:hidden" : "desk:pt-1"}>
            <ActivityFilters
              search={search}
              categories={meta.categories}
              cards={cards}
              trips={meta.trips}
              reviewCount={reviewCount}
              resultCount={rows.length}
              getCount={getCount}
              onApply={change}
              onClear={clearFilters}
              onReview={() => change({ review: search.review || search.status?.includes("review") ? undefined : true, status: search.status?.includes("review") ? search.status.filter((s) => s !== "review").length ? search.status.filter((s) => s !== "review") : undefined : search.status })}
              dateOpen={dateOpen}
              onDateClose={() => setDateOpen(false)}
              hiddenRail={hiddenRail}
              onRailVisibilityChange={setHiddenRail}
            />
          </div>
          <div className="min-w-0">
            <div className="hidden desk:block">
              <FilterToolbar search={search} trips={meta.trips} resultCount={rows.length} onApply={change} onClear={clearFilters} railHidden={hiddenRail} onShowRail={() => setHiddenRail(false)} />
            </div>
            {(search.ids?.length || search.merchant) && <div className="mt-2 flex flex-wrap gap-2">{search.ids?.length ? <button type="button" onClick={() => change({ ids: undefined })} className="inline-flex min-h-9 items-center gap-2 rounded-chip bg-brand-soft px-3 text-[13px] font-medium text-brand">{search.ids.length} supporting transactions<span aria-hidden="true">×</span><span className="sr-only">Show all</span></button> : null}{search.merchant && <button type="button" onClick={() => change({ merchant: undefined })} className="inline-flex min-h-9 items-center gap-2 rounded-chip bg-brand-soft px-3 text-[13px] font-medium text-brand">{search.merchant}<span aria-hidden="true">×</span><span className="sr-only">Remove merchant filter</span></button>}</div>}
            <div className="mt-3"><SummaryStrip summary={summary} colors={colors} scope={pickScope(search)} /></div>

            {!online && <p role="status" className="mt-3 mb-0 text-[13px] text-ink-3">Offline · saved transactions remain available; delete is disabled.</p>}
            {showExcludedNote && rows.some((row) => row.excluded) && <p className="mb-0 mt-3 flex min-h-11 items-center justify-between gap-3 rounded-button bg-sunken px-3 text-[13px] text-ink-2">Not counted as spend; the purchases already are.<button type="button" aria-label="Dismiss not counted note" onClick={() => { setShowExcludedNote(false); try { window.localStorage.setItem("kharcha-activity-excluded-note", "dismissed"); } catch { /* Storage can be unavailable in private browsing. */ } }} className="flex size-11 shrink-0 items-center justify-center text-ink-3"><X size={16} aria-hidden="true" /></button></p>}

            <div className="mt-3">
              {rows.length ? (
                <div className="space-y-0">
                  {search.sort === "amount-asc" || search.sort === "amount-desc"
                    ? viewRows.map((row) => <ActivityRow key={row.id} row={row} color={meta.categories.find((item) => item.name === row.category && item.type === row.type)?.colorToken ?? "cat-other"} splitOnly={splitOnly} active={row.id === active?.id} swiped={row.id === swipedId} canDelete={online} onSelect={() => setActiveId(row.id)} onSwipe={() => setSwipedId(row.id)} onReset={() => setSwipedId(null)} onDelete={() => remove(row)} />)
                    : groups.map((group) => <section key={group.date}>
                      <DayHeader date={group.date} total={group.total} />
                      {group.rows.map((row) => <ActivityRow key={row.id} row={row} color={meta.categories.find((item) => item.name === row.category && item.type === row.type)?.colorToken ?? "cat-other"} splitOnly={splitOnly} active={row.id === active?.id} swiped={row.id === swipedId} canDelete={online} onSelect={() => setActiveId(row.id)} onSwipe={() => setSwipedId(row.id)} onReset={() => setSwipedId(null)} onDelete={() => remove(row)} />)}
                    </section>)}
                </div>
              ) : (
                <Empty text={search.tripId ? "No transactions match this trip with the current filters." : "Nothing matches these filters."} action={<Button variant="outline" onClick={clearFilters}>Clear all</Button>} />
              )}
            </div>
          </div>
        </div>
      </div>
      {active && <section aria-label="Transaction detail" className="fixed top-0 right-0 z-30 hidden h-dvh w-[380px] flex-col gap-3 overflow-y-auto border-l border-rule bg-card p-5 desk:flex">
        <div className="flex items-center justify-between gap-3">
          <span className="label-caps text-ink-3">{active.type} · {active.category ?? "Other"}</span>
          <div className="flex items-center gap-1">
            <Link to="/txn/$id/edit" params={{ id: String(active.id) }} className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-brand">Edit</Link>
            <button type="button" aria-label="Close detail" onClick={() => setActiveId(null)} className="flex size-11 items-center justify-center text-ink-2"><X size={18} /></button>
          </div>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-b-[3px] border-double border-ink pb-3">
          <span className="min-w-0 truncate font-serif text-[26px] font-medium">{active.merchant}</span>
          <Amount t={active} className="font-serif text-[34px]" />
        </div>
        <dl className="m-0 flex flex-col">
          {[
            ["Date", weekdayDate(active.date)],
            ["Card", card(active.accountLast4) || "Manual"],
            ["Source", active.source === "sms" ? "SMS via Mac mini" : active.source === "paste" ? "Pasted text" : "Added by hand"],
            ["Parsed by", active.source === "sms" ? "Regex" : active.source === "paste" ? "Paste" : "Manual"],
            ["Status", active.needsReview ? "Needs review" : active.excluded ? "Not counted" : "Reviewed"],
          ].map(([label, value]) => <div key={label} className="flex min-h-9 items-center justify-between gap-4 border-b border-hairline text-sm"><dt className="text-ink-2">{label}</dt><dd className="m-0 truncate text-right font-medium">{value}</dd></div>)}
        </dl>
        {active.rawText && <p className="m-0 rounded-inner bg-sunken p-3 font-mono text-[13px] leading-5 break-words [overflow-wrap:anywhere] text-ink-2">{active.rawText}</p>}
        <div className="flex items-center justify-between gap-3 text-[13px] text-ink-2"><span className="truncate">{active.merchant} this month</span><strong className="shrink-0 text-ink">{money(merchantTotal)} · {merchantRows.length} {merchantRows.length === 1 ? "row" : "rows"}</strong></div>
        <Button variant="danger" disabled={!online} onClick={() => remove(active)}>Delete</Button>
      </section>}
    </DeskPage>
  );
}

function ActivityRow({ row, color, splitOnly, active, swiped, canDelete, onSelect, onSwipe, onReset, onDelete }: { row: Row; color: string; splitOnly?: string; active: boolean; swiped: boolean; canDelete: boolean; onSelect: () => void; onSwipe: () => void; onReset: () => void; onDelete: () => void }) {
  const dragged = useRef(false);
  const x = useMotionValue(0);
  const reveal = useTransform(x, [-88, 0], [1, 0]);
  const scale = useTransform(x, [-88, 0], [1, 0.8]);
  const reduced = useReducedMotion();
  const snap = (open: boolean) => animate(x, open ? -88 : 0, reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 22, mass: 0.8, velocity: x.getVelocity() });
  useEffect(() => {
    const animation = animate(x, swiped ? -88 : 0, reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 22, mass: 0.8, velocity: x.getVelocity() });
    return () => animation.stop();
  }, [swiped, reduced, x]);
  return (
    <div className="relative overflow-hidden border-b border-hairline desk:border-0">
      <motion.button type="button" aria-label={`Delete ${row.merchant}`} tabIndex={swiped ? 0 : -1} aria-hidden={!swiped} disabled={!canDelete} onClick={onDelete} style={{ opacity: reveal }} className="absolute inset-y-0 right-0 flex w-[88px] items-center justify-center bg-over text-sm font-semibold text-on-over disabled:opacity-50 desk:hidden"><motion.span style={{ scale }}>Delete</motion.span></motion.button>
      <motion.div
        drag={canDelete ? "x" : false}
        dragDirectionLock
        dragConstraints={{ left: -88, right: 0 }}
        dragElastic={{ left: 0.33, right: 0.05 }}
        dragTransition={{ bounceStiffness: 500, bounceDamping: 22 }}
        style={{ x }}
        onDragStart={() => { dragged.current = true; }}
        onDragEnd={(_, info) => {
          window.setTimeout(() => { dragged.current = false; });
          if (info.offset.x < -window.innerWidth * 0.6) { onDelete(); onReset(); return; }
          const open = info.offset.x < -44 || info.velocity.x < -400;
          snap(open);
          if (open) onSwipe(); else onReset();
        }}
        className="relative bg-paper desk:bg-transparent"
      >
        <Link to="/txn/$id" params={{ id: String(row.id) }} onClick={(event) => { if (dragged.current || swiped) { event.preventDefault(); if (swiped) onReset(); return; } onSelect(); }} className="flex min-h-[58px] items-center justify-between gap-3 py-1.5 text-ink hover:bg-sunken/50 hover:text-ink desk:hidden">
          <span className="flex min-w-0 flex-col gap-0.5"><span className="flex items-center gap-1.5 truncate text-[15px] font-medium">{row.needsReview && <><span aria-hidden className="size-[7px] shrink-0 rounded-full bg-brand" /><span className="sr-only">Needs review</span></>}<span className="truncate">{row.merchant}</span></span>{row.splits.length ? <SplitMeta splits={row.splits} only={splitOnly} ofTotal={splitOnly ? (row as typeof row & { originalTotal?: number }).originalTotal : undefined} /> : <RowMeta t={row} color={color} />}</span>
          <Amount t={row} />
        </Link>
        <button type="button" onClick={onSelect} className="hidden min-h-11 w-full grid-cols-[64px_minmax(0,1fr)_140px_64px_96px] items-center gap-3 px-2 text-left text-sm text-ink hover:bg-sunken/50 focus-visible:outline-2 focus-visible:outline-brand desk:grid" style={active ? { background: "var(--color-brand-soft)" } : undefined}>
          <span className="w-16 shrink-0 whitespace-nowrap text-ink-3">{time(row.date)}</span>
          <span className="flex min-w-0 items-center gap-1.5 truncate font-medium">{row.needsReview && <><span aria-hidden className="size-[7px] shrink-0 rounded-full bg-brand" /><span className="sr-only">Needs review</span></>}<span className="truncate">{row.merchant}</span></span>
          <span className="flex min-w-0 items-center gap-1.5 truncate">{row.excluded && cardBill(row) ? <span className="inline-flex items-center rounded-mark bg-sunken px-1.5 text-[12px] text-ink-2">Card bill</span> : <><CategoryDot color={row.excluded || row.category === "Other" || !row.category ? "cat-other" : color} />{row.category ?? "Other"}</>}</span>
          <span className="whitespace-nowrap text-ink-3">{card(row.accountLast4)}</span>
          <Amount t={row} className="justify-self-end" />
        </button>
      </motion.div>
    </div>
  );
}
