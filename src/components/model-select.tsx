import { Check, ChevronDown, Search } from "lucide-react";
import { useId, useState } from "react";
import { Sheet } from "./sheet";
import { cn } from "../lib/cn";
import { presets } from "../lib/ai-models";

export { presets };

export function ModelSelect({
  id,
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const searchId = useId();
  const selected = presets.find((model) => model.id === value);
  const filtered = presets.filter((model) =>
    `${model.name} ${model.provider} ${model.id}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const choose = (modelId: string) => {
    onChange(modelId);
    setOpen(false);
    setQuery("");
  };
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-meta text-ink-2">{label}</span>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="field flex min-h-11 items-center justify-between gap-3 text-left font-mono text-control"
        >
          <span className={cn("truncate", !value && "text-ink-2")}>
            {selected ? `${selected.name} · ${selected.provider}` : value || placeholder}
          </span>
          <ChevronDown size={18} aria-hidden />
        </button>
      </div>
      {open && (
        <Sheet
          title={label}
          onClose={() => {
            setOpen(false);
            setQuery("");
          }}
          className="gap-2"
        >
          <label htmlFor={searchId} className="flex min-h-11 items-center gap-2 rounded-control border border-field bg-input px-3">
            <Search size={18} className="text-ink-2" aria-hidden />
            <span className="sr-only">Search models</span>
            <input
              id={searchId}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              className="min-w-0 flex-1 bg-transparent text-entry outline-none"
              placeholder="Search models"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(false);
                if (event.key === "ArrowDown") (document.querySelector<HTMLElement>(`#${listId} button`) ?? event.currentTarget).focus();
              }}
            />
          </label>
          <div id={listId} className="m-0 max-h-[min(60dvh,520px)] overflow-y-auto">
            {filtered.map((model) => (
              <div key={model.id} className="border-b border-hairline">
                <button
                  type="button"
                  aria-current={value === model.id ? "true" : undefined}
                  className="grid min-h-16 w-full grid-cols-[minmax(0,1fr)_24px] items-center gap-2.5 text-left"
                  onClick={() => choose(model.id)}
                >
                  <span className="flex min-w-0 flex-col gap-0.5 py-2">
                    <span className="truncate text-body font-medium">{model.name}</span>
                    <span className="truncate text-meta text-ink-2">
                      {model.provider} · <span className="font-mono">{model.id}</span>
                    </span>
                  </span>
                  <span className="text-brand">
                    {value === model.id && (
                      <>
                        <Check size={20} aria-hidden="true" />
                        <span className="sr-only">Selected</span>
                      </>
                    )}
                  </span>
                </button>
              </div>
            ))}
            {!filtered.length && <p className="m-0 py-5 text-control text-ink-2">No preset matches.</p>}
          </div>
        </Sheet>
      )}
    </>
  );
}
