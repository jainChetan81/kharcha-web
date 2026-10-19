// Settings → Sync (§18). Sync now asks the mini via /api/mini/poll; the VPS can't call it.
import { useEffect, useState } from "react";
import { ago, time } from "../lib/format";
import { getSyncStatus, syncNow } from "../server/daily/sync";
import { saveFailed } from "./sheet";
import { SectionHead } from "./ui";
import { checkedLabel, useOnline, useSync } from "./sync-pill";

type Status = Awaited<ReturnType<typeof getSyncStatus>>;

export function SyncSection({ initial }: { initial?: Status }) {
  const { state } = useSync();
  const online = useOnline();
  const [status, setStatus] = useState<Status | null>(initial ?? null);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => void getSyncStatus().then((s) => alive && setStatus(s)).catch(() => {});
    load();
    // Poll faster while a request is open so "Synced" shows within seconds of the mini finishing.
    const timer = setInterval(load, status?.sync === "waiting" ? 5_000 : 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, [status?.sync]);

  const ask = async () => {
    try {
      await syncNow();
      setAsked(true);
      setStatus(await getSyncStatus());
      setTimeout(() => setAsked(false), 3_000);
    } catch { saveFailed(ask); }
  };

  const mini = !status?.seenAt ? { dot: "bg-ink-3", line: "Not seen yet" }
    : status.online ? { dot: "bg-earn", line: `Online · checked ${ago(status.seenAt)}` }
    : { dot: "bg-over", line: `Offline since ${time(new Date(status.seenAt))}` };
  const waiting = status?.sync === "waiting";
  const msg = !status ? null : waiting && !status.online && status.seenAt ? { text: "The mini is offline. Sync runs when it’s back.", tone: "text-watch-text font-medium" }
    : waiting ? { text: asked ? "Asked the mini to check for new SMS." : "Waiting for the mini. Usually under a minute.", tone: "text-ink-2" }
    : status.sync === "synced" && status.requestedAt && Date.now() - Date.parse(status.requestedAt) < 10 * 60_000
      ? { text: `Synced · ${status.syncNew} new ${status.syncNew === 1 ? "transaction" : "transactions"}`, tone: "text-earn font-semibold" }
    : null;

  return (
    <section aria-labelledby="settings-sync">
      <SectionHead id="settings-sync" title="Sync" />
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-hairline py-2">
        <span className="flex flex-col gap-0.5">
          <span className="text-[15px] font-medium">Mac mini</span>
          <span className="flex items-center gap-1.5 text-[13px] text-ink-2"><span aria-hidden className={`size-2 rounded-full ${mini.dot}`} />{mini.line}</span>
        </span>
      </div>
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-hairline">
        <span className="text-[15px]">Status</span>
        <span className="text-right text-sm text-ink-2">{status ? checkedLabel(status.seenAt, status.lastIngestAt) : "Loading"}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 py-3">
        <button type="button" onClick={() => void ask()} disabled={!online || waiting || state === "unknown"} aria-busy={waiting} className="inline-flex min-h-11 items-center gap-1.5 rounded-button border border-ink px-3.5 text-sm font-medium whitespace-nowrap text-ink">
          {waiting && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="animate-spin motion-reduce:animate-none"><circle cx="12" cy="12" r="9" stroke="var(--color-track)" strokeWidth="2.5" /><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>}
          {waiting ? (asked ? "Requested" : "Waiting") : "Sync now"}
        </button>
        <span role="status" className={`flex-[1_1_160px] text-[13px] ${msg?.tone ?? ""}`}>{msg?.text}</span>
      </div>
    </section>
  );
}
