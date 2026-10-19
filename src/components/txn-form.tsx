import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { evalAmount, money, nowLocal } from "../lib/format";
import { addTransaction, deleteTransaction, restoreTransaction, saveEdit } from "../server/fns";
import { CategoryPicker, type PickerCategory } from "./category-picker";
import { countAdd } from "./pwa";
import { saveFailed, snack, useHoldsInput } from "./sheet";
import { useOnline } from "./sync-pill";
import { Button, Field, Segmented, Switch } from "./ui";

type Value = { id?: number; merchant: string; amount: number; category: string; type: "expense" | "income" | "investment"; date: string; excluded?: boolean; accountLast4?: string | null; rawMerchant?: string | null };
// Amount lives in expr (accepts "250+210" via evalAmount); value.amount only seeds it.
const restOf = (v: Value) => JSON.stringify([v.merchant, v.category, v.type, v.date, v.excluded ?? false, v.accountLast4 ?? null]);
export function TxnForm({ mode, initial, categories, onDone, onCancel, onDeleted, onDirtyChange }: { mode: "add" | "edit"; initial?: Value; categories: PickerCategory[]; onDone: () => void; onCancel?: () => void; onDeleted?: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  useHoldsInput();
  const online = useOnline();
  const [value, setValue] = useState<Value>(initial ?? { merchant: "", amount: 0, category: "Other", type: "expense", date: nowLocal() });
  const [expr, setExpr] = useState(initial ? String(initial.amount) : "");
  const amount = evalAmount(expr) ?? 0;
  const showTotal = /[+-]/.test(expr) && amount > 0;
  const totalHint = showTotal ? `= ${money(amount)}` : undefined;
  const initialRest = useRef(restOf(initial ?? value));
  const initialExpr = useRef(initial ? String(initial.amount) : "");
  const dirty = restOf(value) !== initialRest.current || expr !== initialExpr.current;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  // Desktop dialog autofocuses Merchant; Radix traps focus inside the dialog.
  useEffect(() => {
    if (window.matchMedia("(min-width: 840px)").matches) document.getElementById("merchant-desk")?.focus();
  }, []);
  const cancel = onCancel ?? onDone;
  const set = <K extends keyof Value>(key: K, item: Value[K]) => setValue((old) => ({ ...old, [key]: item }));
  const save = async () => {
    if (!online || !amount || !value.merchant.trim()) return;
    try {
      if (mode === "add") {
        await addTransaction({ data: { type: value.type, amount, merchant: value.merchant, category: value.category, date: value.date, source: "manual", ...(value.excluded ? { excluded: true } : {}), ...(value.accountLast4 ? { accountLast4: value.accountLast4 } : {}) } });
        countAdd();
      }
      else await saveEdit({ data: { ...value, id: value.id!, amount } });
      snack(`Saved ${money(amount)} · ${value.category}`); onDone();
    } catch { saveFailed(save); }
  };
  const remove = async () => {
    if (!value.id || !online || !window.confirm("Delete this transaction?")) return;
    try { await deleteTransaction({ data: { id: value.id } }); snack("Transaction deleted.", { label: "Undo", onClick: () => void restoreTransaction({ data: { id: value.id! } }) }); (onDeleted ?? onDone)(); } catch { saveFailed(remove); }
  };
  const reason = !online ? "Offline — connect to save" : amount <= 0 ? "Enter an amount to save" : !value.merchant.trim() ? "Add a merchant to save" : null;
  const setDate = (v: string) => set("date", v.replace("T", " "));
  return <form className="flex min-h-0 flex-1 flex-col gap-3.5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <Segmented label="Type" value={value.type} onChange={(type) => set("type", type)} options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }, { value: "investment", label: "Investment" }]} />
    {mode === "add" && <div className="border-b-[3px] border-double border-ink px-1 pt-1 text-right desk:hidden"><span className="block min-h-5 font-mono text-sm text-ink-3">{expr}</span><p className="m-0 pb-1.5 font-serif text-5xl leading-none font-medium tracking-tight">{value.type === "income" && "+"}{money(amount)}</p></div>}
    {mode === "add" && <div className="desk:hidden"><Keypad value={expr} onChange={setExpr} /></div>}
    {mode === "add" && <div className="desk:hidden"><Field id="merchant" label="Merchant *" required value={value.merchant} onChange={(e) => set("merchant", e.target.value)} /></div>}
    {mode === "edit" && <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-2.5 desk:hidden"><Field id="merchant" label="Merchant *" value={value.merchant} onChange={(e) => set("merchant", e.target.value)} /><Field id="amount" label="Amount" inputMode="decimal" value={expr} onChange={(e) => setExpr(e.target.value)} hint={totalHint} className="[&_input]:font-serif [&_input]:text-right [&_input]:text-xl" /></div>}
    <div className="hidden desk:grid desk:grid-cols-[minmax(0,1fr)_200px] desk:gap-3"><Field id="merchant-desk" label="Merchant *" required value={value.merchant} onChange={(e) => set("merchant", e.target.value)} /><Field id="amount-desk" label="Amount" inputMode="decimal" placeholder="250+210" value={expr} onChange={(e) => setExpr(e.target.value)} hint={totalHint} className="[&_input]:text-right" /></div>
    {value.rawMerchant && value.rawMerchant !== value.merchant && <p className="-mt-2 m-0 text-[13px] text-ink-2">SMS said “{value.rawMerchant}”. New rows from it use your name.</p>}
    <section className="flex flex-col gap-2" aria-labelledby="category-label"><span id="category-label" className="text-[13px] text-ink-2">Category</span><CategoryPicker categories={categories} value={value.category} type={value.type === "income" ? "income" : "expense"} onChange={(category) => set("category", category)} /></section>
    <details className="rounded-card border border-hairline px-3 py-2 desk:hidden [&_summary]:cursor-pointer"><summary className="min-h-11 text-[15px] font-medium">More details</summary><div className={mode === "edit" ? "border-y border-hairline" : "flex flex-wrap items-end gap-2 pb-1"}><Field id="date" label="Date" type="datetime-local" value={value.date.replace(" ", "T")} onChange={(e) => setDate(e.target.value)} className={mode === "edit" ? "py-2.5" : "min-w-[190px] flex-1"} />{mode === "edit" ? <div className="flex min-h-[52px] items-center justify-between border-t border-hairline"><span className="text-[15px] text-ink-2">Not a spend</span><Switch label="Not a spend" checked={Boolean(value.excluded)} onChange={(excluded) => set("excluded", excluded)} disabled={!online} /></div> : <><Field id="card" label="Card" inputMode="numeric" maxLength={4} placeholder="Last four" value={value.accountLast4 ?? ""} onChange={(e) => set("accountLast4", e.target.value.replace(/\D/g, "").slice(0, 4) || null)} className="w-28" /><Link to="/paste" className="flex min-h-10 items-center px-3 text-[13px] font-medium text-brand">Paste SMS</Link></>}</div></details>
    <div className="hidden desk:flex desk:flex-col desk:gap-3"><div className={mode === "add" ? "grid grid-cols-2 gap-3" : ""}><Field id="date-desk" label="Date" type="datetime-local" value={value.date.replace(" ", "T")} onChange={(e) => setDate(e.target.value)} />{mode === "add" && <Field id="card-desk" label="Card" inputMode="numeric" maxLength={4} placeholder="Last four" value={value.accountLast4 ?? ""} onChange={(e) => set("accountLast4", e.target.value.replace(/\D/g, "").slice(0, 4) || null)} />}</div><div className="flex min-h-9 items-center justify-between"><span className="text-sm text-ink-2">Not a spend</span><Switch label="Not a spend" checked={Boolean(value.excluded)} onChange={(excluded) => set("excluded", excluded)} disabled={!online} /></div></div>
    <div className="sticky bottom-[calc(-16px-env(safe-area-inset-bottom))] -mx-4 mt-auto border-t border-hairline bg-card px-4 pt-2 pb-[env(safe-area-inset-bottom)] desk:hidden">{reason && mode === "add" && <p role="status" className="m-0 pb-1.5 text-center text-[13px] text-ink-3">{reason}</p>}{mode === "edit" && <div className="grid grid-cols-3 gap-2.5"><Button variant="danger" onClick={() => void remove()} disabled={!online}>Delete</Button><Button type="submit" disabled={reason !== null} className="col-span-2 min-h-[52px]">Save changes</Button></div>}{mode === "add" && <Button type="submit" disabled={reason !== null} className="w-full min-h-[52px]">Save</Button>}</div>
    <div className="hidden desk:block mt-auto border-t border-hairline pt-3.5">{reason && <p role="status" className="m-0 pb-2 text-[13px] text-ink-3">{reason}</p>}<div className="flex items-center gap-2.5">{mode === "edit" && <Button variant="danger" onClick={() => void remove()} disabled={!online}>Delete</Button>}<Button variant="outline" type="button" onClick={cancel} aria-keyshortcuts="Escape" className="ml-auto min-h-10">Cancel <Kbd>Esc</Kbd></Button><Button type="submit" disabled={reason !== null} aria-keyshortcuts="Enter" className="min-h-10">Save{mode === "edit" ? " changes" : ""} <Kbd>↵</Kbd></Button></div></div>
  </form>;
}
function Kbd({ children }: { children: string }) { return <kbd className="rounded border border-current px-1 font-mono text-[11px] opacity-70">{children}</kbd>; }
function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) { const keys = ["1", "2", "3", "back", "4", "5", "6", "+", "7", "8", "9", "-", ".", "0", "00"]; return <div className="grid grid-cols-4 gap-2">{keys.map((key) => <button type="button" key={key} aria-label={key === "back" ? "Delete" : key} onClick={() => onChange(key === "back" ? value.slice(0, -1) : value + key)} className="min-h-[52px] rounded-card bg-sunken text-xl font-medium">{key === "back" ? "⌫" : key}</button>)}</div>; }
