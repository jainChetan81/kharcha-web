import { eq } from "drizzle-orm";
import { setMeta } from "../db/queries.ts";
import { meta } from "../db/schema.ts";
import type { Db } from "../db/client.ts";

// ponytail: fixed INR conversion keeps estimates available without another unauthenticated data source; replace when a free daily FX source is reachable.
const INR_PER_USD = 84;
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

function estimate(price: Price | undefined, inputTokens: number, outputTokens: number): string | null {
  if (!price) return null;
  const rupees = (price.prompt * inputTokens + price.completion * outputTokens) * INR_PER_USD;
  return `about ₹${rupees < 0.01 ? "<0.01" : rupees.toFixed(2)} per call`;
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
