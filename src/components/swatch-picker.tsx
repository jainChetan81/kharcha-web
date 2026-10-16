// SwatchPicker (§5): category and income colours only. 7 columns of 44px targets, 28px swatches.
import { Check } from "lucide-react";
import { useId } from "react";
import { cn } from "../lib/cn";

export const swatchTokens = [
  "cat-food", "cat-shopping", "cat-transport", "cat-utilities", "cat-entertainment", "cat-home", "cat-health", "cat-sports", "cat-work", "cat-other",
  "cat-salary", "cat-refunds", "cat-interest", "cat-other-income",
] as const;

export function SwatchPicker({ value, onChange, label }: { value: string; onChange: (token: string) => void; label: string }) {
  const name = useId();
  return (
    <fieldset className="m-0 grid grid-cols-7 gap-0.5 rounded-card border border-rule bg-card p-2.5 shadow-[0_6px_16px_var(--color-shadow)]">
      <legend className="sr-only">{label}</legend>
      {swatchTokens.map((token) => {
        const on = token === value;
        const swatchLabel = token.replace("cat-", "").replaceAll("-", " ");
        return (
          <label key={token} className="flex h-11 w-full cursor-pointer items-center justify-center has-focus-visible:outline-2 has-focus-visible:outline-focus">
            <input type="radio" name={name} value={token} checked={on} onChange={() => onChange(token)} aria-label={swatchLabel} className="sr-only" />
            <span className={cn("flex size-7 items-center justify-center rounded-lg", on && "ring-2 ring-ink ring-offset-2 ring-offset-card")} style={{ background: `var(--color-${token})` }}>
              {on && <Check size={16} strokeWidth={2.75} className="text-on-cat" aria-hidden />}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
