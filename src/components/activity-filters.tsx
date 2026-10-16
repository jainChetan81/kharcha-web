import { Popover } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { type ComponentProps, forwardRef, useEffect, useState, type ReactNode } from "react";
import { rangeLabel, money } from "../lib/format";
import { Sheet } from "./sheet";
import { Button, Chip } from "./ui";

type Search = {
  month?: string;
  from?: string;
  to?: string;
  category?: string;
  categories?: string[];
  card?: string;
  type?: "income" | "expense" | "investment" | "transfer";
  tripId?: number;
  min?: number;
  max?: number;
  sort?: "newest" | "oldest" | "amount-desc" | "amount-asc";
  review?: boolean;
};
type Category = { name: string; type: string; colorToken: string };
type Props = {
  search: Search;
  categories: Category[];
  cards: string[];
  trips: { id: number; name: string }[];
  reviewCount: number;
  onApply: (next: Partial<Search>) => void;
  onClear: () => void;
  onReview: () => void;
  dateOpen?: boolean;
  onDateClose?: () => void;
};
const sorts = [["newest", "Newest"], ["oldest", "Oldest"], ["amount-desc", "Highest amount"], ["amount-asc", "Lowest amount"]] as const;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const shiftDay = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function applyPreset(label: string): { from?: string; to?: string } {
  const now = today();
  const d = new Date(`${now}T12:00:00`);
  const weekday = (d.getDay() + 6) % 7;
  if (label === "Today") return { from: now, to: now };
  if (label === "This week") return { from: shiftDay(now, -weekday), to: now };
  if (label === "Last 7 days") return { from: shiftDay(now, -6), to: now };
  if (label === "This month") return { from: `${now.slice(0, 7)}-01`, to: now };
  if (label === "Last month") {
    const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const last = new Date(d.getFullYear(), d.getMonth(), 0);
    const date = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    return { from: date(first), to: date(last) };
  }
  if (label === "This year") return { from: `${now.slice(0, 4)}-01-01`, to: now };
  return {};
}
function useDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 840px)");
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return desktop;
}
function Pop({ label, value, active, children }: { label: string; value: string; active: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <FilterTrigger label={label} value={value} active={active} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={5} align="start" className="z-50 max-h-[min(75vh,620px)] w-[min(360px,calc(100vw-32px))] overflow-auto rounded-card border border-rule bg-card p-4 text-ink shadow-xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-bottom-1">
          {children(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
const FilterTrigger = forwardRef<HTMLButtonElement, { label: string; value: string; active: boolean } & ComponentProps<"button">>(
  ({ label, value, active, ...props }, ref) => (
    <button ref={ref} type="button" {...props} className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-chip border px-3.5 text-sm transition-transform active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 ${active ? "border-brand bg-brand text-on-brand" : "border-field bg-card text-ink"}`}>
      {value || label}<ChevronDown size={14} aria-hidden="true" />
    </button>
  ),
);

export function ActivityFilters({ search, categories, cards, trips, reviewCount, onApply, onClear, onReview, dateOpen = false, onDateClose }: Props) {
  const desktop = useDesktop();
  const [sheet, setSheet] = useState<string | null>(null);
  const [catQuery, setCatQuery] = useState("");
  const [min, setMin] = useState(search.min?.toString() ?? "");
  const [max, setMax] = useState(search.max?.toString() ?? "");
  const [from, setFrom] = useState(search.from ?? "");
  const [to, setTo] = useState(search.to ?? "");
  useEffect(() => {
    setMin(search.min?.toString() ?? "");
    setMax(search.max?.toString() ?? "");
    setFrom(search.from ?? "");
    setTo(search.to ?? "");
  }, [search.from, search.max, search.min, search.to]);
  useEffect(() => {
    if (dateOpen) setSheet("Date");
  }, [dateOpen]);
  const badAmount = min !== "" && max !== "" && Number(min) > Number(max);
  const activeCats = search.categories ?? (search.category ? [search.category] : []);
  const selected = (item: Category) => activeCats.includes(`${item.type}:${item.name}`) || activeCats.includes(item.name);
  const toggleCategory = (item: Category) => {
    const key = `${item.type}:${item.name}`;
    const next = selected(item) ? activeCats.filter((x) => x !== key && x !== item.name) : [...activeCats, key];
    onApply({ categories: next.length ? next : undefined, category: undefined });
  };
  const dateTitle = search.from && search.to ? rangeLabel(search.from, search.to) : "";
  const amountTitle = search.min !== undefined || search.max !== undefined ? `${search.min === undefined ? "" : money(search.min)}${search.min !== undefined && search.max !== undefined ? "–" : ""}${search.max === undefined ? "" : money(search.max)}` : "";
  const count = Number(Boolean(search.from || search.to)) + activeCats.length + Number(Boolean(search.card)) + Number(Boolean(search.type)) + Number(Boolean(search.tripId)) + Number(search.min !== undefined || search.max !== undefined);
  const filtered = (type: string) => categories.filter((c) => c.type === type && c.name.toLowerCase().includes(catQuery.toLowerCase()));
  const content = (name: string, close: () => void) => {
    const apply = (next: Partial<Search>) => { onApply(next); close(); setSheet(null); onDateClose?.(); };
    return (
      <div className="flex flex-col gap-4">
        {name === "Category" && <>
          <label className="field flex min-h-11 items-center px-3"><span className="sr-only">Search categories</span><input value={catQuery} onChange={(e) => setCatQuery(e.target.value)} placeholder="Search categories" className="w-full bg-transparent outline-none" /></label>
          {(["expense", "income"] as const).map((type) => <fieldset key={type} className="m-0 border-0 p-0"><legend className="label-caps mb-2 text-ink-3">{type === "expense" ? "Spending" : "Income"}</legend>{filtered(type).map((item) => <label key={`${type}:${item.name}`} className="flex min-h-11 items-center gap-3 border-b border-hairline text-sm"><input type="checkbox" checked={selected(item)} onChange={() => toggleCategory(item)} className="size-5 accent-brand" /><i aria-hidden className="size-2.5 rounded-sm" style={{ background: `var(--color-${item.colorToken})` }} /><span className="flex-1">{item.name}</span></label>)}</fieldset>)}
          <Button variant="primary" onClick={() => { close(); setSheet(null); }}>Done · {activeCats.length} selected</Button>
        </>}
        {name === "Amount" && <>
          <div className="flex flex-wrap gap-2">{[["Under ₹500", undefined, 499.99], ["₹500–5K", 500, 5000], ["₹5K–25K", 5000.01, 25000], ["Over ₹25K", 25000.01, undefined]].map(([label, lo, hi]) => <Chip key={String(label)} on={search.min === lo && search.max === hi} onClick={() => apply({ min: lo as number | undefined, max: hi as number | undefined })}>{label}</Chip>)}</div>
          <div className="grid grid-cols-2 gap-3"><label className="flex flex-col gap-1 text-[13px] text-ink-2">Minimum<input aria-label="Minimum amount" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d.]/g, ""))} className="field min-h-11 px-3" /></label><label className="flex flex-col gap-1 text-[13px] text-ink-2">Maximum<input aria-label="Maximum amount" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value.replace(/[^\d.]/g, ""))} className="field min-h-11 px-3" /></label></div>
          {badAmount && <p role="alert" className="m-0 text-sm text-over">Minimum is more than maximum.</p>}
          <div className="flex gap-2"><Button variant="outline" className="flex-1" onClick={() => apply({ min: undefined, max: undefined })}>Clear</Button><Button disabled={badAmount} className="flex-1" onClick={() => apply({ min: min ? Number(min) : undefined, max: max ? Number(max) : undefined })}>Show</Button></div>
        </>}
        {name === "Date" && <>
          <div className="flex flex-wrap gap-2">{["Today", "This week", "Last 7 days", "This month", "Last month", "This year"].map((preset) => <Chip key={preset} on={false} onClick={() => apply({ ...applyPreset(preset), month: undefined })}>{preset}</Chip>)}</div>
          <div className="grid grid-cols-2 gap-3"><label className="flex flex-col gap-1 text-[13px] text-ink-2">From<input type="date" value={from} max={to || today()} onChange={(e) => setFrom(e.target.value)} className="field min-h-11 px-2" /></label><label className="flex flex-col gap-1 text-[13px] text-ink-2">To<input type="date" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} className="field min-h-11 px-2" /></label></div>
          <Button disabled={!from || !to || from > to} onClick={() => apply({ from, to, month: undefined })}>Apply custom range</Button><Button variant="outline" onClick={() => apply({ from: undefined, to: undefined })}>Clear date</Button>
        </>}
        {name === "Sort" && <fieldset className="m-0 border-0 p-0"><legend className="sr-only">Sort transactions</legend>{sorts.map(([key, label]) => <label key={key} className="flex min-h-12 w-full items-center justify-between border-b border-hairline text-left"><span>{label}</span><input type="radio" name="activity-sort" checked={(search.sort ?? "newest") === key} onChange={() => apply({ sort: key })} className="size-5 accent-brand" />{(search.sort ?? "newest") === key && <Check size={18} aria-hidden="true" />}</label>)}</fieldset>}
        {name === "Card" && <div className="flex flex-wrap gap-2">{cards.map((v) => <Chip key={v} on={search.card === v} onClick={() => apply({ card: search.card === v ? undefined : v })}>••{v}</Chip>)}<Button variant="outline" onClick={() => apply({ card: undefined })}>Clear</Button></div>}
        {name === "Type" && <div className="flex flex-wrap gap-2">{([ ["expense", "Expense"], ["income", "Income"], ["investment", "Investment"], ["transfer", "Not counted"] ] as const).map(([key, label]) => <Chip key={key} on={search.type === key} onClick={() => apply({ type: search.type === key ? undefined : key })}>{label}</Chip>)}</div>}
        {name === "Trip" && <div className="flex flex-wrap gap-2">{trips.map((trip) => <Chip key={trip.id} on={search.tripId === trip.id} onClick={() => apply({ tripId: search.tripId === trip.id ? undefined : trip.id })}>{trip.name}</Chip>)}<Button variant="outline" onClick={() => apply({ tripId: undefined })}>Clear</Button></div>}
        {name === "Filter" && <div className="grid grid-cols-2 gap-2">{["Date", "Category", "Card", "Type", "Trip", "Amount", "Sort"].map((v) => <button key={v} type="button" onClick={() => setSheet(v)} className="min-h-11 rounded-chip border border-field text-sm">{v}</button>)}</div>}
      </div>
    );
  };
  const picker = (name: string, label: string, value: string, active: boolean) => desktop
    ? <Pop key={name} label={label} value={value} active={active}>{(close) => content(name, close)}</Pop>
    : <FilterTrigger key={name} label={label} value={value} active={active} onClick={() => setSheet(name)} />;
  return <>
    <div className="relative -mx-5 desk:mx-0"><div role="toolbar" aria-label="Activity filters" className="flex gap-2 overflow-x-auto px-5 pb-1 desk:flex-wrap desk:overflow-visible desk:px-0">
      <button type="button" aria-pressed={Boolean(search.review)} onClick={onReview} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-chip border px-3.5 text-sm active:scale-[0.96] ${search.review ? "border-brand bg-brand text-on-brand" : "border-field bg-card text-ink"}`}><i aria-hidden className="size-2 rounded-full bg-brand" />Needs review <strong>{reviewCount}</strong></button>
      {picker("Filter", "Filter", `Filter${count ? ` · ${count}` : ""}`, count > 0)}
      {picker("Sort", "Sort", sorts.find(([k]) => k === search.sort)?.[1] ?? "Newest", Boolean(search.sort && search.sort !== "newest"))}
      {picker("Category", "Category", activeCats.length ? `${activeCats.length} categories` : "", activeCats.length > 0)}
      {picker("Card", "Card", search.card ? `••${search.card}` : "", Boolean(search.card))}
      {picker("Type", "Type", search.type === "transfer" ? "Not counted" : search.type ?? "", Boolean(search.type))}
      {picker("Trip", "Trip", trips.find((t) => t.id === search.tripId)?.name ?? "", Boolean(search.tripId))}
      {picker("Amount", "Amount", amountTitle, Boolean(amountTitle))}
    </div><span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-paper to-transparent desk:hidden" /></div>
    {count > 0 && <div className="flex flex-wrap gap-2">{search.from && search.to && <Applied label={dateTitle} onClick={() => onApply({ from: undefined, to: undefined })} />}{activeCats.map((value) => <Applied key={value} label={value.split(":").at(-1) ?? value} onClick={() => { const next = activeCats.filter((v) => v !== value); onApply({ categories: next.length ? next : undefined, category: undefined }); }} />)}{search.card && <Applied label={`••${search.card}`} onClick={() => onApply({ card: undefined })} />}{search.type && <Applied label={search.type === "transfer" ? "Not counted" : search.type} onClick={() => onApply({ type: undefined })} />}{search.tripId && <Applied label={trips.find((t) => t.id === search.tripId)?.name ?? "Trip"} onClick={() => onApply({ tripId: undefined })} />}{amountTitle && <Applied label={amountTitle} onClick={() => onApply({ min: undefined, max: undefined })} />}<button type="button" onClick={onClear} className="min-h-9 px-2 text-sm font-medium text-brand">Clear</button></div>}
    {sheet && <Sheet title={sheet} onClose={() => { setSheet(null); onDateClose?.(); }}>{content(sheet, () => { setSheet(null); onDateClose?.(); })}</Sheet>}
  </>;
}
function Applied({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex min-h-9 items-center gap-2 rounded-chip bg-brand-soft px-3 text-[13px] font-medium text-brand">{label}<span aria-hidden="true">×</span><span className="sr-only">Remove {label}</span></button>;
}
