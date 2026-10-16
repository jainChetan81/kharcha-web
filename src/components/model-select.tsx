import { Check, ChevronDown, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Sheet } from "./sheet";
import { cn } from "../lib/cn";

// ponytail: static cost estimates avoid live pricing requests; upgrade when daily OpenRouter pricing is available.
const presets = [
  { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash", provider: "Google", cost: "about ₹0.03" },
  { id: "openai/gpt-5-mini", name: "GPT-5 mini", provider: "OpenAI", cost: "about ₹0.05" },
  { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5", provider: "Anthropic", cost: "about ₹0.12" },
  { id: "deepseek/deepseek-v3.2", name: "DeepSeek V3.2", provider: "DeepSeek", cost: "about ₹0.01" },
  { id: "meta-llama/llama-4-maverick", name: "Llama 4 Maverick", provider: "Meta", cost: "about ₹0.02" },
] as const;

export function ModelSelect({ id, label, value, placeholder, disabled, onChange }: { id: string; label: string; value: string; placeholder: string; disabled?: boolean; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const searchId = useId();
  const selected = presets.find((model) => model.id === value);
  const filtered = useMemo(() => presets.filter((model) => `${model.name} ${model.provider} ${model.id}`.toLowerCase().includes(query.trim().toLowerCase())), [query]);
  const choose = (modelId: string) => { onChange(modelId); setOpen(false); setQuery(""); };
  const custom = query.trim();
  return <>
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] text-ink-2">{label}</span>
      <button id={id} type="button" role="combobox" aria-label={label} aria-expanded={open} aria-controls={listId} disabled={disabled} onClick={() => setOpen(true)} className="field flex min-h-11 items-center justify-between gap-3 text-left font-mono text-sm">
        <span className={cn("truncate", !value && "text-ink-3")}>{selected ? `${selected.name} · ${selected.provider}` : value || placeholder}</span><ChevronDown size={18} aria-hidden />
      </button>
    </div>
    {open && <Sheet title={label} onClose={() => { setOpen(false); setQuery(""); }} className="gap-2">
      <label htmlFor={searchId} className="flex min-h-11 items-center gap-2 rounded-button border border-field bg-input px-3">
        <Search size={18} className="text-ink-3" aria-hidden /><span className="sr-only">Search models</span>
        <input id={searchId} role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" className="min-w-0 flex-1 bg-transparent text-base outline-none" placeholder="Search models or model ID" value={query} onChange={(event) => setQuery(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); if (event.key === "ArrowDown") (document.querySelector<HTMLElement>(`#${listId} button`) ?? event.currentTarget).focus(); if (event.key === "Enter" && custom && filtered.length === 0) choose(custom); }} />
      </label>
      <div id={listId} className="m-0 max-h-[min(60dvh,520px)] overflow-y-auto">
        {filtered.map((model) => <div key={model.id} aria-current={value === model.id ? "true" : undefined} className="border-b border-hairline">
          <button type="button" className="grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto_24px] items-center gap-2.5 text-left" onClick={() => choose(model.id)}>
            <span className="flex min-w-0 flex-col gap-0.5"><span className="truncate text-[15px] font-medium">{model.name}</span><span className="truncate text-[13px] text-ink-3">{model.provider} · <span className="font-mono">{model.id}</span></span></span>
            <span className="text-xs text-ink-2">{model.cost}</span><span className="text-brand">{value === model.id && <Check size={20} aria-label="Selected" />}</span>
          </button>
        </div>)}
        {custom && !presets.some((model) => model.id === custom) && <div className="border-b border-hairline">
          <button type="button" className="flex min-h-16 w-full items-center gap-2 text-left" onClick={() => choose(custom)}><span className="min-w-0 flex-1 truncate text-sm">Use “{custom}”</span><Check size={20} className="text-brand" aria-hidden /></button>
        </div>}
        {!filtered.length && !custom && <p className="m-0 py-5 text-sm text-ink-2">No preset matches.</p>}
      </div>
    </Sheet>}
  </>;
}
