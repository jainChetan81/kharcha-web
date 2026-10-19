import { Dialog } from "radix-ui";
import { CalendarDays, Check, ChevronDown, Filter as FilterIcon, Search, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { money, monthLabel, rangeLabel } from "../lib/format";
import { countFor, preset, presetOn, selectedCategories, today } from "../lib/filters";
import { Button, Chip } from "./ui";

type Status = "review" | "receipt" | "split" | "reimbursable";
type SearchState = {
  month?: string; from?: string; to?: string; category?: string; categories?: string[];
  card?: string; type?: "income" | "expense" | "investment" | "transfer"; tripId?: number;
  min?: number; max?: number; sort?: "newest" | "oldest" | "amount-desc" | "amount-asc";
  review?: boolean; status?: Status[];
};
type Category = { name: string; type: string; colorToken: string };
type Props = {
  search: SearchState; categories: Category[]; cards: string[]; trips: { id: number; name: string }[];
  reviewCount?: number; resultCount?: number; getCount?: (search: SearchState) => Promise<number>;
  onApply: (next: Partial<SearchState>) => void; onClear: () => void; onReview?: () => void;
  dateOpen?: boolean; onDateClose?: () => void;
  /** Insights puts its month stepper in this row, right after Filter. */
  month?: ReactNode;
  hiddenRail?: boolean; onRailVisibilityChange?: (hidden: boolean) => void;
};
const filters = ["Sort", "Date", "Category", "Card", "Type", "Trip", "Amount", "Status"] as const;
type Filter = (typeof filters)[number];
const sortOptions = [["newest", "Newest first"], ["oldest", "Oldest first"], ["amount-desc", "Highest amount"], ["amount-asc", "Lowest amount"]] as const;
const typeOptions = [["expense", "Expense"], ["income", "Income"], ["investment", "Investment"], ["transfer", "Not counted"]] as const;
const statusOptions: { id: Status; label: string }[] = [{ id: "review", label: "Needs review" }, { id: "receipt", label: "Has a receipt" }, { id: "split", label: "Split" }, { id: "reimbursable", label: "Reimbursable" }];
const compactRange = (s: SearchState) => s.min !== undefined || s.max !== undefined ? `${s.min === undefined ? "" : money(s.min)}${s.min !== undefined && s.max !== undefined ? "–" : ""}${s.max === undefined ? "" : money(s.max)}` : "";
const chipBase = "inline-flex min-h-11 shrink-0 items-center justify-center rounded-chip border px-3 text-[13px] font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2";

function FilterPill({ label, active, onClick, icon, value }: { label: string; active?: boolean; onClick: () => void; icon?: React.ReactNode; value?: string }) {
  return <button type="button" onClick={onClick} className={`${chipBase} min-h-[44px] border-transparent p-1.5`}><span className={`${chipBase} min-h-9 gap-1.5 px-3 ${active ? "border-brand bg-brand text-on-brand" : "border-field bg-card text-ink"}`}>{icon}{value ?? label}</span></button>;
}
// Bar pills are brand-filled (§16); chips in the filter screen and desktop toolbar are brand-soft (§6).
function AppliedChip({ label, remove, filled }: { label: string; remove: () => void; filled?: boolean }) {
  return <button type="button" onClick={remove} aria-label={`Remove ${label} filter`} className={`inline-flex min-h-9 shrink-0 items-center gap-2 rounded-chip px-3 text-[13px] font-medium ${filled ? "bg-brand text-on-brand" : "bg-brand-soft text-brand"} focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2`}>{label}<X size={14} aria-hidden="true" /></button>;
}
function useDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => { const media = window.matchMedia("(min-width: 840px)"); const update = () => setDesktop(media.matches); update(); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  return desktop;
}
function activeCount(s: SearchState, name: Filter) {
  if (name === "Sort") return Number(Boolean(s.sort && s.sort !== "newest"));
  if (name === "Date") return Number(Boolean(s.from || s.to) && !s.month);
  if (name === "Category") return selectedCategories(s).length;
  if (name === "Card") return Number(Boolean(s.card));
  if (name === "Type") return Number(Boolean(s.type));
  if (name === "Trip") return Number(Boolean(s.tripId));
  if (name === "Amount") return Number(s.min !== undefined || s.max !== undefined);
  return s.status?.length ?? Number(Boolean(s.review));
}
function summaryValue(s: SearchState, name: Filter, trips: Props["trips"]) {
  if (name === "Sort") return sortOptions.find(([k]) => k === (s.sort ?? "newest"))?.[1] ?? "Newest first";
  if (name === "Date") return s.from && s.to ? rangeLabel(s.from, s.to) : "Any date";
  if (name === "Category") return selectedCategories(s).map((v) => v.split(":").at(-1)).join(", ") || "Any category";
  if (name === "Card") return s.card ? `••${s.card}` : "Any card";
  if (name === "Type") return typeOptions.find(([k]) => k === s.type)?.[1] ?? "Any type";
  if (name === "Trip") return trips.find((v) => v.id === s.tripId)?.name ?? "Any trip";
  if (name === "Amount") return compactRange(s) || "Any amount";
  return (s.status ?? []).map((v) => statusOptions.find((o) => o.id === v)?.label).filter(Boolean).join(", ") || (s.review ? "Needs review" : "Any status");
}
function without(_s: SearchState, name: Filter): Partial<SearchState> {
  if (name === "Sort") return { sort: undefined };
  if (name === "Date") return { from: undefined, to: undefined, month: undefined };
  if (name === "Category") return { category: undefined, categories: undefined };
  if (name === "Card") return { card: undefined };
  if (name === "Type") return { type: undefined };
  if (name === "Trip") return { tripId: undefined };
  if (name === "Amount") return { min: undefined, max: undefined };
  return { status: undefined, review: undefined };
}

export function ActivityFilters({ search, categories, cards, trips, reviewCount, resultCount = 0, getCount, onApply, onClear, onReview, dateOpen = false, onDateClose, month, hiddenRail: hiddenRailProp, onRailVisibilityChange }: Props) {
  const desktop = useDesktop();
  const [screen, setScreen] = useState(false);
  const [section, setSection] = useState<Filter>("Date");
  const [sortOpen, setSortOpen] = useState(false);
  const [hiddenRailLocal, setHiddenRailLocal] = useState(false);
  const hiddenRail = hiddenRailProp ?? hiddenRailLocal;
  const setHiddenRail = (next: boolean) => { setHiddenRailLocal(next); onRailVisibilityChange?.(next); };
  const count = countFor(search, Boolean(onReview));
  const cats = useMemo(() => selectedCategories(search), [search]);
  const status = useMemo(() => [...new Set([...(search.status ?? []), ...(search.review ? ["review" as const] : [])])], [search.status, search.review]);
  const customLabel = search.from && search.to ? rangeLabel(search.from, search.to) : undefined;
  const quick = (name: Filter) => { setSection(name); setScreen(true); };
  useEffect(() => { if (dateOpen) { setSection("Date"); setScreen(true); } }, [dateOpen]);
  const remove = (name: Filter, category?: string) => {
    if (name === "Category" && category) { const next = cats.filter((v) => v !== category); onApply({ categories: next.length ? next : undefined, category: undefined }); }
    else if (name === "Status" && category) { const next = status.filter((v) => v !== category); onApply({ status: next.length ? next : undefined, review: undefined }); }
    else onApply(without(search, name));
  };
  const applied = useMemo(() => {
    const out: { name: Filter; value: string; key?: string }[] = [];
    if ((search.from || search.to) && !search.month) out.push({ name: "Date", value: customLabel ?? "Date" });
    cats.forEach((v) => { out.push({ name: "Category", value: v.split(":").at(-1) ?? v, key: v }); });
    if (search.card) out.push({ name: "Card", value: `••${search.card}` });
    if (search.type) out.push({ name: "Type", value: typeOptions.find(([k]) => k === search.type)?.[1] ?? search.type });
    if (search.tripId) out.push({ name: "Trip", value: trips.find((v) => v.id === search.tripId)?.name ?? "Trip" });
    if (search.min !== undefined || search.max !== undefined) out.push({ name: "Amount", value: compactRange(search) });
    status.forEach((v) => { out.push({ name: "Status", value: statusOptions.find((o) => o.id === v)?.label ?? v, key: v }); });
    return out;
  }, [search, cats, status, trips, customLabel]);
  const dialogs = <>{screen && <FilterScreen key={section} initial={search} section={section} categories={categories} cards={cards} trips={trips} resultCount={resultCount} getCount={getCount} onClose={() => { setScreen(false); onDateClose?.(); }} onApply={(next) => { onApply(next); setScreen(false); onDateClose?.(); }} onClear={onClear} />}{sortOpen && <SortDialog value={search.sort ?? "newest"} onClose={() => setSortOpen(false)} onSelect={(value) => { onApply({ sort: value }); setSortOpen(false); }} />}</>;
  const controls = <>
    <div className="relative -mx-1">
      <div role="toolbar" aria-label="Activity filters" className="flex min-h-11 items-center gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <FilterPill label="Filter" active={count > 0} value={`Filter${count ? ` · ${count}` : ""}`} icon={<FilterIcon size={14} aria-hidden="true" />} onClick={() => quick("Date")} />
        {month}
        {onReview && <FilterPill label="Sort" active={Boolean(search.sort && search.sort !== "newest")} value="Sort" onClick={() => desktop ? quick("Sort") : setSortOpen(true)} />}
        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-rule" />
        {applied.map((item, i) => <AppliedChip filled key={`${item.name}-${item.key ?? i}`} label={item.value} remove={() => remove(item.name, item.key)} />)}
        {!cats.length && <FilterPill label="Category" value="Category" onClick={() => quick("Category")} />}
        {!search.card && <FilterPill label="Card" value="Card" onClick={() => quick("Card")} />}
        {!search.type && <FilterPill label="Type" value="Type" icon={<ChevronDown size={14} aria-hidden="true" />} onClick={() => quick("Type")} />}
        {onReview && <button type="button" aria-pressed={status.includes("review")} onClick={onReview} className={`${chipBase} min-h-[44px] p-1.5`}><span className={`${chipBase} min-h-9 gap-2 px-3 ${status.includes("review") ? "border-brand bg-brand text-on-brand" : "border-field bg-card text-ink"}`}><i aria-hidden="true" className="size-2 rounded-full bg-brand" />Needs review{reviewCount ? ` · ${reviewCount}` : ""}</span></button>}
        {count > 0 && <button type="button" onClick={onClear} className="min-h-11 shrink-0 px-2 text-[13px] font-semibold text-brand focus-visible:outline-2 focus-visible:outline-brand">Clear all</button>}
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-paper to-transparent" />
    </div>
  </>;
  if (!desktop || !onReview) return <div className="sticky top-0 z-20 -mx-5 border-b border-hairline bg-paper/95 px-4 pt-1 backdrop-blur desk:static desk:mx-0 desk:border-0 desk:bg-transparent desk:p-0">{controls}{dialogs}</div>;
  if (hiddenRail) return <>{dialogs}</>;
  return <aside aria-label="Activity filter rail" className="flex flex-col gap-3"><div className="rounded-card border border-rule bg-card p-3"><div className="mb-2 flex items-center justify-between"><strong className="text-sm">Filters</strong><button type="button" aria-label="Hide filters" onClick={() => setHiddenRail(true)} className="min-h-11 px-2 text-sm text-brand focus-visible:outline-2 focus-visible:outline-brand">Hide</button></div><div className="max-h-[calc(100dvh-220px)] overflow-y-auto">{filters.filter((name) => name !== "Sort").map((name) => <RailSection key={name} name={name} search={search} categories={categories} cards={cards} trips={trips} onApply={onApply} />)}</div><button type="button" onClick={onClear} disabled={!count} className="mt-2 min-h-11 w-full text-left text-sm font-semibold text-brand disabled:text-ink-3 focus-visible:outline-2 focus-visible:outline-brand">Clear all</button></div>{dialogs}</aside>;
}

export function FilterToolbar({ search, trips, resultCount, onApply, onClear, onShowRail, railHidden }: { search: SearchState; trips: Props["trips"]; resultCount: number; onApply: Props["onApply"]; onClear: Props["onClear"]; onShowRail?: () => void; railHidden?: boolean }) {
  const options = sortOptions;
  const cats = selectedCategories(search);
  const statuses = [...new Set([...(search.status ?? []), ...(search.review ? ["review" as const] : [])])];
  const chips: { name: Filter; value: string; key?: string }[] = [];
  if ((search.from || search.to) && !search.month) chips.push({ name: "Date", value: search.from && search.to ? rangeLabel(search.from, search.to) : "Custom date" });
  cats.forEach((v) => { chips.push({ name: "Category", value: v.split(":").at(-1) ?? v, key: v }); });
  if (search.card) chips.push({ name: "Card", value: `••${search.card}` });
  if (search.type) chips.push({ name: "Type", value: typeOptions.find(([k]) => k === search.type)?.[1] ?? search.type });
  if (search.tripId) chips.push({ name: "Trip", value: trips.find((t) => t.id === search.tripId)?.name ?? "Trip" });
  if (search.min !== undefined || search.max !== undefined) chips.push({ name: "Amount", value: compactRange(search) });
  statuses.forEach((v) => { chips.push({ name: "Status", value: statusOptions.find((o) => o.id === v)?.label ?? v, key: v }); });
  const removeChip = (name: Filter, key?: string) => {
    if (name === "Category" && key) { const next = cats.filter((v) => v !== key); onApply({ categories: next.length ? next : undefined, category: undefined }); }
    else if (name === "Status" && key) { const next = statuses.filter((v) => v !== key); onApply({ status: next.length ? next : undefined, review: undefined }); }
    else onApply(without(search, name));
  };
  return <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-hairline pb-2 text-[13px]">{railHidden && onShowRail && <button type="button" onClick={onShowRail} className="inline-flex min-h-9 items-center gap-1.5 rounded-chip border border-field bg-card px-3 font-medium text-ink focus-visible:outline-2 focus-visible:outline-brand"><FilterIcon size={14} aria-hidden="true" />Filters · {countFor(search, true)}</button>}<strong className="mr-1 font-semibold">{resultCount} transactions</strong>{chips.map((chip, i) => <AppliedChip key={`${chip.name}-${chip.key ?? i}`} label={chip.value} remove={() => removeChip(chip.name, chip.key)} />)}{countFor(search, true) > 0 && <button type="button" onClick={onClear} className="min-h-9 px-2 font-semibold text-brand">Clear all</button>}<label className="ml-auto flex min-h-9 items-center gap-2 text-ink-2">Sort<select aria-label="Sort transactions" value={search.sort ?? "newest"} onChange={(e) => onApply({ sort: e.target.value as NonNullable<SearchState["sort"]> })} className="min-h-9 rounded-chip border border-field bg-card px-2 text-ink">{options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>;
}

function OptionRow({ label, checked, onClick, mode = "checkbox", secondary }: { label: string; checked: boolean; onClick: () => void; mode?: "checkbox" | "radio"; secondary?: string }) {
  return <button type="button" aria-pressed={checked} onClick={onClick} className="flex min-h-12 w-full items-center gap-3 border-b border-hairline px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-brand"><span aria-hidden="true" className={`flex size-[18px] shrink-0 items-center justify-center border ${mode === "radio" ? "rounded-full" : "rounded-[4px]"} ${checked ? "border-brand bg-brand text-on-brand" : "border-field bg-card"}`}>{checked && <Check size={13} />}</span><span className="min-w-0 flex-1">{label}</span>{secondary && <span className="text-xs text-ink-3">{secondary}</span>}</button>;
}

function DateFields({ value, onPatch }: { value: SearchState; onPatch: (next: Partial<SearchState>) => void }) {
  const [calendar, setCalendar] = useState(false);
  return <div className="p-3"><div className="flex flex-wrap gap-2">{["Today", "This week", "Last 7 days", "This month", "Last month", "This year"].map((label) => <Chip key={label} on={presetOn(value, label)} onClick={() => onPatch(preset(label))}>{label}</Chip>)}</div><div className="my-4 grid grid-cols-2 gap-2"><label className="flex flex-col gap-1 text-[12px] text-ink-2">From<input type="date" max={value.to || today()} value={value.from ?? ""} onChange={(e) => onPatch({ from: e.target.value || undefined, month: undefined })} className="field min-h-11 w-full px-2 text-[13px]" /></label><label className="flex flex-col gap-1 text-[12px] text-ink-2">To<input type="date" min={value.from} max={today()} value={value.to ?? ""} onChange={(e) => onPatch({ to: e.target.value || undefined, month: undefined })} className="field min-h-11 w-full px-2 text-[13px]" /></label></div><button type="button" onClick={() => setCalendar(true)} className="flex min-h-11 items-center gap-2 text-sm font-medium text-brand focus-visible:outline-2 focus-visible:outline-brand"><CalendarDays size={16} />Pick on a calendar</button>{calendar && <RangeCalendar from={value.from} to={value.to} close={() => setCalendar(false)} choose={(from, to) => { onPatch({ from, to, month: undefined }); setCalendar(false); }} />}</div>;
}

function CategoryFields({ categories, selected, onToggle }: { categories: Category[]; selected: string[]; onToggle: (cat: Category) => void }) {
  const [catQuery, setCatQuery] = useState("");
  const filtered = categories.filter((item) => item.name.toLowerCase().includes(catQuery.toLowerCase()));
  return <div><label className="flex min-h-12 items-center gap-2 border-b border-hairline bg-card px-3"><Search size={16} className="text-ink-3" aria-hidden="true" /><span className="sr-only">Search categories</span><input value={catQuery} onChange={(e) => setCatQuery(e.target.value)} placeholder="Search categories" aria-label="Search categories" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>{(["expense", "income"] as const).map((type) => <fieldset key={type} className="m-0 border-0 p-0"><legend className="w-full bg-sunken px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{type === "expense" ? "Spending" : "Income"}</legend>{filtered.filter((item) => item.type === type).map((item) => { const on = selected.includes(`${type}:${item.name}`) || selected.includes(item.name); return <button key={`${type}:${item.name}`} type="button" aria-pressed={on} onClick={() => onToggle(item)} className="flex min-h-12 w-full items-center gap-3 border-b border-hairline px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-brand"><span aria-hidden="true" className={`flex size-[18px] items-center justify-center rounded-[4px] border ${on ? "border-brand bg-brand text-on-brand" : "border-field"}`}>{on && <Check size={13} />}</span><i aria-hidden="true" className="size-2.5 rounded-sm" style={{ background: `var(--color-${item.colorToken})` }} /><span>{item.name}</span></button>; })}</fieldset>)}</div>;
}

function AmountFields({ minText, maxText, setMinText, setMaxText, draft, onPatch }: { minText: string; maxText: string; setMinText: (v: string) => void; setMaxText: (v: string) => void; draft: SearchState; onPatch: (next: Partial<SearchState>) => void }) {
  const badAmount = minText !== "" && maxText !== "" && Number(minText) > Number(maxText);
  return <div className="space-y-4 p-3"><div className="flex flex-wrap gap-2">{[["Under ₹500", undefined, 499], ["₹500–5K", 500, 5000], ["₹5K–25K", 5001, 25000], ["Over ₹25K", 25001, undefined]].map(([label, min, max]) => <Chip key={String(label)} on={draft.min === min && draft.max === max} onClick={() => { onPatch({ min: min as number | undefined, max: max as number | undefined }); setMinText(min === undefined ? "" : String(min)); setMaxText(max === undefined ? "" : String(max)); }}>{label}</Chip>)}</div><div className="grid grid-cols-2 gap-2"><label className="flex flex-col gap-1 text-[12px] text-ink-2">Minimum<input aria-label="Minimum amount" inputMode="decimal" value={minText} onChange={(e) => { const value = e.target.value.replace(/[^\d.]/g, ""); setMinText(value); if (!(value !== "" && maxText !== "" && Number(value) > Number(maxText))) onPatch({ min: value ? Number(value) : undefined }); }} className="field min-h-11 px-2" /></label><label className="flex flex-col gap-1 text-[12px] text-ink-2">Maximum<input aria-label="Maximum amount" inputMode="decimal" value={maxText} onChange={(e) => { const value = e.target.value.replace(/[^\d.]/g, ""); setMaxText(value); if (!(minText !== "" && value !== "" && Number(minText) > Number(value))) onPatch({ max: value ? Number(value) : undefined }); }} className="field min-h-11 px-2" /></label></div>{badAmount && <p role="alert" className="m-0 text-sm text-over">Minimum is more than maximum.</p>}</div>;
}

function RailSection({ name, search, categories, cards, trips, onApply }: { name: Filter; search: SearchState; categories: Category[]; cards: string[]; trips: Props["trips"]; onApply: Props["onApply"] }) {
  const [open, setOpen] = useState(false);
  const [minText, setMinText] = useState(search.min?.toString() ?? "");
  const [maxText, setMaxText] = useState(search.max?.toString() ?? "");
  useEffect(() => { setMinText(search.min?.toString() ?? ""); setMaxText(search.max?.toString() ?? ""); }, [search.min, search.max]);
  const value = summaryValue(search, name, trips);
  const selected = activeCount(search, name) > 0;
  const cats = selectedCategories(search);
  const statuses = [...new Set([...(search.status ?? []), ...(search.review ? ["review" as const] : [])])];
  const toggleCategory = (cat: Category) => { const v = `${cat.type}:${cat.name}`; const next = cats.includes(v) ? cats.filter((x) => x !== v) : [...cats, v]; onApply({ categories: next.length ? next : undefined, category: undefined }); };
  const toggleStatus = (key: Status) => { const next = statuses.includes(key) ? statuses.filter((v) => v !== key) : [...statuses, key]; onApply({ status: next.length ? next : undefined, review: undefined }); };
  return <section className="border-t border-hairline"><button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-11 w-full items-center justify-between gap-2 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-brand"><span className="font-medium">{name}</span><span className="flex min-w-0 items-center gap-1"><span className={`truncate ${selected ? "text-brand" : "text-ink-3"}`}>{value}</span><ChevronDown size={13} aria-hidden="true" className={open ? "rotate-180" : ""} /></span></button>{open && <div className="pb-2">
    {name === "Date" && <DateFields value={search} onPatch={onApply} />}
    {name === "Category" && <CategoryFields categories={categories} selected={cats} onToggle={toggleCategory} />}
    {name === "Card" && <>{cards.map((v) => <OptionRow key={v} label={`••${v}`} checked={search.card === v} mode="radio" onClick={() => onApply({ card: search.card === v ? undefined : v })} />)}{cards.length === 0 && <p className="p-3 text-sm text-ink-3">No cards found.</p>}</>}
    {name === "Type" && <>{typeOptions.map(([key, label]) => <OptionRow key={key} label={label} checked={search.type === key} mode="radio" onClick={() => onApply({ type: search.type === key ? undefined : key })} />)}</>}
    {name === "Trip" && <>{trips.map((trip) => <OptionRow key={trip.id} label={trip.name} checked={search.tripId === trip.id} mode="radio" onClick={() => onApply({ tripId: search.tripId === trip.id ? undefined : trip.id })} />)}{trips.length === 0 && <p className="p-3 text-sm text-ink-3">No trips found.</p>}</>}
    {name === "Amount" && <AmountFields minText={minText} maxText={maxText} setMinText={setMinText} setMaxText={setMaxText} draft={search} onPatch={onApply} />}
    {name === "Status" && <>{statusOptions.map((item) => <OptionRow key={item.id} label={item.label} checked={statuses.includes(item.id)} onClick={() => toggleStatus(item.id)} />)}</>}
    {name === "Sort" && <>{sortOptions.map(([key, label]) => <OptionRow key={key} label={label} checked={(search.sort ?? "newest") === key} mode="radio" onClick={() => onApply({ sort: key })} />)}</>}
  </div>}</section>;
}

function FilterScreen({ initial, section: initialSection, categories, cards, trips, resultCount, getCount, onClose, onApply, onClear }: {
  initial: SearchState; section: Filter; categories: Category[]; cards: string[]; trips: Props["trips"]; resultCount: number;
  getCount?: Props["getCount"]; onClose: () => void; onApply: (next: Partial<SearchState>) => void; onClear: () => void;
}) {
  const [draft, setDraft] = useState<SearchState>(initial);
  const [section, setSection] = useState<Filter>(initialSection);
  const [minText, setMinText] = useState(initial.min?.toString() ?? "");
  const [maxText, setMaxText] = useState(initial.max?.toString() ?? "");
  const [count, setCount] = useState(resultCount);
  const cats = selectedCategories(draft);
  const statuses = [...new Set([...(draft.status ?? []), ...(draft.review ? ["review" as const] : [])])];
  const badAmount = minText !== "" && maxText !== "" && Number(minText) > Number(maxText);
  useEffect(() => {
    if (!getCount) return;
    let live = true;
    const timer = window.setTimeout(() => void getCount(draft).then((n) => { if (live) setCount(n); }).catch(() => { if (live) setCount(resultCount); }), 120);
    return () => { live = false; window.clearTimeout(timer); };
  }, [draft, getCount, resultCount]);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }; window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc); }, [onClose]);
  const patch = (next: Partial<SearchState>) => setDraft((old) => ({ ...old, ...next }));
  const setCategory = (cat: Category) => { const value = `${cat.type}:${cat.name}`; const next = cats.includes(value) ? cats.filter((v) => v !== value) : [...cats, value]; patch({ categories: next.length ? next : undefined, category: undefined }); };
  const setStatus = (key: Status) => { const next = statuses.includes(key) ? statuses.filter((v) => v !== key) : [...statuses, key]; patch({ status: next.length ? next : undefined, review: undefined }); };
  const clearDraft = () => { setDraft({ month: initial.month, sort: initial.sort }); setMinText(""); setMaxText(""); };
  const row = (label: string, checked: boolean, onClick: () => void, mode: "checkbox" | "radio" = "checkbox", secondary?: string) => <OptionRow key={label} label={label} checked={checked} onClick={onClick} mode={mode} secondary={secondary} />;
  const removeChip = (name: Filter, key?: string) => {
    if (name === "Category" && key) { const next = cats.filter((v) => v !== key); patch({ categories: next.length ? next : undefined, category: undefined }); }
    else if (name === "Status" && key) setStatus(key as Status);
    else patch(without(draft, name));
  };
  const selected: { name: Filter; value: string; key?: string }[] = [];
  if ((draft.from || draft.to) && !draft.month) selected.push({ name: "Date", value: draft.from && draft.to ? rangeLabel(draft.from, draft.to) : "Custom date" });
  cats.forEach((v) => { selected.push({ name: "Category", value: v.split(":").at(-1) ?? v, key: v }); });
  if (draft.card) selected.push({ name: "Card", value: `••${draft.card}` });
  if (draft.type) selected.push({ name: "Type", value: typeOptions.find(([k]) => k === draft.type)?.[1] ?? draft.type });
  if (draft.tripId) selected.push({ name: "Trip", value: trips.find((t) => t.id === draft.tripId)?.name ?? "Trip" });
  if (draft.min !== undefined || draft.max !== undefined) selected.push({ name: "Amount", value: compactRange(draft) });
  statuses.forEach((v) => { selected.push({ name: "Status", value: statusOptions.find((o) => o.id === v)?.label ?? v, key: v }); });
  const focus = (name: Filter) => setSection(name);
  const options = () => {
    if (section === "Sort") return sortOptions.map(([key, label]) => row(label, (draft.sort ?? "newest") === key, () => patch({ sort: key }), "radio"));
    if (section === "Date") return <DateFields value={draft} onPatch={patch} />;
    if (section === "Category") return <CategoryFields categories={categories} selected={cats} onToggle={setCategory} />;
    if (section === "Card") return <>{cards.map((v) => row(`••${v}`, draft.card === v, () => patch({ card: draft.card === v ? undefined : v }), "radio"))}{cards.length === 0 && <p className="p-3 text-sm text-ink-3">No cards found.</p>}</>;
    if (section === "Type") return typeOptions.map(([key, label]) => row(label, draft.type === key, () => patch({ type: draft.type === key ? undefined : key }), "radio"));
    if (section === "Trip") return <>{trips.map((trip) => row(trip.name, draft.tripId === trip.id, () => patch({ tripId: draft.tripId === trip.id ? undefined : trip.id }), "radio"))}{trips.length === 0 && <p className="p-3 text-sm text-ink-3">No trips found.</p>}</>;
    if (section === "Amount") return <AmountFields minText={minText} maxText={maxText} setMinText={setMinText} setMaxText={setMaxText} draft={draft} onPatch={patch} />;
    return statusOptions.map((item) => row(item.label, statuses.includes(item.id), () => setStatus(item.id)));
  };
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" /><Dialog.Content aria-describedby={undefined} className="fixed inset-0 z-50 flex flex-col bg-paper text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand"><header className="flex min-h-14 shrink-0 items-center justify-between border-b border-hairline px-4"><button type="button" aria-label="Close filters without applying" onClick={onClose} className="flex size-11 items-center justify-center rounded-button focus-visible:outline-2 focus-visible:outline-brand"><X size={20} /></button><Dialog.Title className="m-0 font-serif text-xl font-medium">Filters</Dialog.Title><button type="button" onClick={() => { clearDraft(); onClear(); }} className="min-h-11 px-2 text-[13px] font-semibold text-brand">Clear all</button></header>{selected.length > 0 && <ul aria-label="Selected filters" className="flex shrink-0 gap-2 overflow-x-auto border-b border-hairline px-3 py-2 [scrollbar-width:none]">{selected.map((item, i) => <li key={`${item.name}-${item.key ?? i}`} className="shrink-0"><AppliedChip label={item.value} remove={() => removeChip(item.name, item.key)} /></li>)}</ul>}<div className="flex min-h-0 flex-1"><nav aria-label="Filter categories" className="w-[124px] shrink-0 overflow-y-auto bg-sunken">{filters.map((name) => { const n = activeCount(draft, name); return <button type="button" key={name} aria-current={section === name ? "page" : undefined} onClick={() => focus(name)} className={`relative flex min-h-12 w-full items-center justify-between gap-1 px-3 text-left text-[13px] ${section === name ? "bg-card font-semibold text-ink" : "text-ink-2"}`}><span className="absolute inset-y-0 left-0 w-[3px] bg-transparent" style={section === name ? { background: "var(--color-brand)" } : undefined} />{name}<span className="text-[11px] text-brand">{n || ""}</span></button>; })}</nav><div className="min-w-0 flex-1 overflow-y-auto">{options()}</div></div><footer className="shrink-0 border-t border-hairline bg-paper px-4 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]"><Button disabled={badAmount || Boolean(draft.from && draft.to && draft.from > draft.to)} onClick={() => onApply({ ...draft, min: minText ? Number(minText) : undefined, max: maxText ? Number(maxText) : undefined })} className="w-full">{getCount ? `Show ${count} transactions` : "Show results"}</Button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function RangeCalendar({ from, to, choose, close }: { from?: string; to?: string; choose: (from: string, to: string) => void; close: () => void }) {
  const initial = from ? new Date(`${from}T12:00:00`) : new Date();
  const [month, setMonth] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));
  const first = new Date(month.getFullYear(), month.getMonth(), 1); const offset = (first.getDay() + 6) % 7; const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const key = (d: number) => `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const [start, setStart] = useState(from ?? "");
  const [end, setEnd] = useState(to ?? "");
  const chooseDay = (v: string) => { if (!start || end || v < start) { setStart(v); setEnd(""); } else { setEnd(v); choose(start, v); } };
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-4"><section role="dialog" aria-modal="true" aria-label="Choose date range" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }} className="w-full max-w-[360px] rounded-card border border-rule bg-card p-3 shadow-xl"><div className="mb-2 flex items-center justify-between"><button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="size-11">‹</button><strong>{monthLabel(key(1).slice(0, 7))}</strong><button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="size-11">›</button></div><div className="grid grid-cols-7 text-center text-[11px] text-ink-3">{[["Mon", "M"], ["Tue", "T"], ["Wed", "W"], ["Thu", "T"], ["Fri", "F"], ["Sat", "S"], ["Sun", "S"]].map(([name, d]) => <span key={name} className="py-1">{d}</span>)}{offset > 0 && <span key="pad" style={{ gridColumn: `span ${offset}` }} />}{Array.from({ length: days }, (_, i) => { const day = i + 1; const value = key(day); const selected = value === start || value === end; const between = start && end && value > start && value < end; const future = value > today(); return <button key={value} type="button" disabled={future} aria-pressed={selected} onClick={() => chooseDay(value)} className={`size-10 justify-self-center rounded-full text-[13px] disabled:text-ink-3/40 ${selected ? "bg-brand text-on-brand" : between ? "bg-brand-soft text-brand" : "text-ink hover:bg-sunken"}`}>{day}</button>; })}</div><button type="button" onClick={close} className="mt-2 min-h-11 w-full text-sm text-brand">Cancel</button></section></div>;
}
function SortDialog({ value, onClose, onSelect }: { value: SearchState["sort"]; onClose: () => void; onSelect: (value: NonNullable<SearchState["sort"]>) => void }) {
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc); }, [onClose]);
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" /><Dialog.Content aria-describedby={undefined} className="fixed inset-x-0 bottom-0 z-50 rounded-t-sheet bg-card p-4 pb-[max(20px,env(safe-area-inset-bottom))] text-ink outline-none tablet:inset-auto tablet:top-1/2 tablet:left-1/2 tablet:w-[min(420px,calc(100vw-40px))] tablet:-translate-x-1/2 tablet:-translate-y-1/2 tablet:rounded-sheet"><header className="mb-2 flex items-center justify-between"><Dialog.Title className="font-serif text-xl">Sort</Dialog.Title><button type="button" aria-label="Close sort options" onClick={onClose} className="size-11"><X size={18} /></button></header>{sortOptions.map(([key, label]) => <button type="button" key={key} aria-pressed={value === key} onClick={() => onSelect(key)} className="flex min-h-12 w-full items-center justify-between border-b border-hairline text-left text-sm">{label}{value === key && <Check size={18} className="text-brand" />}</button>)}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
