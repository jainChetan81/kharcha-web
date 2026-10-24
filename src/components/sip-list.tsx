import { dayMonth, money } from "../lib/format";

type Sip = { id: number; name: string; amount: number; day: number; nextDate: string | null; note: string | null; observedOn: string };
// Planned mandates from the broker, not buys: a date here does not mean the debit happened.
export function SipList({ sips, named = true }: { sips: Sip[]; named?: boolean }) {
  if (!sips.length) return null;
  const total = sips.reduce((sum, row) => sum + row.amount, 0);
  return <section className="mx-5 mt-6 desk:mx-0"><div className="flex items-baseline justify-between border-b border-ink pb-2"><h2 className="m-0 font-serif text-lg">SIPs</h2><span className="text-sm text-ink-2">{money(total)} a month</span></div>{sips.map((row) => <div key={row.id} className="flex min-h-14 items-center justify-between gap-3 border-b border-hairline py-2"><span className="min-w-0 flex-1"><b className="block truncate text-[15px]">{named ? row.name : `Day ${row.day}`}</b><small className="block truncate text-ink-3">{named ? `Day ${row.day} · ` : ""}{row.nextDate ? `Next ${dayMonth(row.nextDate)}` : "No date listed"}{row.note ? ` · ${row.note}` : ""}</small></span><b className="shrink-0">{money(row.amount)}</b></div>)}<p className="mt-2 mb-0 text-[13px] text-ink-3">Mandates as seen {dayMonth(sips[0]!.observedOn)}. Planned dates, not confirmed debits.</p></section>;
}
