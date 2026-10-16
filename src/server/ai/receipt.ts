import { readFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.ts";
import { attachments, categories } from "../db/schema.ts";
import { callOpenRouter } from "./client.ts";

const output = z.object({ items: z.array(z.object({ name: z.string().min(1).max(200), qty: z.number().positive().nullable(), amount: z.number().nonnegative(), category: z.string().min(1).max(40) })).max(100), total: z.number().nonnegative().nullable() });

export async function readReceipt(attachmentIds: number[], txnId: number): Promise<{ ok: true; items: { name: string; qty: number | null; amount: number; category: string }[]; total: number | null } | { ok: false; reason: string }> {
  if (attachmentIds.length === 0 || attachmentIds.length > 5) return { ok: false, reason: "attachments" };
  const db = getDb();
  const rows = await db.select().from(attachments).where(and(eq(attachments.transactionId, txnId), inArray(attachments.id, attachmentIds)));
  if (rows.length !== attachmentIds.length || rows.some((row) => row.mime === "application/pdf")) return { ok: false, reason: "unsupported" };
  try {
    // ponytail: no image library installed for card/phone-region blur; add a local blur pass before vision input when one exists.
    const images = await Promise.all(rows.map(async (row) => ({ type: "image_url", image_url: { url: `data:${row.mime};base64,${(await readFile(row.path)).toString("base64")}` } })));
    const response = await callOpenRouter([{ role: "system", content: "Return JSON only: {items:[{name,qty,amount,category}],total}. Read receipt; categories must be supplied list." }, { role: "user", content: [{ type: "text", text: "Categories will be validated server-side. Extract visible item lines only." }, ...images] }], { db, vision: true, requireEnabled: true });
    if (!response.ok) return response;
    const parsed = output.safeParse(JSON.parse(response.content));
    if (!parsed.success) return { ok: false, reason: "invalid" };
    const known = new Set((await db.select({ name: categories.name }).from(categories)).map((category) => category.name));
    if (parsed.data.items.some((item) => !known.has(item.category))) return { ok: false, reason: "category" };
    return { ok: true, ...parsed.data };
  } catch { return { ok: false, reason: "unavailable" }; }
}
