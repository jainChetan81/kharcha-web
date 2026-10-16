import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { DeskPage } from "../components/app-shell";
import { Amount, byDay, DayHeader, RowMeta } from "../components/ledger";
import { MonthSwitcher } from "../components/month-switcher";
import { saveFailed, snack } from "../components/sheet";
import { useOnline } from "../components/sync-pill";
import { Button, CategoryDot, Chip, Empty, ErrorState, Skeleton } from "../components/ui";
import { card, money, thisMonth, time, weekdayDate } from "../lib/format";
import { getActivityMeta } from "../server/daily/fns";
import { deleteTransaction, getTransactions, restoreTransaction } from "../server/fns";

type Row = Awaited<ReturnType<typeof getTransactions>>[number];

export const Route = createFileRoute("/activity")({
  validateSearch: z.object({
    month: z.string().optional(),
    search: z.string().max(60).optional(),
    review: z.boolean().optional(),
    category: z.string().max(40).optional(),
    merchant: z.string().max(120).optional(),
    card: z.string().regex(/^\d{4}$/).optional(),
    type: z.enum(["income", "expense", "investment"]).optional(),
    tripId: z.number().int().positive().optional(),
    ids: z.array(z.number().int().positive()).max(500).optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    Promise.all([
      getTransactions({
        data: {
          ...deps,
          month: deps.ids || deps.merchant ? deps.month : (deps.month ?? thisMonth()),
          withRaw: true,
        },
      }),
      getActivityMeta(),
    ]),
  pendingComponent: () => <Skeleton rows={8} />,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return <ErrorState text={error instanceof Error ? error.message : "Couldn't load activity."} retry={() => void router.invalidate()} />;
  },
  component: Activity,
});

function Activity() {
  const [rows, meta] = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const online = useOnline();
  const [query, setQuery] = useState(search.search ?? "");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [swipedId, setSwipedId] = useState<number | null>(null);
  const active = rows.find((row) => row.id === activeId) ?? rows[0];
  const month = search.month ?? thisMonth();
  const cards = [...new Set(rows.map((row) => row.accountLast4).filter((value): value is string => Boolean(value)))];
  const totalSpent = rows.reduce((sum, row) => sum + (row.type === "expense" && !row.excluded ? row.amount : 0), 0);
  const totalIncome = rows.reduce((sum, row) => sum + (row.type === "income" ? row.amount : 0), 0);
  const merchantRows = active ? rows.filter((row) => row.merchant === active.merchant) : [];
  const merchantTotal = merchantRows.reduce((sum, row) => sum + (row.type === "expense" && !row.excluded ? row.amount : 0), 0);

  useEffect(() => {
    setQuery(search.search ?? "");
  }, [search.search]);

  useEffect(() => {
    const next = query.trim() || undefined;
    if (next === search.search) return;
    const timer = window.setTimeout(() => {
      void router.navigate({ to: "/activity", search: { ...search, search: next } });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, router, search]);

  const change = (next: Partial<typeof search>) => void router.navigate({ to: "/activity", search: { ...search, ...next } });

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

  const clear = (key: "merchant" | "ids") => change({ [key]: undefined });
  const filterLabel = [search.merchant, search.ids?.length ? `${search.ids.length} rows` : null].filter(Boolean).join(" · ");
  const groups = useMemo(() => byDay(rows), [rows]);

  return (
    <DeskPage
      railClassName="hidden desk:flex"
      rail={
        active ? (
          <section aria-label="Transaction detail" className="flex flex-col gap-3 rounded-card border border-field bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="label-caps text-ink-3">{active.type} · {active.category ?? "Other"}</span>
              <Link to="/txn/$id/edit" params={{ id: String(active.id) }} className="inline-flex min-h-9 items-center text-sm font-medium text-brand">Edit</Link>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-b-[3px] border-double border-ink pb-3">
              <span className="min-w-0 truncate font-serif text-[26px] font-medium">{active.merchant}</span>
              <Amount t={active} className="font-serif text-[30px]" />
            </div>
            <dl className="m-0 flex flex-col">
              {[
                ["Date", weekdayDate(active.date)],
                ["Card", card(active.accountLast4) || "Manual"],
                ["Source", active.source === "sms" ? "SMS via Mac mini" : active.source === "paste" ? "Pasted text" : "Added by hand"],
                ["Parsed by", active.source === "sms" ? "Regex" : active.source === "paste" ? "Paste" : "Manual"],
                ["Status", active.needsReview ? "Needs review" : active.excluded ? "Not a spend" : "Reviewed"],
              ].map(([label, value]) => (
                <div key={label} className="flex min-h-9 items-center justify-between gap-4 border-b border-hairline text-sm">
                  <dt className="text-ink-2">{label}</dt>
                  <dd className="m-0 truncate text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {active.rawText && <p className="m-0 rounded-[8px] bg-sunken p-3 font-mono text-[12.5px] leading-5 text-ink-2">{active.rawText}</p>}
            <div className="flex items-center justify-between gap-3 text-[13px] text-ink-2">
              <span className="truncate">{active.merchant} this month</span>
              <strong className="shrink-0 text-ink">{money(merchantTotal)} · {merchantRows.length} {merchantRows.length === 1 ? "row" : "rows"}</strong>
            </div>
            <Button variant="danger" disabled={!online} onClick={() => remove(active)}>Delete</Button>
          </section>
        ) : null
      }
    >
      <div className="space-y-4 px-5 pt-5 pb-5 desk:px-0 desk:pt-7">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="m-0 font-serif text-[26px] font-medium">Activity</h1>
          <label className="field flex min-h-11 w-full items-center gap-2 bg-card px-3 desk:max-w-[420px]">
            <Search className="size-[18px] shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
            <span className="sr-only">Search</span>
            <input aria-label="Search transactions" placeholder="Merchant, category, SMS text" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3" />
            <kbd className="hidden rounded-[4px] border border-rule px-1.5 py-0.5 font-mono text-xs text-ink-2 desk:inline">/</kbd>
          </label>
        </header>

        <div className="flex gap-2 overflow-x-auto pb-1 desk:flex-wrap desk:overflow-visible">
          <Chip on={Boolean(search.review)} dot="var(--color-brand)" onClick={() => change({ review: search.review ? undefined : true })}>Needs review</Chip>
          <div className="shrink-0"><MonthSwitcher month={month} to="/activity" /></div>
          <select aria-label="Category" value={search.category ?? ""} onChange={(event) => change({ category: event.target.value || undefined })} className="min-h-9 shrink-0 rounded-chip border border-field bg-card px-3 text-[13px] text-ink">
            <option value="">Category</option>
            {meta.categories.map((item) => <option key={`${item.type}-${item.name}`} value={item.name}>{item.name}</option>)}
          </select>
          <select aria-label="Card" value={search.card ?? ""} onChange={(event) => change({ card: event.target.value || undefined })} className="min-h-9 shrink-0 rounded-chip border border-field bg-card px-3 text-[13px] text-ink">
            <option value="">Card</option>
            {cards.map((value) => <option key={value} value={value}>{card(value)}</option>)}
          </select>
          <select aria-label="Type" value={search.type ?? ""} onChange={(event) => change({ type: (event.target.value || undefined) as typeof search.type })} className="min-h-9 shrink-0 rounded-chip border border-field bg-card px-3 text-[13px] text-ink">
            <option value="">Type</option>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="investment">Investment</option>
          </select>
          <select aria-label="Trip" value={search.tripId ?? ""} onChange={(event) => change({ tripId: event.target.value ? Number(event.target.value) : undefined })} className="min-h-9 shrink-0 rounded-chip border border-field bg-card px-3 text-[13px] text-ink">
            <option value="">Trip</option>
            {meta.trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.name}</option>)}
          </select>
        </div>

        {(search.merchant || search.ids?.length) && (
          <div className="flex flex-wrap gap-2">
            {search.merchant && <Chip on onClick={() => clear("merchant")}>{search.merchant} ×</Chip>}
            {search.ids?.length && <Chip on onClick={() => clear("ids")}>{search.ids.length} rows ×</Chip>}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-button bg-sunken px-3 py-2 text-[13px] text-ink-2">
          <span>{filterLabel || month}{search.review ? " · needs review" : ""}</span>
          <span className="shrink-0"><strong className="text-ink">{money(totalSpent)}</strong> spent · <strong className="text-earn">+{money(totalIncome)}</strong> in · {rows.length} rows</span>
        </div>

        {rows.length ? (
          <div className="space-y-0">
            {groups.map((group) => (
              <section key={group.date}>
                <DayHeader date={group.date} total={group.total} />
                {group.rows.map((row) => (
                  <ActivityRow key={row.id} row={row} color={meta.categories.find((item) => item.name === row.category && item.type === row.type)?.colorToken ?? "cat-other"} active={row.id === active?.id} swiped={row.id === swipedId} canDelete={online} onSelect={() => setActiveId(row.id)} onSwipe={() => setSwipedId(row.id)} onReset={() => setSwipedId(null)} onDelete={() => remove(row)} />
                ))}
              </section>
            ))}
          </div>
        ) : <Empty text="No transactions match these filters." action={<Link to="/add">Add a transaction</Link>} />}
      </div>
    </DeskPage>
  );
}

function ActivityRow({ row, color, active, swiped, canDelete, onSelect, onSwipe, onReset, onDelete }: { row: Row; color: string; active: boolean; swiped: boolean; canDelete: boolean; onSelect: () => void; onSwipe: () => void; onReset: () => void; onDelete: () => void }) {
  // A drag ends with a click on the Link; swallow it so swiping never opens the row.
  const dragged = useRef(false);
  // Delete grows in with the pull and is invisible at rest, so no red sliver shows behind the row.
  const x = useMotionValue(0);
  const reveal = useTransform(x, [-96, -8, 0], [1, 0, 0]);
  const scale = useTransform(x, [-96, -24], [1, 0.6]);
  const still = useReducedMotion();
  // Snap imperatively: a drag released inside the constraints would otherwise stay half-open.
  const snap = (open: boolean) => animate(x, open ? -96 : 0, still ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 30, mass: 0.8, velocity: x.getVelocity() });
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the parent's open row; snap reads only stable refs.
  useEffect(() => {
    const anim = snap(swiped);
    return () => anim.stop();
  }, [swiped]);
  return (
    <div className="relative overflow-hidden border-b border-hairline desk:border-0">
      <motion.button type="button" disabled={!canDelete} onClick={onDelete} style={{ opacity: reveal }} className="absolute inset-y-0 right-0 flex w-24 items-center justify-center bg-over text-sm font-semibold text-on-over disabled:opacity-50 desk:hidden"><motion.span style={{ scale }}>Delete</motion.span></motion.button>
      <motion.div
        drag={canDelete ? "x" : false}
        dragDirectionLock
        dragConstraints={{ left: -96, right: 0 }}
        dragElastic={{ left: 0.25, right: 0.05 }}
        dragTransition={{ bounceStiffness: 500, bounceDamping: 28 }}
        style={{ x }}
        onDragStart={() => { dragged.current = true; }}
        onDragEnd={(_, info) => {
          setTimeout(() => { dragged.current = false; });
          // A quick flick counts even when the row barely moved.
          const open = info.offset.x < -48 || info.velocity.x < -400;
          snap(open);
          if (open) onSwipe(); else onReset();
        }}
        className="relative bg-paper desk:bg-transparent"
      >
        <Link to="/txn/$id" params={{ id: String(row.id) }} onClick={(event) => { if (dragged.current || swiped) { event.preventDefault(); if (swiped) onReset(); return; } onSelect(); }} className="flex min-h-[58px] items-center justify-between gap-3 py-1.5 text-ink hover:bg-sunken/50 hover:text-ink desk:hidden">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-1.5 truncate text-[15px] font-medium">{row.needsReview && <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-brand" />}<span className="truncate">{row.merchant}</span></span>
            <RowMeta t={row} color={color} />
          </span>
          <Amount t={row} />
        </Link>
        <button type="button" onClick={onSelect} className="hidden min-h-10 w-full grid-cols-[56px_minmax(0,1fr)_120px_64px_84px] items-center gap-3 px-2 text-left text-sm text-ink desk:grid" style={active ? { background: "var(--color-brand-soft)" } : undefined}>
          <span className="text-ink-3">{time(row.date)}</span>
          <span className="flex min-w-0 items-center gap-1.5 truncate font-medium">{row.needsReview && <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-brand" />}<span className="truncate">{row.merchant}</span></span>
          <span className="flex items-center gap-1.5 truncate"><CategoryDot color={color} />{row.category ?? "Other"}</span>
          <span className="text-ink-3">{card(row.accountLast4)}</span>
          <Amount t={row} className="justify-self-end" />
        </button>
      </motion.div>
    </div>
  );
}
