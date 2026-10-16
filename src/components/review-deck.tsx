import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { money, shortDate } from "../lib/format";
import { Button, Switch } from "./ui";

export type ReviewTxn = { id: number; merchant: string; amount: number; date: string; category: string | null; suggestion: string; accountLast4: string | null };
export function ReviewDeck({ row, onConfirm, onSkip, onExclude }: { row: ReviewTxn; onConfirm: (rule: boolean) => void; onSkip: () => void; onExclude: () => void }) {
  const drag = (x: number) => { if (x > 100) onConfirm(false); if (x < -100) onSkip(); };
  return <motion.article drag="x" dragConstraints={{ left: 0, right: 0 }} onDragEnd={(_, info) => drag(info.offset.x)} className="rounded-card border border-rule bg-card p-5"><span className="label-caps text-ink-3">Needs review</span><div className="mt-2 flex justify-between border-b-[3px] border-double border-ink pb-4"><div><h2 className="m-0 font-serif text-3xl font-medium">{row.merchant}</h2><p className="mt-1 text-sm text-ink-3">{shortDate(row.date)} · {row.accountLast4 ? `••${row.accountLast4}` : "Manual"}</p></div><strong className="font-serif text-3xl">{money(row.amount)}</strong></div><p className="mt-5 text-sm text-ink-2">Suggested category</p><strong className="text-lg">{row.suggestion}</strong><div className="mt-4 flex items-center justify-between border-y border-hairline py-3 text-sm text-ink-2"><span>Always file {row.merchant} as {row.suggestion}</span><Switch label="Always file this merchant" checked={false} onChange={(v) => v && onConfirm(true)} /></div><div className="mt-5 grid grid-cols-2 gap-2"><Button onClick={() => onConfirm(false)}>Confirm · {row.suggestion}</Button><Button variant="outline" onClick={onSkip}>Skip</Button><Button variant="outline" onClick={onExclude}>Not a spend</Button><Link to="/txn/$id/edit" params={{ id: String(row.id) }} className="flex min-h-11 items-center justify-center text-brand">Edit</Link></div></motion.article>;
}
