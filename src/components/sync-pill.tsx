// Sync pill (§9, States board). Every write control also reads `online`.
import { createContext, useContext, useEffect, useState } from "react";
import { ago, time } from "../lib/format";
import { cn } from "../lib/cn";
import { getSyncStatus } from "../server/daily/sync";

type Health = { state: "synced" | "offline" | "unreachable" | "quiet" | "mini-offline" | "unknown"; lastIngestAt: string | null; seenAt: string | null };
const QUIET_MS = 6 * 3600_000;

export function useHealth(): Health {
  const [h, setH] = useState<Health>({ state: "unknown", lastIngestAt: null, seenAt: null });
  useEffect(() => {
    let alive = true;
    async function poll() {
      if (!navigator.onLine) return alive && setH((p) => ({ ...p, state: "offline" }));
      try {
        const j = await getSyncStatus();
        const quiet = !j.lastIngestAt || Date.now() - Date.parse(j.lastIngestAt) > QUIET_MS;
        // A mini that never polled (old build) falls back to the ingest-age reading.
        const state = j.seenAt && !j.online ? "mini-offline" : quiet ? "quiet" : "synced";
        if (alive) setH({ state, lastIngestAt: j.lastIngestAt, seenAt: j.seenAt });
      } catch {
        if (alive) setH((p) => ({ ...p, state: "unreachable" }));
      }
    }
    void poll();
    const t = setInterval(poll, 60_000);
    window.addEventListener("online", poll);
    window.addEventListener("offline", poll);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("online", poll);
      window.removeEventListener("offline", poll);
    };
  }, []);
  return h;
}

const HealthContext = createContext<Health>({ state: "unknown", lastIngestAt: null, seenAt: null });
export const HealthProvider = HealthContext.Provider;
export const useSync = () => useContext(HealthContext);
/** False while offline or the server is unreachable; write controls disable on it (§9). */
export const useOnline = () => {
  const s = useSync().state;
  return s !== "offline" && s !== "unreachable";
};

/** One wording everywhere: "Checked X · last new Y". Both halves reuse seenAt/lastIngestAt. */
export const checkedLabel = (seenAt: string | null, lastIngestAt: string | null, short = false) => {
  const checked = seenAt ? ago(seenAt) : null;
  const lastNew = lastIngestAt ? ago(lastIngestAt) : null;
  const squeeze = (text: string) => short ? text.replace(" min ago", "m").replace(" h ago", "h").replace(" d ago", "d") : text;
  const prefix = checked && Date.parse(seenAt!) > Date.now() - 60_000 ? "Checked just now" : checked ? `Checked ${squeeze(checked)}` : "Not checked yet";
  return `${prefix} · last new ${lastNew ? squeeze(lastNew) : "none"}`;
};

export function SyncPill({ onInk, short }: { onInk?: boolean; short?: boolean }) {
  const { state, lastIngestAt, seenAt } = useSync();
  if (state === "unknown") return null;
  const label =
    state === "offline" ? "Offline"
    : state === "unreachable" ? "Server unreachable"
    : state === "mini-offline" ? `Mini offline since ${seenAt ? time(new Date(seenAt)) : ""}`
    : checkedLabel(seenAt, lastIngestAt, short);
  const dot = state === "synced" ? (onInk ? "bg-on-ink-gain" : "bg-earn") : state === "quiet" ? "bg-watch" : state === "mini-offline" ? "bg-over" : "bg-ink-3";
  return (
    <span
      role="status"
      title={label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-chip px-2.5 py-[5px] text-xs whitespace-nowrap",
        onInk ? "bg-on-ink/12 text-on-ink-2" : state === "quiet" ? "bg-watch-soft text-watch-text" : state === "mini-offline" ? "bg-over-soft text-ink" : state === "synced" ? "bg-sunken text-ink-2" : "bg-sunken text-ink",
      )}
    >
      <span aria-hidden className={cn("size-[7px] rounded-full", dot)} />
      {label}
    </span>
  );
}
