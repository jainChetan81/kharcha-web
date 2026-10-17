import { eq } from "drizzle-orm";
import { setMeta } from "../db/queries.ts";
import { meta } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { INR_PER_USD } from "../../lib/format.ts";
const dayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
type Price = { prompt: number; completion: number };
type Prices = Record<string, Price>;

function parsePrices(value: string | undefined): Prices | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const result: Prices = {};
    for (const [id, raw] of Object.entries(parsed)) {
      if (!raw || typeof raw !== "object") continue;
      const price = raw as Record<string, unknown>;
      const prompt = Number(price.prompt);
      const completion = Number(price.completion);
      if (id.length <= 200 && Number.isFinite(prompt) && prompt >= 0 && Number.isFinite(completion) && completion >= 0) result[id] = { prompt, completion };
    }
    return result;
  } catch { return null; }
}

async function fetchPrices(): Promise<Prices | null> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !Array.isArray((body as { data?: unknown }).data)) return null;
    const prices: Prices = {};
    for (const row of (body as { data: unknown[] }).data) {
      if (!row || typeof row !== "object") continue;
      const model = row as { id?: unknown; pricing?: { prompt?: unknown; completion?: unknown } };
      if (typeof model.id !== "string" || model.id.length > 200) continue;
      const prompt = Number(model.pricing?.prompt);
      const completion = Number(model.pricing?.completion);
      if (Number.isFinite(prompt) && prompt >= 0 && Number.isFinite(completion) && completion >= 0) prices[model.id] = { prompt, completion };
    }
    return Object.keys(prices).length ? prices : null;
  } catch { return null; }
}

async function dailyPrices(db: Db): Promise<Prices> {
  const key = `model_costs_${dayKey()}`;
  const cached = parsePrices((await db.select({ value: meta.value }).from(meta).where(eq(meta.key, key)).get())?.value);
  if (cached) return cached;
  const prices = await fetchPrices();
  if (prices) await setMeta(db, key, JSON.stringify(prices)).catch(() => {});
  return prices ?? {};
}

function rupees(price: Price | undefined, inputTokens: number, outputTokens: number): number | null {
  return price ? (price.prompt * inputTokens + price.completion * outputTokens) * INR_PER_USD : null;
}

function estimate(price: Price | undefined, inputTokens: number, outputTokens: number): string | null {
  const value = rupees(price, inputTokens, outputTokens);
  if (value === null) return null;
  return `about ₹${value < 0.01 ? "<0.01" : value.toFixed(2)} per call`;
}

/** USD cost for one call: OpenRouter's reported figure, else the cached daily prices. Null when neither is known. */
export async function callCostUsd(db: Db, model: string, tokensIn: number | null, tokensOut: number | null, reported: number | null): Promise<number | null> {
  if (reported !== null) return reported;
  if (tokensIn === null || tokensOut === null) return null;
  // Cache only: no extra outbound call on the AI path. Settings load fills today's cache.
  const cached = parsePrices((await db.select({ value: meta.value }).from(meta).where(eq(meta.key, `model_costs_${dayKey()}`)).get().catch(() => undefined))?.value); // cost is display-only; never fail the AI call over it
  const price = cached?.[model];
  return price ? price.prompt * tokensIn + price.completion * tokensOut : null;
}

/** Fetches only while AI is enabled. Failed pricing never affects AI calls or settings load. */
export async function modelCosts(db: Db, aiOn: boolean) {
  if (!aiOn) return { text: {} as Record<string, string | null> };
  const prices = await dailyPrices(db);
  const text: Record<string, string | null> = {};
  for (const [id, price] of Object.entries(prices)) {
    text[id] = estimate(price, 1500, 300);
  }
  return { text };
}
