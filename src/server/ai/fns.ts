import { createServerFn } from "@tanstack/react-start";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.ts";
import { askLog } from "../db/schema.ts";
import { aiConfig } from "./client.ts";
import { askLedger } from "./ask.ts";

export const ask = createServerFn({ method: "POST" })
  .validator(z.object({ question: z.string().trim().min(2).max(500) }))
  .handler(({ data }) => askLedger(getDb(), data.question));

export const getAskHistory = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb(); const [history, config] = await Promise.all([db.select().from(askLog).orderBy(desc(askLog.createdAt)).limit(20), aiConfig(db)]);
  return { history: history.map((row) => ({ ...row, answer: row.answerJson ? JSON.parse(row.answerJson) : null })), usage: config, enabled: process.env.KHARCHA_AI === "on" };
});
