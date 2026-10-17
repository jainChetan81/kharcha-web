import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronRight, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import { Button, ErrorState, PageHeader, SectionHead, Segmented, Skeleton } from "../components/ui";
import { applyTheme, getTheme, type Theme } from "../lib/theme";
import { IosInstallSheet, isStandalone, promptInstall } from "../components/pwa";
import { saveFailed, Sheet, snack, useHoldsInput } from "../components/sheet";
import { useOnline } from "../components/sync-pill";
import {
  deleteCategory,
  getCategoryDeleteCounts,
  getSettings,
  removeRule,
  reorderCategories,
  restoreRule,
  saveCategory,
  saveSettings,
  updateRule,
} from "../server/daily/settings";
import type { Category } from "../server/db/schema";
import { ModelSelect, presets } from "../components/model-select";
import { SwatchPicker } from "../components/swatch-picker";
import { SyncSection } from "../components/sync-section";

export const Route = createFileRoute("/settings")({
  loader: () => getSettings(),
  pendingComponent: () => <Skeleton rows={7} />,
  errorComponent: ({ error }) => { const router = useRouter(); return <ErrorState text={error instanceof Error ? error.message : "Couldn't load settings."} retry={() => void router.invalidate()} />; },
  component: Settings,
});

type Rule = Awaited<ReturnType<typeof getSettings>>["rules"][number];

