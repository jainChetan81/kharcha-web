import { money } from "../../lib/format";

export function Waterfall({ values }: { values: { income: number; investments: number; spending: number; saved: number } }) {
  const rows = [["Income", values.income, "bg-earn"], ["SIPs", values.investments, "bg-brand"], ["Spending", values.spending, "bg-watch"], ["Saved", values.saved, "bg-brand-deep"]] as const; const max = Math.max(...rows.map((row) => Math.abs(row[1])), 1);
  return <figure role="img" aria-label={`Income ${money(values.income)}, spending ${money(values.spending)}, saved ${money(values.saved)}`} className="m-0 flex flex-col gap-3">{rows.map(([label, value, color]) => <div key={label} className="grid grid-cols-[76px_1fr] items-center gap-3"><span className="text-[13px] font-medium">{label}<small className="block text-xs font-normal text-ink-2">{money(value)}</small></span><span className="h-[18px] rounded-sm bg-sunken"><span className={`block h-[18px] rounded-sm ${color}`} style={{ width: `${(Math.abs(value) / max) * 100}%` }} /></span></div>)}</figure>;
}
