import { sql } from "drizzle-orm";
import { getDb, type Db } from "../db/client.ts";
import { meta } from "../db/schema.ts";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export type AiConfig = { model: string; cap: number; used: number };

export async function aiConfig(db: Db = getDb()): Promise<AiConfig> {
  const rows = await db.select().from(meta).where(sql`${meta.key} IN ('openrouter_model', 'openrouter_daily_cap', ${`ai_calls_${today()}`})`);
  const value = new Map(rows.map((row) => [row.key, row.value]));
  const raw = value.get("openrouter_daily_cap"); const cap = raw ? Number(raw) : 200; // "0" is a real cap: AI off.
  return {
    model: value.get("openrouter_model") || "google/gemini-3.5-flash",
    cap: Number.isFinite(cap) && cap >= 0 ? cap : 200,
    used: Number(value.get(`ai_calls_${today()}`) ?? 0),
  };
}

export async function callOpenRouter(
  messages: unknown[],
  options: { db?: Db } = {},
): Promise<{ ok: true; content: string; model: string; tokensIn: number | null; tokensOut: number | null; costUsd: number | null } | { ok: false; reason: string }> {
  // One switch for every outbound call: Ask, digest, receipts.
  if (process.env.KHARCHA_AI !== "on") return { ok: false, reason: "disabled" };
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, reason: "unavailable" };
  const db = options.db ?? getDb();
  const config = await aiConfig(db);
  if (config.used >= config.cap) return { ok: false, reason: "cap" };
  const callKey = `ai_calls_${today()}`;
  await db
    .insert(meta)
    .values({ key: callKey, value: "1" })
    .onConflictDoUpdate({ target: meta.key, set: { value: sql`CAST(${meta.value} AS INTEGER) + 1` } });
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model, messages, response_format: { type: "json_object" }, usage: { include: true } }),
    });
    if (!response.ok) return { ok: false, reason: "unavailable" };
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown } };
    const content = payload.choices?.[0]?.message?.content;
    const count = (value: unknown) => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null);
    const tokensIn = count(payload.usage?.prompt_tokens);
    const tokensOut = count(payload.usage?.completion_tokens);
    const reported = payload.usage?.cost;
    const costUsd = typeof reported === "number" && Number.isFinite(reported) && reported >= 0 ? reported : null;
    return content ? { ok: true, content, model: config.model, tokensIn, tokensOut, costUsd } : { ok: false, reason: "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

