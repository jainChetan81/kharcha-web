// After a deploy, an open tab asks for chunks the new release no longer serves.
// Reload once to pick up the new build; sessionStorage stops a reload loop.
const KEY = "kharcha.chunk-reloads";
const WINDOW_MS = 30 * 60_000;
const PER_PATH = 2;

type Log = Record<string, { at: number; chunks: string[] }>;

/** Pure rule: may this chunk failure on this path reload? Returns the updated log, or null to stop. */
export function nextReload(log: Log, path: string, chunk: string, now: number): Log | null {
  const entry = log[path] && now - log[path].at < WINDOW_MS ? log[path] : { at: now, chunks: [] };
  if (entry.chunks.includes(chunk) || entry.chunks.length >= PER_PATH) return null;
  return { ...log, [path]: { at: entry.at, chunks: [...entry.chunks, chunk] } };
}

function read(): Log {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
    // SAFETY: only this module writes the key; a bad value just resets the log.
    return parsed && typeof parsed === "object" ? (parsed as Log) : {};
  } catch {
    return {};
  }
}

/** `onLimit` runs when reloading is unsafe (typed input open) or already tried; show a manual reload there. */
export function watchStaleChunks(onLimit: () => void, editing: () => boolean): () => void {
  const handler = (event: Event) => {
    const chunk = (event as Event & { payload?: Error }).payload?.message ?? "unknown";
    if (editing()) return onLimit();
    const next = nextReload(read(), location.pathname, chunk, Date.now());
    if (!next) return onLimit();
    try {
      sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Without storage we can't count reloads, so don't risk a loop.
      return onLimit();
    }
    event.preventDefault();
    location.reload();
  };
  window.addEventListener("vite:preloadError", handler);
  return () => window.removeEventListener("vite:preloadError", handler);
}
