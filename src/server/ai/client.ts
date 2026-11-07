import { sql } from "drizzle-orm";
import { getDb, type Db } from "../db/client.ts";
import { meta } from "../db/schema.ts";
import { presets } from "../../lib/ai-models.ts";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export type AiConfig = { model: string; cap: number; used: number };

export async function aiConfig(db: Db = getDb()): Promise<AiConfig> {
  const rows = await db
    .select()
    .from(meta)
    .where(sql`${meta.key} IN ('openrouter_model', 'openrouter_daily_cap', ${`ai_calls_${today()}`})`);
  const value = new Map(rows.map((row) => [row.key, row.value]));
  const raw = value.get("openrouter_daily_cap");
  const cap = raw ? Number(raw) : 200; // "0" is a real cap: AI off.
  return {
    // A saved OpenRouter id (from before 9Router) would 403 on the restricted key, so only presets count.
    model: presets.find((m) => m.id === value.get("openrouter_model"))?.id ?? presets[0].id,
    cap: Number.isFinite(cap) && cap >= 0 ? cap : 200,
    used: Number(value.get(`ai_calls_${today()}`) ?? 0),
  };
}

export async function callAi(
  messages: unknown[],
  options: { db?: Db } = {},
): Promise<
  | { ok: true; content: string; model: string; tokensIn: number | null; tokensOut: number | null; costUsd: number | null }
  | { ok: false; reason: string }
> {
  // One switch for every outbound call: Ask, digest, receipts.
  if (process.env.KHARCHA_AI !== "on") return { ok: false, reason: "disabled" };
  // 9Router on the VPS (subscription models). Key is the restricted `kharcha` key.
  const base = process.env.AI_BASE_URL;
  const key = process.env.AI_API_KEY;
  if (!base || !key) return { ok: false, reason: "unavailable" };
  const db = options.db ?? getDb();
  const config = await aiConfig(db);
  if (config.used >= config.cap) return { ok: false, reason: "cap" };
  const callKey = `ai_calls_${today()}`;
  await db
    .insert(meta)
    .values({ key: callKey, value: "1" })
    .onConflictDoUpdate({ target: meta.key, set: { value: sql`CAST(${meta.value} AS INTEGER) + 1` } });
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      // token-saver off: otherwise 9Router adds its own instructions to the prompt.
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "x-9router-token-saver": "off" },
      body: JSON.stringify({ model: config.model, messages, stream: false, response_format: { type: "json_object" } }),
    });
    if (!response.ok) return { ok: false, reason: "unavailable" };
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    // Gemini through 9Router ignores response_format and may wrap JSON in a ```json fence.
    const content = payload.choices?.[0]?.message?.content?.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
    const count = (value: unknown) => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null);
    const tokensIn = count(payload.usage?.prompt_tokens);
    const tokensOut = count(payload.usage?.completion_tokens);
    // Subscription models: no per-call cost.
    return content ? { ok: true, content, model: config.model, tokensIn, tokensOut, costUsd: null } : { ok: false, reason: "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
