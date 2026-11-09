import { createServerFn } from "@tanstack/react-start";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.ts";
import { askLog } from "../db/schema.ts";
import { aiConfig, aiEnabled } from "./client.ts";
import { askLedger } from "./ask.ts";
import { scopeSchema } from "../db/validators.ts";

export const ask = createServerFn({ method: "POST" })
  .validator(z.object({ question: z.string().trim().min(2).max(500), scope: scopeSchema.optional() }))
  .handler(({ data }) => askLedger(getDb(), data.question, data.scope));

// Stored by askLedger; parse it back so a bad row drops out instead of reaching the page untyped.
const storedAnswer = z.object({
  answer: z.string(),
  rows: z.array(z.object({ label: z.string(), value: z.number() })),
  transactionIds: z.array(z.number()),
  followUps: z.array(z.string()).optional(),
});
function answerOf(json: string | null) {
  if (!json) return null;
  try {
    return storedAnswer.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

export const getAskHistory = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb();
  const [history, config] = await Promise.all([db.select().from(askLog).orderBy(desc(askLog.createdAt)).limit(20), aiConfig(db)]);
  return {
    history: history.map((row) => ({ ...row, answer: answerOf(row.answerJson) })),
    usage: config,
    enabled: aiEnabled(),
  };
});
