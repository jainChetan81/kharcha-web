import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { addTransaction, deleteTransaction, restoreTransaction, saveEdit } from "../server/fns";
import { evalAmount, money, nowLocal } from "../lib/format";
import { countAdd } from "./pwa";
import { saveFailed, snack, useHoldsInput } from "./sheet";
import { useOnline } from "./sync-pill";
import { CategoryPicker, type PickerCategory } from "./category-picker";
import { Button, Field, Segmented, Switch } from "./ui";

type Value = { id?: number; merchant: string; amount: number; category: string; type: "expense" | "income" | "investment"; date: string; excluded?: boolean; accountLast4?: string | null; rawMerchant?: string | null };
export function TxnForm({ mode, initial, categories, onDone, onDeleted }: { mode: "add" | "edit"; initial?: Value; categories: PickerCategory[]; onDone: () => void; onDeleted?: () => void }) {
  useHoldsInput();
  const online = useOnline();
  const [value, setValue] = useState<Value>(initial ?? { merchant: "", amount: 0, category: "Other", type: "expense", date: nowLocal() });
  const [expr, setExpr] = useState(initial ? String(initial.amount) : "");
  const amount = mode === "add" ? evalAmount(expr) ?? 0 : value.amount;
  const set = <K extends keyof Value>(key: K, item: Value[K]) => setValue((old) => ({ ...old, [key]: item }));
  const save = async () => {
    if (!online || !amount || !value.merchant.trim()) return;
    try {
      if (mode === "add") { await addTransaction({ data: { type: value.type, amount, merchant: value.merchant, category: value.category, date: value.date, source: "manual", ...(value.accountLast4 ? { accountLast4: value.accountLast4 } : {}) } }); countAdd(); }
      else await saveEdit({ data: { ...value, id: value.id!, amount } });
      snack(`Saved ${money(amount)} · ${value.category}`); onDone();
    } catch { saveFailed(save); }
  };
  const remove = async () => {
    if (!value.id || !online || !window.confirm("Delete this transaction?")) return;
    try { await deleteTransaction({ data: { id: value.id } }); snack("Transaction deleted.", { label: "Undo", onClick: () => void restoreTransaction({ data: { id: value.id! } }) }); (onDeleted ?? onDone)(); } catch { saveFailed(remove); }
  };
  return <form className="flex min-h-0 flex-1 flex-col gap-3.5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <Segmented label="Type" value={value.type} onChange={(type) => set("type", type)} options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }, { value: "investment", label: "Investment" }]} />
    {mode === "add" ? <div className="border-b-[3px] border-double border-ink px-1 pt-1 text-right"><span className="block min-h-5 font-mono text-sm text-ink-3">{expr}</span><p className="m-0 pb-1.5 font-serif text-5xl leading-none font-medium tracking-tight">{value.type === "income" && "+"}{money(amount)}</p></div> : <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-2.5"><Field id="merchant" label="Merchant" value={value.merchant} onChange={(e) => set("merchant", e.target.value)} /><Field id="amount" label="Amount" inputMode="decimal" value={value.amount || ""} onChange={(e) => set("amount", Number(e.target.value))} className="[&_input]:font-serif [&_input]:text-right [&_input]:text-xl" /></div>}
    {mode === "add" && <Field id="merchant" label="Merchant" value={value.merchant} onChange={(e) => set("merchant", e.target.value)} />}
    {value.rawMerchant && value.rawMerchant !== value.merchant && <p className="-mt-2 m-0 text-[13px] text-ink-2">SMS said “{value.rawMerchant}”. New rows from it use your name.</p>}
    <section className="flex flex-col gap-2" aria-labelledby="category-label"><span id="category-label" className="text-[13px] text-ink-2">Category</span><CategoryPicker categories={categories} value={value.category} type={value.type === "income" ? "income" : "expense"} onChange={(category) => set("category", category)} /></section>
    <div className={mode === "edit" ? "border-y border-hairline" : "flex flex-wrap items-end gap-2"}><Field id="date" label="Date" type="datetime-local" value={value.date.replace(" ", "T")} onChange={(e) => set("date", e.target.value.replace("T", " "))} className={mode === "edit" ? "py-2.5" : "min-w-[190px] flex-1"} />{mode === "edit" ? <div className="flex min-h-[52px] items-center justify-between border-t border-hairline"><span className="text-[15px] text-ink-2">Not a spend</span><Switch label="Not a spend" checked={Boolean(value.excluded)} onChange={(excluded) => set("excluded", excluded)} disabled={!online} /></div> : <><Field id="card" label="Card" inputMode="numeric" maxLength={4} placeholder="Last four" value={value.accountLast4 ?? ""} onChange={(e) => set("accountLast4", e.target.value.replace(/\D/g, "").slice(0, 4) || null)} className="w-28" /><Link to="/paste" className="flex min-h-10 items-center px-3 text-[13px] font-medium text-brand">Paste SMS</Link></>}</div>
    {mode === "add" && <Keypad value={expr} onChange={setExpr} />}
    <div className={mode === "edit" ? "mt-auto grid grid-cols-3 gap-2.5" : "mt-auto"}>{mode === "edit" && <Button variant="danger" onClick={() => void remove()} disabled={!online}>Delete</Button>}<Button type="submit" disabled={!online || amount <= 0 || !value.merchant.trim()} className={mode === "edit" ? "col-span-2 min-h-[52px]" : "w-full min-h-[52px]"}>Save{mode === "edit" ? " changes" : ""}</Button></div>
  </form>;
}
function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) { const keys = ["1", "2", "3", "back", "4", "5", "6", "+", "7", "8", "9", "-", ".", "0", "00"]; return <div className="grid grid-cols-4 gap-2">{keys.map((key) => <button type="button" key={key} aria-label={key === "back" ? "Delete" : key} onClick={() => onChange(key === "back" ? value.slice(0, -1) : value + key)} className="min-h-[52px] rounded-card bg-sunken text-xl font-medium">{key === "back" ? "⌫" : key}</button>)}</div>; }
