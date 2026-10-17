import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Chip, Field, PageHeader, SectionHead, StatusTag } from "../components/ui";
import { LedgerRow } from "../components/ledger";
import { saveFailed, Sheet, snack } from "../components/sheet";
import { useOnline } from "../components/sync-pill";
import { card, foreign, money, shortDate } from "../lib/format";
import {
  cancelReimbursement,
  getClaimDetails,
  linkCredit,
  markFullyPaid,
  markReimbursable,
  recentCounterparties,
  suggestCredits,
  undoCancelReimbursement,
  unlinkCredit,
} from "../server/daily/reimburse";
import { getDetail, removeSplit } from "../server/daily/fns";
import { deleteTransaction, flagTransaction, restoreTransaction } from "../server/fns";

export const Route = createFileRoute("/txn/$id")({
  loader: async ({ params }) => {
    const id = Number(params.id);
    const [detail, recent] = await Promise.all([
      getDetail({ data: { id } }),
      recentCounterparties(),
    ]);
    const claim = detail ? await getClaimDetails({ data: { id } }) : null;
    const suggestions = claim && claim.claim.status !== "cancelled"
      ? await suggestCredits({ data: { id: claim.claim.id } })
      : [];
    return { detail, claim, recent, suggestions };
  },
  component: Detail,
});