function Settings() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const online = useOnline();
  useHoldsInput();
  const [ios, setIos] = useState(false);
  // Client-only check; SSR renders the button, then this swaps in "Installed".
  const [installed, setInstalled] = useState(false);
  useEffect(() => setInstalled(isStandalone()), []);
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => setTheme(getTheme()), []);
  const [open, setOpen] = useState<"categories" | "rules" | null>(null);
  const [search, setSearch] = useState("");
  const [ruleEdit, setRuleEdit] = useState<number | null>(null);
  const [categoryDraft, setCategoryDraft] = useState({ name: "", type: "expense" as const, colorToken: "cat-other" });
  const [colorPicker, setColorPicker] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<(typeof data.categories)[number] | null>(null);
  const [deleteCounts, setDeleteCounts] = useState<{ transactions: number; budgets: number; rules: number } | null>(null);
  const { used, cap } = data.ai;

  const refresh = () => void router.invalidate();
  const save = async (
    key: "openrouter_model" | "openrouter_daily_cap",
    value: string,
  ) => {
    if (!online || value === (data.values[key] ?? "")) return;
    try {
      if (key === "openrouter_daily_cap") {
        await saveSettings({ data: { key, value: value as "50" | "100" | "200" | "500" } });
      } else {
        await saveSettings({ data: { key, value } });
      }
      snack("Saved settings.");
      refresh();
    } catch { saveFailed(() => void save(key, value)); }
  };
  const reorderGroup = async (groupType: "expense" | "income", nextGroup: (typeof data.categories)) => {
    if (!online) return;
    try {
      await reorderCategories({
        data: {
          items: nextGroup.map((item, sortOrder) => ({
            name: item.name,
            type: groupType,
            sortOrder,
          })),
        },
      });
      refresh();
    } catch { saveFailed(() => void reorderGroup(groupType, nextGroup)); }
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
  const deleteCategoryNow = async () => {
    const item = deleteTarget;
    if (!item || !online) return;
    try {
      await deleteCategory({ data: { name: item.name, type: item.type } });
      setDeleteTarget(null);
      snack(`Deleted ${item.name}; moved ${item.transactionCount} transactions to Other.`);
      refresh();
    } catch { saveFailed(() => void deleteCategoryNow()); }
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
        <SyncSection />

        <section aria-labelledby="settings-app">
          <SectionHead id="settings-app" title="App" />
          <div className="flex min-h-14 items-center justify-between border-b border-hairline">
            <span className="text-[15px] font-medium">Install app</span>
            {installed ? <span className="text-[13px] font-semibold text-earn">Installed</span> : <Button variant="outline" className="min-h-10 text-sm" onClick={() => void promptInstall().then((result) => {
              if (result === "ios") setIos(true);
              else if (result === "installed") setInstalled(true);
              else if (result === "unavailable") snack("Install is available from your browser menu.");
            })}>Install</Button>}
          </div>
          <div className="flex min-h-14 items-center justify-between gap-3 border-b border-hairline py-2">
            <span className="text-[15px] font-medium">Theme</span>
            <Segmented label="Theme" className="w-[220px]" value={theme} onChange={(t) => { setTheme(t); applyTheme(t); }} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} />
          </div>
          <div className="flex min-h-14 items-center justify-between border-b border-hairline">
            <span className="text-[15px] font-medium">Export CSV</span>
            <a href="/api/export" className="inline-flex min-h-10 items-center rounded-button border border-ink px-3.5 text-sm font-medium text-ink">Download</a>
          </div>
          <div className="flex min-h-14 items-center justify-between border-b border-hairline">
            <span className="text-[15px] font-medium">Sign out</span>
            <form method="post" action="/api/logout"><button type="submit" className="inline-flex min-h-10 items-center rounded-button border border-ink px-3.5 text-sm font-medium text-ink">Sign out</button></form>
          </div>
        </section>

        <section aria-labelledby="settings-ai">
          <SectionHead id="settings-ai" title="AI" />
          {!data.aiOn && <p className="mt-3 mb-0 rounded-card border border-dashed border-field bg-card px-3.5 py-3 text-sm leading-relaxed">AI is off. Ask, the weekly digest and receipt reading need the server switch.</p>}
          {data.aiOn && <div className="space-y-3 pt-3.5">
            <ModelSelect id="model" label="Model" value={data.values.openrouter_model ?? ""} placeholder={presets.find((m) => m.id === data.ai.model)?.name ?? data.ai.model} disabled={!online} costs={data.costs.text} onChange={(value) => void save("openrouter_model", value)} />
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] text-ink-2">Daily call cap</span>
                <span className="text-sm"><strong className="font-semibold">{used}</strong><span className="text-ink-3"> of {cap} used today</span></span>
              </div>
              <Segmented label="Daily call cap" className="w-full" options={[50, 100, 200, 500].map((n) => ({ value: String(n), label: String(n) }))} value={String(cap)} onChange={(value) => void save("openrouter_daily_cap", value)} />
            </div>
          </div>}
        </section>

        <section aria-labelledby="settings-data">
          <SectionHead id="settings-data" title="Data" />
          <IndexRow label="Categories" detail={String(data.categories.length)} onClick={() => setOpen("categories")} />
          <IndexRow label="Merchant rules" detail={String(data.rules.length)} onClick={() => setOpen("rules")} />
        </section>
      </div>
      {ios && <IosInstallSheet onClose={() => setIos(false)} />}
      {open === "categories" && <Sheet swipe={false} title="Categories" description="Every transaction gets one. Budgets and Insights add them up." onClose={() => setOpen(null)}>
        <div>
        {(["expense", "income"] as const).map((type) => {
          const group = data.categories.filter((x) => x.type === type).sort((a, b) => a.sortOrder - b.sortOrder);
          return <div key={type} className="mt-4">
            <h3 className="m-0 text-xs tracking-[0.08em] text-ink-3 uppercase">{type === "expense" ? "Spending" : "Income"}</h3>
            <Reorder.Group axis="y" values={group} onReorder={(next) => void reorderGroup(type, next)} aria-label={`${type === "expense" ? "Spending" : "Income"} categories`} className="m-0 list-none p-0">
              {group.map((item) => (
                <CategoryItem
                  key={item.name}
                  item={item}
                  online={online}
                  colorPickerOpen={colorPicker === item.name}
                  onToggleColorPicker={() => setColorPicker(colorPicker === item.name ? null : item.name)}
                  onColorChange={(token) => { setColorPicker(null); void updateCategory(item, { colorToken: token }); }}
                  onNameChange={(name) => void updateCategory(item, { name })}
                  onMove={(dir) => void moveCategory(item, dir)}
                  onDelete={() => { setDeleteTarget(item); setDeleteCounts(null); void getCategoryDeleteCounts({ data: { name: item.name, type: item.type } }).then(setDeleteCounts).catch(() => setDeleteCounts(null)); }}
                />
              ))}
            </Reorder.Group>
          </div>;
        })}
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_44px_44px] gap-2">
          <label className="sr-only" htmlFor="new-category-name">New category name</label>
          <input id="new-category-name" className="field" value={categoryDraft.name} disabled={!online} onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.currentTarget.value })} placeholder="New category" maxLength={40} />
          <span className="size-11 self-center rounded-[7px]" style={{ background: `var(--color-${categoryDraft.colorToken})` }} aria-hidden />
          <Button aria-label="Add category" className="px-0" disabled={!online || !categoryDraft.name.trim()} onClick={() => void addCategory()}><Plus size={18} /></Button>
        </div>
        {deleteTarget && <Sheet title={`Delete ${deleteTarget.name}?`} description={deleteCounts ? `Its ${deleteCounts.transactions} transaction${deleteCounts.transactions === 1 ? "" : "s"} move to Other.${deleteCounts.budgets && deleteCounts.rules ? ` Its budget and ${deleteCounts.rules} merchant rule${deleteCounts.rules === 1 ? "" : "s"} are removed.` : deleteCounts.budgets ? " Its budget is removed." : deleteCounts.rules ? ` Its ${deleteCounts.rules} merchant rule${deleteCounts.rules === 1 ? "" : "s"} ${deleteCounts.rules === 1 ? "is" : "are"} removed.` : ""}` : "Its transactions move to Other."} onClose={() => setDeleteTarget(null)}>
          <div className="grid grid-cols-2 gap-2.5 pt-1.5">
            <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => setDeleteTarget(null)}>Keep</Button>
            <Button variant="danger" className="min-h-11 rounded-xl bg-over text-on-over hover:bg-over hover:text-on-over" disabled={!deleteCounts} onClick={() => void deleteCategoryNow()}>Delete and move {deleteCounts?.transactions ?? deleteTarget.transactionCount}</Button>
          </div>
        </Sheet>}
        </div>
      </Sheet>}
      {open === "rules" && <Sheet swipe={false} title={`Merchant rules · ${data.rules.length}`} description={`${rules.length} shown`} onClose={() => { setOpen(null); setRuleEdit(null); }}>
        <div>
        <label htmlFor="rule-search" className="sr-only">Search rules</label>
        <input id="rule-search" className="field" placeholder="Search rules" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
        <div>
          {rules.map((rule) => (
            <div key={rule.id} className="grid min-h-[60px] grid-cols-[minmax(0,1fr)_44px_44px] items-center gap-1 border-b border-hairline">
              {ruleEdit === rule.id ? <RuleEditor rule={rule} categories={data.categories.map((x) => x.name)} onCancel={() => setRuleEdit(null)} onSave={(values) => void editMerchantRule(rule, values)} /> : (
                <span className="flex min-w-0 flex-col gap-0.5 py-2">
                  <span className="truncate font-mono text-[13px] text-ink-2">{rule.match}</span>
                  <span className="flex min-w-0 items-center gap-1.5 text-sm"><span aria-hidden className="text-ink-3">→</span><strong className="truncate font-semibold">{rule.displayMerchant}</strong><span className="size-2 shrink-0 rounded-sm" style={{ background: `var(--color-cat-${rule.category.toLowerCase().replaceAll(/[^a-z-]/g, "")})` }} /><span className="truncate">{rule.category}</span></span>
                </span>
              )}
              <button type="button" aria-label={`Edit rule for ${rule.displayMerchant}`} disabled={!online} className="flex size-11 items-center justify-center text-brand" onClick={() => setRuleEdit(ruleEdit === rule.id ? null : rule.id)}><Pencil size={18} /></button>
              <button type="button" aria-label={`Delete rule for ${rule.displayMerchant}`} disabled={!online} className="flex size-11 items-center justify-center text-over" onClick={() => void deleteMerchantRule(rule)}><Trash2 size={18} /></button>
            </div>
          ))}
        </div>
        {rules.length === 0 && <p className="py-5 text-sm text-ink-3">No matching rules.</p>}
        </div>
      </Sheet>}
    </main>
  );
}

