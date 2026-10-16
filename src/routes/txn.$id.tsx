import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Button, PageHeader, SectionHead } from "../components/ui";
import { LedgerRow } from "../components/ledger";
import { card, foreign, money, shortDate } from "../lib/format";
import { getDetail } from "../server/daily/fns";
import { deleteTransaction, flagTransaction, restoreTransaction } from "../server/fns";
import { saveFailed, snack } from "../components/sheet";
import { useOnline } from "../components/sync-pill";
export const Route = createFileRoute("/txn/$id")({ loader: ({ params }) => getDetail({ data: { id: Number(params.id) } }), component: Detail });
function Detail() {
  const data = Route.useLoaderData(); const navigate = useNavigate(); const router = useRouter(); const online = useOnline();
  if (!data) return <main className="p-5">Transaction not found.</main>;
  const { txn, more } = data;
  const remove = async () => {
    if (!online || !window.confirm("Delete this transaction?")) return;
    try { await deleteTransaction({ data: { id: txn.id } }); snack("Transaction deleted.", { label: "Undo", onClick: () => void restoreTransaction({ data: { id: txn.id } }).then(() => router.invalidate()).catch(() => snack("Couldn’t undo the delete.")) }); void navigate({ to: "/activity" }); } catch { saveFailed(remove); }
  };
  const toggleExcluded = async () => {
    if (!online) return;
    try { await flagTransaction({ data: { id: txn.id, excluded: !txn.excluded } }); await router.invalidate(); snack(txn.excluded ? "Transaction counts as spend." : "Transaction no longer counts as spend."); } catch { saveFailed(toggleExcluded); }
  };
  const total = more.reduce((sum, row) => sum + row.amount, 0);
  return <main><PageHeader back="/activity" title="" actions={<Link to="/txn/$id/edit" params={{ id: String(txn.id) }} className="flex min-h-11 items-center px-3 text-[15px] font-medium text-brand">Edit</Link>} /><div className="space-y-6 px-5 pb-8 tablet:mx-auto tablet:max-w-[640px]"><section className="flex flex-col gap-1.5 border-b-[3px] border-double border-ink pb-5"><span className="label-caps text-ink-3">{txn.type} · {txn.category ?? "Other"}</span><h1 className="m-0 font-serif text-3xl font-medium">{txn.merchant}</h1><strong className="font-serif text-5xl leading-none font-medium tracking-tight">{foreign(txn.currency, txn.originalAmount, txn.amount)}</strong></section><dl className="m-0 pt-2">{[["Date", shortDate(txn.date)], ["Category", txn.category ?? "Other"], ["Card", card(txn.accountLast4)], ["Source", txn.source === "sms" ? "SMS via Mac mini" : txn.source], ["Parsed by", txn.parsedBy ?? "Manual"], ["Status", txn.needsReview ? "Needs review" : txn.excluded ? "Not a spend" : "Reviewed"]].map(([key, value]) => <div key={key} className="flex min-h-12 items-center justify-between gap-4 border-b border-hairline text-[15px]"><dt className="text-ink-2">{key}</dt><dd className="m-0 text-right font-medium">{value}</dd></div>)}</dl>{txn.rawText && <section className="flex flex-col gap-2"><h2 className="label-caps m-0 text-ink-3">Source SMS</h2><p className="m-0 rounded-lg bg-sunken p-3 font-mono text-[13px] leading-relaxed text-ink-2">{txn.rawText}</p>{txn.rawMerchant && txn.rawMerchant !== txn.merchant && <p className="m-0 text-[13px] text-ink-2">You renamed “{txn.rawMerchant}” to {txn.merchant}. New SMS rows keep your edit.</p>}</section>}<Link to="/txn/$id/receipt" params={{ id: String(txn.id) }} className="flex min-h-16 items-center gap-3 rounded-card border border-dashed border-field px-4 text-[15px] font-medium"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-brand" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>Add receipt or screenshots</Link><section><SectionHead title={`More from ${txn.merchant}`} action={more.length ? `${new Date(txn.date).getFullYear()} · ${money(total)}` : undefined} />{more.map((row) => <LedgerRow key={row.id} t={row} withDate />)}</section><div className="grid grid-cols-2 gap-2.5"><Button variant="outline" onClick={() => void toggleExcluded()} disabled={!online}>{txn.excluded ? "Count as spend" : "Not a spend"}</Button><Button variant="danger" onClick={() => void remove()} disabled={!online}>Delete</Button></div></div></main>;
}
