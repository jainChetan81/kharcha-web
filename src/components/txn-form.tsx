import { useState } from "react";
import { addTransaction, saveEdit } from "../server/fns";
import { evalAmount, money, nowLocal } from "../lib/format";
import { countAdd } from "./pwa";
import { saveFailed, snack, useHoldsInput } from "./sheet";
import { useOnline } from "./sync-pill";
import { CategoryPicker, type PickerCategory } from "./category-picker";
import { Button, Field, Segmented, Switch } from "./ui";

type Value = { id?: number; merchant: string; amount: number; category: string; type: "expense" | "income" | "investment"; date: string; excluded?: boolean; accountLast4?: string | null; rawMerchant?: string | null };
export function TxnForm({ mode, initial, categories, onDone }: { mode: "add" | "edit"; initial?: Value; categories: PickerCategory[]; onDone: () => void }) {
  useHoldsInput(); const online = useOnline(); const [value, setValue] = useState<Value>(initial ?? { merchant: "", amount: 0, category: "Other", type: "expense", date: nowLocal() }); const [expr, setExpr] = useState(initial ? String(initial.amount) : ""); const amount = mode === "add" ? evalAmount(expr) ?? 0 : value.amount;
  const save = async () => { if (!amount || !value.merchant.trim()) return; try { if (mode === "add") { await addTransaction({ data: { type: value.type, amount, merchant: value.merchant, category: value.category, date: value.date, source: "manual", ...(value.accountLast4 ? { accountLast4: value.accountLast4 } : {}) } }); countAdd(); } else await saveEdit({ data: { ...value, id: value.id!, amount } }); snack(`Saved ${money(amount)} · ${value.category}`); onDone(); } catch { saveFailed(save); } };
  return <form className="flex flex-col gap-3.5" onSubmit={(e) => { e.preventDefault(); void save(); }}><Segmented label="Type" value={value.type} onChange={(type) => setValue({ ...value, type })} options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }, { value: "investment", label: "Investment" }]} />
    {mode === "add" ? <div className="border-b-[3px] border-double border-ink py-2 text-right"><span className="font-mono text-sm text-ink-3">{expr}</span><p className="m-0 font-serif text-5xl font-medium">{value.type === "income" && "+"}{money(amount)}</p></div> : <Field id="amount" label="Amount" inputMode="decimal" value={value.amount || ""} onChange={(e) => setValue({ ...value, amount: Number(e.target.value) })} />}
    <Field id="merchant" label="Merchant" value={value.merchant} onChange={(e) => setValue({ ...value, merchant: e.target.value })} hint={value.rawMerchant && value.rawMerchant !== value.merchant ? `SMS said “${value.rawMerchant}”. New rows from it use your name.` : undefined} />
    <CategoryPicker categories={categories} value={value.category} type={value.type === "income" ? "income" : "expense"} onChange={(category) => setValue({ ...value, category })} />
    <Field id="date" label="Date" type="datetime-local" value={value.date.replace(" ", "T")} onChange={(e) => setValue({ ...value, date: e.target.value.replace("T", " ") })} />
    {mode === "edit" && <div className="flex items-center justify-between border-y border-hairline py-3"><span className="text-[15px] text-ink-2">Not a spend</span><Switch label="Not a spend" checked={Boolean(value.excluded)} onChange={(excluded) => setValue({ ...value, excluded })} disabled={!online} /></div>}
    {mode === "add" && <Keypad value={expr} onChange={setExpr} />}
    <Button type="submit" disabled={!online || amount <= 0} className="min-h-[52px]">Save{mode === "edit" ? " changes" : ""}</Button></form>;
}
function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) { const keys = ["1", "2", "3", "back", "4", "5", "6", "+", "7", "8", "9", "-", ".", "0", "00"]; return <div className="grid grid-cols-4 gap-2">{keys.map((k) => <button type="button" key={k} aria-label={k === "back" ? "Delete" : k} onClick={() => onChange(k === "back" ? value.slice(0, -1) : value + k)} className="min-h-[52px] rounded-card bg-sunken text-xl">{k === "back" ? "⌫" : k}</button>)}</div>; }