function IndexRow({ label, detail, onClick }: { label: string; detail: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-2 border-b border-hairline text-left">
    <span className="flex-1 text-[15px] font-medium">{label}</span>
    <span className="text-sm text-ink-3">{detail}</span>
    <ChevronRight size={18} className="text-ink-3" aria-hidden />
  </button>;
}

function CategoryItem({
  item, online, colorPickerOpen, onToggleColorPicker, onColorChange, onNameChange, onMove, onDelete,
}: {
  item: Awaited<ReturnType<typeof getSettings>>["categories"][number];
  online: boolean;
  colorPickerOpen: boolean;
  onToggleColorPicker: () => void;
  onColorChange: (token: string) => void;
  onNameChange: (name: string) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const controls = useDragControls();
  const isOther = item.name === "Other";
  return <Reorder.Item value={item} dragListener={false} dragControls={controls} className="border-b border-hairline bg-card">
    <div className="flex min-h-14 items-center gap-1">
      <button type="button" aria-label={`Reorder ${item.name}`} className="flex size-11 cursor-grab items-center justify-center text-ink-3" disabled={!online} onPointerDown={(event) => controls.start(event)} onKeyDown={(event) => { if (event.key === "ArrowUp") { event.preventDefault(); onMove(-1); } if (event.key === "ArrowDown") { event.preventDefault(); onMove(1); } }}><GripVertical size={18} /></button>
      <button type="button" aria-label={`Colour for ${item.name}`} aria-expanded={colorPickerOpen} disabled={!online} onClick={onToggleColorPicker} className="flex size-11 shrink-0 items-center justify-center">
        <span className="size-6 rounded-[7px]" style={{ background: `var(--color-${item.colorToken})` }} />
      </button>
      <input aria-label={`${item.name} category name`} className="min-w-0 flex-1 border-0 border-b border-dashed border-field bg-transparent py-2 text-[15px] font-medium outline-none focus-visible:outline-2 focus-visible:outline-focus" defaultValue={item.name} disabled={!online} onBlur={(event) => event.currentTarget.value !== item.name && onNameChange(event.currentTarget.value)} />
      <span className="shrink-0 text-xs text-ink-3">{item.transactionCount} transactions</span>
      {!isOther && <button type="button" aria-label={`Delete ${item.name}`} disabled={!online} className="flex size-11 shrink-0 items-center justify-center text-ink-3" onClick={onDelete}><Trash2 size={18} /></button>}
    </div>
    {colorPickerOpen && <div className="mb-3 ml-[88px] max-w-[300px]"><SwatchPicker label={`Colours for ${item.name}`} value={item.colorToken} onChange={onColorChange} /></div>}
  </Reorder.Item>;
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
