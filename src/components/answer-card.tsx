import { Link } from "@tanstack/react-router";
import { Card } from "./ui";

export type Answer = { answer: string; rows: { label: string; value: number }[]; transactionIds: number[]; model?: string };
export function AnswerCard({ answer, figure }: { answer: Answer; figure: number }) {
  const total = answer.rows.reduce((sum, row) => sum + row.value, 0);
  const max = Math.max(...answer.rows.map((row) => row.value), 1);
  return <Card className="flex flex-col gap-3 p-4"><span className="label-caps text-ink-3">Fig. {figure} · Ledger answer</span><span className="font-serif text-[32px] leading-none">₹{Math.round(total).toLocaleString("en-IN")}</span><p className="m-0 text-[15px] leading-6 text-ink-2">{answer.answer}</p>{answer.rows.length > 1 && <div className="flex flex-col gap-2">{answer.rows.slice(0, 7).map((row) => <div key={row.label} className="grid grid-cols-[70px_1fr_74px] items-center gap-2 text-[13px]"><span className="truncate text-ink-2">{row.label}</span><span className="h-2 rounded-sm bg-sunken"><span className="block h-2 rounded-sm bg-brand" style={{ width: `${(row.value / max) * 100}%` }} /></span><span className="text-right font-medium">₹{Math.round(row.value).toLocaleString("en-IN")}</span></div>)}</div>}<Link to="/activity" search={{ ids: answer.transactionIds }} className="min-h-11 border-t border-hairline pt-3 text-sm font-medium text-brand">Based on {answer.transactionIds.length} transactions</Link><span className="text-xs text-ink-3">{answer.model ? `Model · ${answer.model}` : "Numbers from your ledger"}</span></Card>;
}
