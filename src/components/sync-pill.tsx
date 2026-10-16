// Sync pill (§9, States board). Every write control also reads `online`.
import { createContext, useContext, useEffect, useState } from "react";
import { ago } from "../lib/format";
import { cn } from "../lib/cn";
import { getLastIngestAt } from "../server/daily/fns";

type Health = { state: "synced" | "offline" | "unreachable" | "quiet" | "unknown"; lastIngestAt: string | null };
const QUIET_MS = 6 * 3600_000;

export function useHealth(): Health {
  const [h, setH] = useState<Health>({ state: "unknown", lastIngestAt: null });
  useEffect(() => {
    let alive = true;
    async function poll() {
      if (!navigator.onLine) return alive && setH((p) => ({ ...p, state: "offline" }));
      try {
        const j = await getLastIngestAt();
        const quiet = !j.lastIngestAt || Date.now() - Date.parse(j.lastIngestAt) > QUIET_MS;
        if (alive) setH({ state: quiet ? "quiet" : "synced", lastIngestAt: j.lastIngestAt });
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

const HealthContext = createContext<Health>({ state: "unknown", lastIngestAt: null });
export const HealthProvider = HealthContext.Provider;
const useSync = () => useContext(HealthContext);
/** False while offline or the server is unreachable; write controls disable on it (§9). */
export const useOnline = () => {
  const s = useSync().state;
  return s !== "offline" && s !== "unreachable";
};

export function SyncPill({ onInk, short }: { onInk?: boolean; short?: boolean }) {
  const { state, lastIngestAt } = useSync();
  if (state === "unknown") return null;
  const since = lastIngestAt ? ago(lastIngestAt) : "";
  const label =
    state === "offline" ? "Offline"
    : state === "unreachable" ? "Server unreachable"
    : state === "quiet" ? `Mini quiet · ${lastIngestAt ? since.replace(" ago", "") : "no push yet"}`
    : short ? `Synced ${since.replace(" min ago", "m").replace(" h ago", "h").replace(" d ago", "d")}` : `Synced ${since}`;
  const dot = state === "synced" ? (onInk ? "bg-on-ink-gain" : "bg-earn") : state === "quiet" ? "bg-watch" : "bg-ink-3";
  return (
    <span
      role="status"
      title={label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-chip px-2.5 py-[5px] text-xs whitespace-nowrap",
        onInk ? "bg-on-ink/12 text-[#C9CDD6]" : state === "quiet" ? "bg-watch-soft text-[#6E470C]" : state === "synced" ? "bg-sunken text-ink-2" : "bg-[#E2DFD6] text-[#3E4352]",
      )}
    >
      <span aria-hidden className={cn("size-[7px] rounded-full", dot)} />
      {label}
    </span>
  );
}