function Detail() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const online = useOnline();
  const [markOpen, setMarkOpen] = useState(false);
  const [mode, setMode] = useState<"full" | "part" | "items">("full");
  const [partAmount, setPartAmount] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [note, setNote] = useState("");
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const detail = data.detail;

  if (!detail) return <main className="p-5">Transaction not found.</main>;
  const { txn, more } = detail;
  const claimInfo = data.claim;
  const claim = claimInfo?.claim;
  const total = more.reduce((sum, row) => sum + row.amount, 0);
  const splitTotal = detail.splits.reduce((sum, row) => sum + row.amount, 0);
  const splitStale = detail.splits.length > 0 && Math.abs(splitTotal - txn.amount) > 0.01;
  const hasReceipt = detail.items.length > 0 || detail.files.length > 0;
  const selectedTotal = detail.items.filter((item) => selectedItems.includes(item.id)).reduce((sum, item) => sum + item.amount, 0);
  const amountToClaim = mode === "full" ? txn.amount : mode === "part" ? Number(partAmount) || 0 : selectedTotal;
  const backTotal = claimInfo?.links.reduce((sum, link) => sum + link.amount, 0) ?? 0;

  const refresh = async (message?: string) => {
    await router.invalidate();
    if (message) snack(message);
  };
  const remove = async () => {
    if (!online || !window.confirm("Delete this transaction?")) return;
    try {
      await deleteTransaction({ data: { id: txn.id } });
      snack("Transaction deleted.", {
        label: "Undo",
        onClick: () => void restoreTransaction({ data: { id: txn.id } }).then(() => router.invalidate()).catch(() => snack("Couldn’t undo the delete.")),
      });
      void navigate({ to: "/activity" });
    } catch { saveFailed(remove); }
  };
  const toggleExcluded = async () => {
    if (!online) return;
    try {
      await flagTransaction({ data: { id: txn.id, excluded: !txn.excluded } });
      await refresh(txn.excluded ? "Transaction counts as spend." : "Transaction no longer counts as spend.");
    } catch { saveFailed(toggleExcluded); }
  };
  const groups = [...detail.items.reduce((map, item) => map.set(item.category, [...(map.get(item.category) ?? []), item]), new Map<string, typeof detail.items>())].map(([category, list]) => ({ category, items: list, amount: list.reduce((sum, item) => sum + item.amount, 0) }));
  const dropSplit = async () => {
    if (!online) return;
    try { await removeSplit({ data: { id: txn.id } }); await refresh("Split removed."); }
    catch { saveFailed(dropSplit); }
  };
  const submitClaim = async () => {
    if (!online || busy || !counterparty.trim()) return;
    setBusy(true);
    try {
      await markReimbursable({ data: {
        transactionId: txn.id,
        mode,
        ...(mode === "part" ? { amount: Number(partAmount) } : {}),
        ...(mode === "items" ? { itemIds: selectedItems } : {}),
        counterparty: counterparty.trim(),
        note: note.trim() || undefined,
      } });
      setMarkOpen(false);
      setMode("full"); setPartAmount(""); setCounterparty(""); setNote(""); setSelectedItems([]);
      await refresh("Reimbursement claim saved.");
    } catch { saveFailed(() => void submitClaim()); }
    finally { setBusy(false); }
  };
  const doLink = async (creditId: number) => {
    if (!online || !claim || busy) return;
    setBusy(true);
    try { await linkCredit({ data: { reimbursementId: claim.id, creditTransactionId: creditId } }); await refresh("Repayment linked."); }
    catch { saveFailed(() => void doLink(creditId)); }
    finally { setBusy(false); }
  };
  const doUnlink = async (creditId: number) => {
    if (!online || !claim || busy) return;
    setBusy(true);
    try { await unlinkCredit({ data: { reimbursementId: claim.id, creditTransactionId: creditId } }); await refresh("Repayment unlinked."); }
    catch { saveFailed(() => void doUnlink(creditId)); }
    finally { setBusy(false); }
  };
  const doCancel = async () => {
    if (!online || !claim || busy) return;
    setBusy(true);
    try { await cancelReimbursement({ data: { id: claim.id } }); await refresh("Claim cancelled."); }
    catch { saveFailed(() => void doCancel()); }
    finally { setBusy(false); }
  };
  const doUndoCancel = async () => {
    if (!online || !claim || busy) return;
    setBusy(true);
    try { await undoCancelReimbursement({ data: { id: claim.id } }); await refresh("Claim restored."); }
    catch { saveFailed(() => void doUndoCancel()); }
    finally { setBusy(false); }
  };
  const togglePaid = async () => {
    if (!online || !claim || busy) return;
    setBusy(true);
    try { await markFullyPaid({ data: { id: claim.id, paid: !claim.manualPaid } }); await refresh(claim.manualPaid ? "Claim returned to repayment tracking." : "Claim marked fully paid."); }
    catch { saveFailed(() => void togglePaid()); }
    finally { setBusy(false); }
  };

  const canClaim = txn.type === "expense" && !txn.excluded && !claim;
  const statusTone = claim?.status === "pending" ? "pending" : claim?.status === "partly" ? "partly" : claim?.status === "cancelled" ? "cancelled" : "reimbursed";
  const statusText = claim?.status === "pending" ? "Pending" : claim?.status === "partly" ? "Partly back" : claim?.status === "extra" ? "Extra back" : claim?.status === "cancelled" ? "Cancelled" : "Reimbursed";

  return <main>
    <PageHeader back="/activity" title="" actions={<Link to="/txn/$id/edit" params={{ id: String(txn.id) }} className="flex min-h-11 items-center px-3 text-[15px] font-medium text-brand">Edit</Link>} />
    <div className="space-y-6 px-5 pb-8 tablet:mx-auto tablet:max-w-[640px]">
      <section className="flex flex-col gap-1.5 border-b-[3px] border-double border-ink pb-5">
        <span className="label-caps text-ink-3">{txn.type === "income" ? "Income" : "Expense"} · {detail.splits.length ? `split in ${detail.splits.length}` : txn.category ?? "Other"}</span>
        <h1 className="m-0 font-serif text-3xl font-medium break-words">{txn.merchant}</h1>
        <strong className="font-serif text-5xl leading-none font-medium tracking-tight">{foreign(txn.currency, txn.originalAmount, txn.amount)}</strong>
      </section>
      <dl className="m-0 pt-2">{[["Date", shortDate(txn.date)], ["Category", txn.category ?? "Other"], ["Card", card(txn.accountLast4)], ["Source", txn.source === "sms" ? "SMS via Mac mini" : txn.source === "paste" ? "Pasted text" : "Added by hand"], ["Parsed by", txn.source === "sms" ? txn.parsedBy ?? "Regex" : txn.source === "paste" ? "Paste" : "Manual"], ["Status", txn.needsReview ? "Needs review" : txn.excluded ? "Not a spend" : "Reviewed"]].map(([key, value]) => <div key={key} className="flex min-h-12 items-center justify-between gap-4 border-b border-hairline text-[15px]"><dt className="text-ink-2">{key}</dt><dd className="m-0 text-right font-medium">{value}</dd></div>)}</dl>
      {txn.rawText && <details className="flex flex-col gap-2"><summary className="label-caps min-h-11 cursor-pointer text-ink-3">Source SMS</summary><p className="m-0 rounded-lg bg-sunken p-3 font-mono text-[13px] leading-relaxed text-ink-2">{txn.rawText}</p>{txn.rawMerchant && txn.rawMerchant !== txn.merchant && <p className="m-0 text-[13px] text-ink-2">You renamed “{txn.rawMerchant}” to {txn.merchant}. New SMS rows keep your edit.</p>}</details>}
      {hasReceipt ? <section className="space-y-3"><div className="flex items-baseline justify-between"><h2 className="label-caps m-0 text-ink-3">Receipt</h2><Link to="/txn/$id/receipt" params={{ id: String(txn.id) }} className="flex min-h-11 items-center px-3 text-[15px] font-medium text-brand">Edit</Link></div>{splitStale && <p role="alert" className="m-0 rounded-card bg-watch-soft p-3 text-sm text-ink">Amount changed since this split was saved. Re-check the split.</p>}{detail.splits.length > 0 && <><div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={detail.splits.map((row) => `${row.category} ${money(row.amount)}`).join(", ")}>{detail.splits.map((row) => <span key={row.category} style={{ flex: row.amount, background: `var(--color-${detail.categoryColors[row.category] ?? "cat-other"})` }} />)}</div><ul className="m-0 list-none space-y-1 p-0 text-sm">{detail.splits.map((row) => <li key={row.category} className="flex justify-between"><span>{row.category}</span><strong className="font-medium">{money(row.amount)}</strong></li>)}</ul><Button variant="outline" onClick={() => void dropSplit()} disabled={!online}>Remove split</Button></>}{detail.items.length > 0 && <div className="space-y-0">{groups.map((group) => <details key={group.category} className="border-b border-hairline" open={groups.length === 1}><summary className="grid min-h-13 cursor-pointer grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2.5 text-[15px]"><span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: `var(--color-${detail.categoryColors[group.category] ?? "cat-other"})` }} /><span className="font-medium">{group.category} <span className="text-[13px] font-normal text-ink-3">· {group.items.length} item{group.items.length === 1 ? "" : "s"}</span></span><strong className="font-semibold">{money(group.amount)}</strong></summary><ul className="m-0 list-none space-y-1 pt-1 pb-2.5 pl-5 text-sm text-ink-2">{group.items.map((item) => <li key={item.id} className="flex min-h-8 items-center justify-between"><span className="min-w-0 truncate">{item.name}{item.qty && item.qty !== 1 ? ` × ${item.qty}` : ""}</span><span>{money(item.amount)}</span></li>)}</ul></details>)}</div>}</section> : <Link to="/txn/$id/receipt" params={{ id: String(txn.id) }} className="flex min-h-16 items-center gap-3 rounded-card border border-dashed border-field px-4 text-[15px] font-medium"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-brand" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>Add receipt or screenshots</Link>}

      {canClaim && <Button variant="outline" className="w-full" onClick={() => setMarkOpen(true)}>Mark reimbursable</Button>}
      {claim && <section className="space-y-3 rounded-card border border-rule p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><SectionHead title="Reimbursement" /><StatusTag tone={statusTone}>{statusText}</StatusTag></div>
        <p className="m-0 text-sm text-ink-2">From <strong className="font-medium text-ink">{claim.counterparty}</strong>{claim.note ? ` · ${claim.note}` : ""}</p>
        <dl className="m-0 grid grid-cols-3 gap-2 rounded-card bg-sunken p-3 text-sm">
          <div><dt className="text-ink-3">Paid</dt><dd className="m-0 font-semibold">{money(txn.amount)}</dd></div>
          <div><dt className="text-ink-3">Back from {claim.counterparty}</dt><dd className="m-0 font-semibold text-earn">{money(backTotal)}</dd></div>
          <div><dt className="text-ink-3">Yours</dt><dd className="m-0 font-semibold">{money(Math.max(0, txn.amount - claim.amount))}</dd></div>
        </dl>
        {claimInfo.links.length > 0 && <div><h3 className="label-caps mb-1 text-ink-3">Repayments</h3><ul className="m-0 list-none divide-y divide-hairline p-0">{claimInfo.links.map((link) => <li key={link.creditId} className="flex min-h-12 items-center justify-between gap-2 text-sm"><span className="min-w-0 truncate">{link.merchant} · {shortDate(link.date)}</span><span className="flex shrink-0 items-center gap-2"><strong>{money(link.amount)}</strong><Button variant="text" className="min-h-11" disabled={!online || busy || claim.status === "cancelled"} onClick={() => void doUnlink(link.creditId)}>Unlink</Button></span></li>)}</ul></div>}
        {data.suggestions.length > 0 && claim.status !== "cancelled" && <div><h3 className="label-caps mb-1 text-ink-3">Might be the repayment</h3><ul className="m-0 list-none space-y-2 p-0">{data.suggestions.map((credit) => <li key={credit.id} className="flex min-h-14 items-center justify-between gap-2 rounded-card border border-dashed border-field px-3 text-sm"><span className="min-w-0 truncate">{credit.merchant} · {shortDate(credit.date)} · {money(credit.amount)}</span><Button variant="outline" disabled={!online || busy} onClick={() => void doLink(credit.id)}>Link</Button></li>)}</ul></div>}
        <div className="grid grid-cols-2 gap-2"><Button variant="outline" disabled={!online || busy || claim.status === "cancelled"} onClick={() => void togglePaid()}>{claim.manualPaid ? "Undo fully paid" : "Mark fully paid"}</Button><Button variant="danger" disabled={!online || busy || claim.status === "cancelled"} onClick={() => void doCancel()}>Cancel claim</Button></div>
        {claim.status === "cancelled" && <Button variant="outline" className="w-full" disabled={!online || busy} onClick={() => void doUndoCancel()}>Undo cancel</Button>}
        {!online && <p className="m-0 text-[13px] text-ink-3">Offline · reimbursement changes unavailable.</p>}
      </section>}
      <section><SectionHead title={`More from ${txn.merchant}`} action={more.length ? `${new Date(txn.date).getFullYear()} · ${money(total)}` : undefined} />{more.map((row) => <LedgerRow key={row.id} t={row} withDate />)}</section>
      <div className="grid grid-cols-2 gap-2.5"><Button variant="outline" onClick={() => void toggleExcluded()} disabled={!online}>{txn.excluded ? "Count as spend" : "Not a spend"}</Button><Button variant="danger" onClick={() => void remove()} disabled={!online}>Delete</Button></div>
    </div>

    {markOpen && <Sheet title="Mark reimbursable" description="Track your share without changing the paid transaction." onClose={() => setMarkOpen(false)}>
      <fieldset className="m-0 grid grid-cols-3 gap-2 border-0 p-0">
        <legend className="mb-1 text-[13px] text-ink-2">Amount to claim</legend>
        {([ ["full", "Full"], ["part", "Part"], ["items", "Items"] ] as const).map(([value, label]) => <span key={value} className="flex flex-col gap-0.5"><Chip on={mode === value} disabled={value === "items" && detail.items.length === 0} title={value === "items" && detail.items.length === 0 ? "Add receipt items first" : undefined} aria-describedby={value === "items" && detail.items.length === 0 ? "claim-items-why" : undefined} className="min-h-11 justify-center" onClick={() => setMode(value)}>{label}</Chip>{value === "items" && detail.items.length === 0 && <small id="claim-items-why" className="text-ink-3">Add receipt items first</small>}</span>)}
      </fieldset>
      {mode === "part" && <Field id="claim-amount" label="Amount to claim" inputMode="decimal" type="number" min="0.01" max={txn.amount} step="0.01" value={partAmount} onChange={(event) => setPartAmount(event.target.value)} hint={<button type="button" className="min-h-11 text-brand" onClick={() => setPartAmount((txn.amount / 2).toFixed(2))}>Half · {money(txn.amount / 2)}</button>} />}
      {mode === "items" && <fieldset className="m-0 max-h-40 space-y-1 overflow-y-auto border-0 p-0"><legend className="mb-1 text-[13px] text-ink-2">Items in your claim</legend>{detail.items.map((item) => <label key={item.id} className="flex min-h-11 items-center gap-3 border-b border-hairline text-sm"><input type="checkbox" checked={selectedItems.includes(item.id)} onChange={(event) => setSelectedItems((ids) => event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} /><span className="min-w-0 flex-1 truncate">{item.name} · {item.category}</span><strong>{money(item.amount)}</strong></label>)}</fieldset>}
      <Field id="claim-counterparty" label="From" list="recent-counterparties" value={counterparty} onChange={(event) => setCounterparty(event.target.value)} maxLength={120} autoComplete="off" />
      <datalist id="recent-counterparties">{data.recent.map((name) => <option key={name} value={name} />)}</datalist>
      {data.recent.length > 0 && <div className="flex flex-wrap gap-2">{data.recent.map((name) => <Chip key={name} on={counterparty === name} className="min-h-11" onClick={() => setCounterparty(name)}>{name}</Chip>)}</div>}
      <Field id="claim-note" label="Note (optional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
      <dl className="m-0 grid grid-cols-3 gap-2 rounded-card bg-sunken p-3 text-sm"><div><dt className="text-ink-3">Paid</dt><dd className="m-0 font-semibold">{money(txn.amount)}</dd></div><div><dt className="text-ink-3">Back from {counterparty.trim() || "them"}</dt><dd className="m-0 font-semibold text-earn">{money(amountToClaim)}</dd></div><div><dt className="text-ink-3">Yours</dt><dd className="m-0 font-semibold">{money(Math.max(0, txn.amount - amountToClaim))}</dd></div></dl>
      {!online && <p className="m-0 text-[13px] text-ink-3">Offline · save unavailable.</p>}
      <div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => setMarkOpen(false)}>Cancel</Button><Button disabled={!online || busy || !counterparty.trim() || amountToClaim <= 0 || amountToClaim > txn.amount || (mode === "items" && !selectedItems.length)} onClick={() => void submitClaim()}>Save claim</Button></div>
    </Sheet>}
  </main>;
}
