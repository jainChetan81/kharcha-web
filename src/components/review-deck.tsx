import { Link } from "@tanstack/react-router";
import { m } from "motion/react";
import { useState } from "react";
import { card, money, shortDate } from "../lib/format";
import { Button, Chip } from "./ui";

export type ReviewTxn = {
  id: number;
  merchant: string;
  amount: number;
  date: string;
  category: string | null;
  suggestion: string;
  accountLast4: string | null;
  rawText?: string | null;
};

type Category = {
  name: string;
  colorToken: string;
  type: string;
};

type Duplicate = {
  id: number;
  merchant: string;
  amount: number;
};

export function ReviewDeck({
  row,
  categories,
  duplicates,
  disabled,
  onConfirm,
  onSkip,
  onExclude,
  onDuplicate,
}: {
  row: ReviewTxn;
  categories: Category[];
  duplicates: Duplicate[];
  disabled?: boolean;
  onConfirm: (category: string, rule: boolean) => void;
  onSkip: () => void;
  onExclude: () => void;
  onDuplicate: (duplicateOf: number) => void;
}) {
  const [category, setCategory] = useState(row.suggestion);
  const [rule, setRule] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  // Picked duplicate, or the first match when none was picked (or the pick left the list).
  const [picked, setDuplicateOf] = useState<number | null>(null);
  const duplicateOf = duplicates.some((item) => item.id === picked) ? picked : (duplicates[0]?.id ?? null);

  const confirm = () => onConfirm(category, rule);
  const dragEnd = (_: PointerEvent, info: { offset: { x: number } }) => {
    if (disabled) return;
    if (info.offset.x > 100) confirm();
    if (info.offset.x < -100) onSkip();
  };
  const expenseCategories = categories.filter((item) => item.type === "expense");

  return (
    <div className="flex min-h-[calc(100dvh-154px)] flex-col desk:hidden">
      <div className="relative mt-5 flex-1">
        <m.article
          drag={disabled ? false : "x"}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.16}
          onDragEnd={dragEnd}
          className="relative flex flex-col gap-4 rounded-panel border border-hairline bg-card p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="m-0 font-serif text-title leading-[1.15] font-medium">{row.merchant}</h2>
              <p className="mt-1 text-meta text-ink-2">
                {shortDate(row.date)} · {row.accountLast4 ? `Card ${card(row.accountLast4)}` : "Manual"}
              </p>
            </div>
            <strong className="shrink-0 font-serif text-page font-medium">{money(row.amount)}</strong>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex justify-between gap-3 text-meta text-ink-2">
              <span>Category</span>
              <span>{category === row.suggestion ? "Suggested" : "Changed"}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {expenseCategories.map((item) => (
                <Chip
                  key={item.name}
                  on={category === item.name}
                  dot={`var(--color-${item.colorToken})`}
                  disabled={disabled}
                  onClick={() => setCategory(item.name)}
                  className="min-h-11"
                >
                  {item.name}
                </Chip>
              ))}
            </div>
          </div>

          <label className="flex min-h-11 items-center gap-2.5 border-t border-hairline pt-1 text-control">
            <input
              type="checkbox"
              checked={rule}
              disabled={disabled}
              onChange={(event) => setRule(event.target.checked)}
              className="size-5 accent-brand"
            />
            <span>
              Always file <strong className="font-semibold">{row.merchant}</strong> as {category}
            </span>
          </label>

          {row.rawText && (
            <div className="border-t border-hairline pt-1">
              <button
                type="button"
                aria-expanded={smsOpen}
                onClick={() => setSmsOpen((open) => !open)}
                className="flex min-h-11 w-full items-center justify-between text-control font-medium text-brand"
              >
                <span>Source SMS</span>
                <span>{smsOpen ? "Hide" : "Show"}</span>
              </button>
              {smsOpen && (
                <p className="m-0 rounded-control bg-sunken p-3 font-mono text-meta leading-5 text-ink-2 break-words [overflow-wrap:anywhere]">
                  {row.rawText}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 border-t border-hairline pt-1">
            <Button variant="text" disabled={disabled} onClick={onExclude} className="min-w-0 px-0 text-ink">
              Not a spend
            </Button>
            {duplicateOpen ? (
              <select
                aria-label="Duplicate of"
                value={duplicateOf ?? ""}
                disabled={disabled || !duplicates.length}
                onChange={(event) => setDuplicateOf(Number(event.target.value))}
                className="min-w-0 rounded-control border border-field bg-card px-2 text-control text-ink"
              >
                {duplicates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.merchant} · {money(item.amount)}
                  </option>
                ))}
              </select>
            ) : (
              <Button
                variant="text"
                disabled={disabled || !duplicates.length}
                onClick={() => setDuplicateOpen(true)}
                className="min-w-0 px-0 text-ink"
              >
                Duplicate
              </Button>
            )}
            <Link
              to="/txn/$id/edit"
              params={{ id: String(row.id) }}
              className="inline-flex min-h-11 items-center justify-center text-control font-medium text-brand"
            >
              Edit
            </Link>
          </div>
          {duplicateOpen && (
            <Button
              variant="outline"
              disabled={disabled || duplicateOf === null}
              onClick={() => duplicateOf !== null && onDuplicate(duplicateOf)}
              className="-mt-2"
            >
              Mark duplicate
            </Button>
          )}
        </m.article>
      </div>

      <div className="flex flex-col gap-2.5 pt-4 pb-[max(28px,env(safe-area-inset-bottom))]">
        <span className="text-center text-caption text-ink-2">Swipe right to confirm · left to skip</span>
        <div className="grid grid-cols-3 gap-2.5">
          <Button variant="outline" disabled={disabled} onClick={onSkip} className="min-h-13 px-2 text-entry">
            Skip
          </Button>
          <Button disabled={disabled} onClick={confirm} className="col-span-2 min-h-13 px-3 text-entry">
            Confirm · {category}
          </Button>
        </div>
      </div>
    </div>
  );
}
