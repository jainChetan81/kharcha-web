import { eq, sql } from "drizzle-orm";
import { aiConfig } from "./client.ts";
import type { Db } from "../db/client.ts";
import { merchantVectors, transactions } from "../db/schema.ts";

// Local model through 9Router: text never leaves the VPS. One model per index; a change re-embeds every merchant.
const MODEL = "ollama-local/embeddinggemma:300m";
const DOC = "title: none | text: ";
const QUERY = "task: search result | query: ";

const DIMENSIONS = 768;

// Local and free, so embeddings do not count against the daily cap; cap 0 (AI off) still stops them.
async function embed(db: Db, texts: string[], timeoutMs: number): Promise<Float32Array[] | null> {
  const base = process.env.AI_BASE_URL;
  const key = process.env.AI_API_KEY;
  if (process.env.KHARCHA_AI !== "on" || !base || !key || !texts.length) return null;
  try {
    if ((await aiConfig(db)).cap === 0) return null;
    const response = await fetch(`${base}/embeddings`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, input: texts }),
    });
    if (!response.ok) return null;
    const data = ((await response.json()) as { data?: { embedding?: number[] }[] }).data;
    if (!data || data.length !== texts.length || data.some((d) => d.embedding?.length !== DIMENSIONS)) return null;
    return data.map((d) => Float32Array.from(d.embedding as number[]));
  } catch {
    return null;
  }
}

const toBlob = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Embeds merchants that have no vector yet. Runs after each write and as job `embeddings` (backfill). */
export async function fillMissing(db: Db): Promise<{ embedded: number; missing: number }> {
  const missing = await db
    .selectDistinct({ merchant: transactions.merchant })
    .from(transactions)
    .where(
      sql`${transactions.deletedAt} IS NULL AND ${transactions.merchant} NOT IN (SELECT merchant FROM merchant_vectors WHERE model = ${MODEL})`,
    );
  for (let i = 0; i < missing.length; i += 64) {
    const names = missing.slice(i, i + 64).map((m) => m.merchant);
    const vectors = await embed(
      db,
      names.map((name) => DOC + name),
      60_000,
    );
    if (!vectors) return { embedded: i, missing: missing.length };
    await db
      .insert(merchantVectors)
      .values(names.map((merchant, j) => ({ merchant, model: MODEL, vector: toBlob(vectors[j]) })))
      .onConflictDoUpdate({
        target: merchantVectors.merchant,
        set: { model: MODEL, vector: sql`excluded.vector`, createdAt: sql`(datetime('now'))` },
      });
  }
  return { embedded: missing.length, missing: missing.length };
}

// ponytail: scores from embeddinggemma on short merchant names sit low (0.3 to 0.7), so the cut is relative to the best hit.
// Tested on the live ledger 2026-11-04: "medicine" finds pharmacies, "cab ride" Uber. Re-tune when the model changes.
export function pickMerchants(scored: { merchant: string; score: number }[], floor = 0.3, window = 0.1, max = 10): string[] {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const top = sorted[0]?.score ?? 0;
  return sorted
    .filter((s) => s.score >= floor && s.score >= top - window)
    .slice(0, max)
    .map((s) => s.merchant);
}

// Activity loads the list and the summary at once; both ask for the same search. Share one lookup.
const recent = new Map<string, { at: number; result: Promise<string[]> }>();

/** Merchants whose name means the same as the search text. Empty when AI is off or 9Router fails: search falls back to text. */
export function merchantsByMeaning(db: Db, search: string): Promise<string[]> {
  const key = search.trim().toLowerCase();
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.result;
  const result = lookup(db, key).catch(() => null);
  recent.set(key, { at: Date.now(), result: result.then((r) => r ?? []) });
  if (recent.size > 50) recent.delete(recent.keys().next().value as string);
  // A failed lookup is not cached: the next search tries 9Router again.
  void result.then((r) => {
    if (r === null) recent.delete(key);
  });
  return result.then((r) => r ?? []);
}

async function lookup(db: Db, search: string): Promise<string[] | null> {
  const text = search.trim();
  if (text.length < 3 || /^[\d\s.,₹-]+$/.test(text)) return [];
  // Short timeout: a slow 9Router must not hold up plain text search.
  const [query] = (await embed(db, [QUERY + text], 4_000)) ?? [];
  if (!query) return null;
  const rows = await db
    .select({ merchant: merchantVectors.merchant, vector: merchantVectors.vector })
    .from(merchantVectors)
    .where(eq(merchantVectors.model, MODEL));
  return pickMerchants(rows.map((r) => ({ merchant: r.merchant, score: cosine(query, fromBlob(r.vector)) })));
}
