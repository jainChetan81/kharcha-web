import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, ErrorState, Field, PageHeader, SectionHead, Skeleton } from "../components/ui";
import { IosInstallSheet, promptInstall } from "../components/pwa";
import { saveFailed, snack, useHoldsInput } from "../components/sheet";
import { useOnline } from "../components/sync-pill";
import {
  getSettings,
  removeRule,
  reorderCategories,
  restoreRule,
  saveCategory,
  saveSettings,
  updateRule,
} from "../server/daily/settings";
import type { Category } from "../server/db/schema";

export const Route = createFileRoute("/settings")({
  loader: () => getSettings(),
  pendingComponent: () => <Skeleton rows={7} />,
  errorComponent: ({ error }) => { const router = useRouter(); return <ErrorState text={error instanceof Error ? error.message : "Couldn't load settings."} retry={() => void router.invalidate()} />; },
  component: Settings,
});

const categoryColors = [
  "cat-food", "cat-shopping", "cat-transport", "cat-utilities", "cat-entertainment",
  "cat-home", "cat-health", "cat-sports", "cat-work", "cat-other",
] as const;

type Rule = Awaited<ReturnType<typeof getSettings>>["rules"][number];

function Settings() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const online = useOnline();
  useHoldsInput();
  const [ios, setIos] = useState(false);
  const [search, setSearch] = useState("");
  const [ruleEdit, setRuleEdit] = useState<number | null>(null);
  const [categoryDraft, setCategoryDraft] = useState({ name: "", type: "expense" as const, colorToken: "cat-other" });
  const { used, cap } = data.ai;
  const lastIngest = data.values.last_ingest_at;
  const lastIngestDate = lastIngest ? new Date(lastIngest.replace(" ", "T")) : null;
  const ageMinutes = lastIngestDate && !Number.isNaN(lastIngestDate.valueOf())
    ? Math.max(0, Math.floor((Date.now() - lastIngestDate.valueOf()) / 60_000))
    : null;
  const ingestStatus = ageMinutes === null ? "No SMS received yet" : ageMinutes >= 360 ? `Mini quiet · ${Math.floor(ageMinutes / 60)} h` : "Healthy";
  const ingestTime = lastIngestDate && !Number.isNaN(lastIngestDate.valueOf())
    ? `${lastIngestDate.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}, ${lastIngestDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })} · ${ageMinutes! < 60 ? `${ageMinutes} min ago` : `${Math.floor(ageMinutes! / 60)} h ago`}`
    : "Not received yet";

  const refresh = () => void router.invalidate();
  const save = async (key: "openrouter_model" | "openrouter_vision_model" | "openrouter_daily_cap", value: string) => {
    if (!online || value === (data.values[key] ?? "")) return;
    try {
      await saveSettings({ data: { key, value } });
      snack("Saved settings.");
      refresh();
    } catch { saveFailed(() => save(key, value)); }
  };
  const moveCategory = async (item: Category, direction: -1 | 1) => {
    const group = data.categories.filter((x) => x.type === item.type).sort((a, b) => a.sortOrder - b.sortOrder);
    const index = group.findIndex((x) => x.name === item.name);
    const target = index + direction;
    if (target < 0 || target >= group.length) return;
    const reordered = [...group];
    [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
    if (!online) return;
    try {
      await reorderCategories({ data: { items: reordered.map((x, sortOrder) => ({ name: x.name, type: x.type, sortOrder })) } });
      refresh();
    } catch { saveFailed(() => moveCategory(item, direction)); }
  };
  const updateCategory = async (item: Category, patch: Partial<Pick<Category, "name" | "colorToken">>) => {
    const nextName = patch.name ?? item.name;
    if (!nextName.trim() || !online) return;
    try {
      await saveCategory({ data: { oldName: item.name, name: nextName, type: item.type, colorToken: patch.colorToken ?? item.colorToken, sortOrder: item.sortOrder } });
      refresh();
    } catch (error) {
      snack(error instanceof Error ? error.message : "Couldn't save category.");
    }
  };
  const addCategory = async () => {
    const name = categoryDraft.name.trim();
    if (!name || !online) return;
    try {
      await saveCategory({ data: { name, type: categoryDraft.type, colorToken: categoryDraft.colorToken, sortOrder: data.categories.filter((x) => x.type === categoryDraft.type).length } });
      setCategoryDraft({ name: "", type: "expense", colorToken: "cat-other" });
      snack("Category added.");
      refresh();
    } catch (error) {
      snack(error instanceof Error ? error.message : "Couldn't add category.");
    }
  };
  const deleteMerchantRule = async (rule: Rule) => {
    if (!online) return;
    try {
      const removed = await removeRule({ data: { id: rule.id } });
      if (!removed) return;
      snack("Rule deleted. Past rows keep their category.", {
        label: "Undo",
        onClick: () => {
          void restoreRule({ data: removed }).then(() => {
            refresh();
          }).catch(() => saveFailed(() => restoreRule({ data: removed }).then(refresh)));
        },
      });
      refresh();
    } catch { saveFailed(() => deleteMerchantRule(rule)); }
  };
  const editMerchantRule = async (rule: Rule, values: { match: string; displayMerchant: string; category: string }) => {
    if (!online) return;
    try {
      await updateRule({ data: { id: rule.id, ...values } });
      setRuleEdit(null);
      snack("Rule saved.");
      refresh();
    } catch { saveFailed(() => editMerchantRule(rule, values)); }
  };
  const rules = data.rules.filter((x) => `${x.match} ${x.displayMerchant} ${x.category}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <main>
      <PageHeader back="/" title="Settings" />
      <div className="space-y-7 px-5 pb-10 tablet:mx-auto tablet:max-w-[720px] desk:px-0">
        <section aria-labelledby="settings-app">
          <SectionHead id="settings-app" title="App" />
          <div className="flex min-h-14 items-center justify-between gap-3 border-b border-hairline py-2">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] font-medium">Last SMS from the mini</span>
              <span className="text-[13px] text-ink-3">{ingestTime}</span>
            </span>
            <span className={`shrink-0 text-[13px] font-semibold ${ageMinutes !== null && ageMinutes < 360 ? "text-earn" : "text-ink-3"}`}>
              <span aria-hidden className="mr-1.5 inline-block size-[7px] rounded-full bg-current" />{ingestStatus}
            </span>
          </div>
          <div className="flex min-h-14 items-center justify-between border-b border-hairline">
            <span className="text-[15px] font-medium">Install app</span>
            <Button variant="outline" className="min-h-10 text-sm" onClick={() => void promptInstall().then((result) => {
              if (result === "ios") setIos(true);
              else if (result === "installed") snack("Kharcha is already installed.");
              else if (result === "unavailable") snack("Install is available from your browser menu.");
            })}>Install</Button>
          </div>
          <div className="flex min-h-14 items-center justify-between border-b border-hairline">
            <span className="text-[15px] font-medium">Export CSV</span>
            <a href="/api/export" className="inline-flex min-h-10 items-center rounded-button border border-ink px-3.5 text-sm font-medium text-ink">Download</a>
          </div>
        </section>

        <section aria-labelledby="settings-ai">
          <SectionHead id="settings-ai" title="AI" />
          {!data.aiOn && <p className="mt-3 mb-0 rounded-card border border-dashed border-field bg-card px-3.5 py-3 text-sm leading-relaxed">Ask and Receipts stay off until login is turned on. They send data to OpenRouter.</p>}
          <div className="space-y-3 pt-3.5">
            <Field id="model" label="Text model" defaultValue={data.values.openrouter_model ?? ""} placeholder={data.ai.model} disabled={!online} className="font-mono" onBlur={(event) => void save("openrouter_model", event.currentTarget.value)} />
            <Field id="vision" label="Vision model, for receipts" defaultValue={data.values.openrouter_vision_model ?? ""} placeholder={data.ai.visionModel} disabled={!online} className="font-mono" onBlur={(event) => void save("openrouter_vision_model", event.currentTarget.value)} />
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="cap" className="text-[13px] text-ink-2">Daily call cap</label>
                <span className="text-sm"><strong className="font-semibold">{used}</strong><span className="text-ink-3"> of {cap} used today</span></span>
              </div>
              <input id="cap" className="field" inputMode="numeric" disabled={!online} defaultValue={data.values.openrouter_daily_cap ?? ""} placeholder={String(data.ai.cap)} onBlur={(event) => void save("openrouter_daily_cap", event.currentTarget.value)} />
              <div aria-label={`${cap > 0 ? Math.min(100, (used / cap) * 100) : 0}% of daily AI call cap used`} role="img" className="h-1.5 overflow-hidden rounded-sm bg-sunken">
                <div className="h-full rounded-sm bg-brand" style={{ width: `${cap > 0 ? Math.min(100, (used / cap) * 100) : 0}%` }} />
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="settings-categories">
          <SectionHead id="settings-categories" title="Categories" action={<button type="button" className="inline-flex min-h-8 items-center gap-1 text-sm font-medium text-brand" onClick={() => document.getElementById("new-category-name")?.focus()}><Plus size={16} />Add</button>} />
          <div className="grid grid-cols-[24px_14px_minmax(0,1fr)_minmax(92px,auto)] gap-x-2.5">
            {[...data.categories].sort((a, b) => a.type.localeCompare(b.type) || a.sortOrder - b.sortOrder).map((item) => (
              <div key={`${item.type}-${item.name}`} className="col-span-4 grid min-h-12 grid-cols-subgrid items-center border-b border-hairline text-[15px]">
                <span className="flex flex-col items-center">
                  <button type="button" aria-label={`Move ${item.name} up`} className="flex size-6 items-center justify-center text-ink-3 disabled:opacity-30" disabled={!online || item.sortOrder === 0} onClick={() => void moveCategory(item, -1)}><ArrowUp size={14} /></button>
                  <button type="button" aria-label={`Move ${item.name} down`} disabled={!online} className="flex size-6 items-center justify-center text-ink-3" onClick={() => void moveCategory(item, 1)}><ArrowDown size={14} /></button>
                </span>
                <span className="size-3 rounded-[3px]" style={{ background: `var(--color-${item.colorToken})` }} />
                <input aria-label={`${item.name} category name`} className="min-w-0 bg-transparent py-2" defaultValue={item.name} disabled={!online} onBlur={(event) => event.currentTarget.value !== item.name && void updateCategory(item, { name: event.currentTarget.value })} />
                <select aria-label={`${item.name} category colour`} className="field h-9 min-h-9 min-w-0 py-0 pl-2 pr-1 text-xs" value={item.colorToken} disabled={!online} onChange={(event) => void updateCategory(item, { colorToken: event.currentTarget.value })}>
                  {categoryColors.map((color) => <option key={color} value={color}>{color.replace("cat-", "")}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_100px_44px] gap-2">
            <label className="sr-only" htmlFor="new-category-name">New category name</label>
            <input id="new-category-name" className="field" value={categoryDraft.name} disabled={!online} onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.currentTarget.value })} placeholder="New category" maxLength={40} />
            <select aria-label="New category colour" className="field min-w-0 px-2" value={categoryDraft.colorToken} disabled={!online} onChange={(event) => setCategoryDraft({ ...categoryDraft, colorToken: event.currentTarget.value })}>{categoryColors.map((color) => <option key={color} value={color}>{color.replace("cat-", "")}</option>)}</select>
            <Button aria-label="Add category" className="px-0" disabled={!online || !categoryDraft.name.trim()} onClick={() => void addCategory()}><Plus size={18} /></Button>
          </div>
        </section>

        <section aria-labelledby="settings-rules">
          <SectionHead id="settings-rules" title={`Merchant rules · ${data.rules.length}`} action={<span className="text-sm text-ink-3">{rules.length} shown</span>} />
          <label htmlFor="rule-search" className="sr-only">Search rules</label>
          <input id="rule-search" className="field mt-3" placeholder="Search rules" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
          <div>
            {rules.map((rule) => (
              <div key={rule.id} className="grid min-h-[60px] grid-cols-[minmax(0,1fr)_44px_44px] items-center gap-1 border-b border-hairline">
                {ruleEdit === rule.id ? <RuleEditor rule={rule} categories={data.categories.map((x) => x.name)} onCancel={() => setRuleEdit(null)} onSave={(values) => void editMerchantRule(rule, values)} /> : (
                  <span className="flex min-w-0 flex-col gap-0.5 py-2">
                    <span className="truncate font-mono text-[13px] text-[#3E4352]">{rule.match}</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-sm"><span aria-hidden className="text-ink-3">→</span><strong className="truncate font-semibold">{rule.displayMerchant}</strong><span className="size-2 shrink-0 rounded-sm" style={{ background: `var(--color-cat-${rule.category.toLowerCase().replaceAll(/[^a-z-]/g, "")})` }} /><span className="truncate">{rule.category}</span></span>
                  </span>
                )}
                <button type="button" aria-label={`Edit rule for ${rule.displayMerchant}`} disabled={!online} className="flex size-11 items-center justify-center text-brand" onClick={() => setRuleEdit(ruleEdit === rule.id ? null : rule.id)}><Pencil size={18} /></button>
                <button type="button" aria-label={`Delete rule for ${rule.displayMerchant}`} disabled={!online} className="flex size-11 items-center justify-center text-over" onClick={() => void deleteMerchantRule(rule)}><Trash2 size={18} /></button>
              </div>
            ))}
          </div>
          {rules.length === 0 && <p className="py-5 text-sm text-ink-3">No matching rules.</p>}
          <p className="mt-2 mb-0 text-sm text-ink-2">All {data.rules.length} rules</p>
        </section>
      </div>
      {ios && <IosInstallSheet onClose={() => setIos(false)} />}
    </main>
  );
}

function RuleEditor({ rule, categories, onCancel, onSave }: { rule: Rule; categories: string[]; onCancel: () => void; onSave: (values: { match: string; displayMerchant: string; category: string }) => void }) {
  const [match, setMatch] = useState(rule.match);
  const [displayMerchant, setDisplayMerchant] = useState(rule.displayMerchant);
  const [category, setCategory] = useState(rule.category);
  return (
    <form className="col-span-3 grid gap-2 py-2" onSubmit={(event) => { event.preventDefault(); onSave({ match, displayMerchant, category }); }}>
      <label className="sr-only" htmlFor={`rule-match-${rule.id}`}>Merchant match</label>
      <input id={`rule-match-${rule.id}`} className="field font-mono text-sm" value={match} onChange={(event) => setMatch(event.currentTarget.value)} />
      <div className="grid grid-cols-2 gap-2">
        <label className="sr-only" htmlFor={`rule-name-${rule.id}`}>Display merchant</label>
        <input id={`rule-name-${rule.id}`} className="field min-w-0 text-sm" value={displayMerchant} onChange={(event) => setDisplayMerchant(event.currentTarget.value)} />
        <label className="sr-only" htmlFor={`rule-category-${rule.id}`}>Category</label>
        <select id={`rule-category-${rule.id}`} className="field min-w-0 px-2 text-sm" value={category} onChange={(event) => setCategory(event.currentTarget.value)}>{[...new Set(categories)].map((name) => <option key={name}>{name}</option>)}</select>
      </div>
      <div className="flex justify-end gap-2"><Button type="button" variant="text" onClick={onCancel}>Cancel</Button><Button type="submit" className="min-h-9">Save rule</Button></div>
    </form>
  );
}
