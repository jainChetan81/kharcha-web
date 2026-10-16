import crypto from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getDb } from "../server/db/client";
import { ingest, miniRowSchema } from "../server/db/queries";
import { transactions } from "../server/db/schema";
import { afterWrite } from "../server/jobs";
import { inArray } from "drizzle-orm";

const MAX_BODY = 2 * 1024 * 1024;
const bodySchema = z.object({ transactions: z.array(miniRowSchema).max(1000) });
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const digest = (value: string) =>
  crypto.createHash("sha256").update(value).digest();

/** 503 when INGEST_TOKEN unset/short (feature off), 401 on a wrong token. */
function auth(request: Request): Response | undefined {
  const expected = process.env.INGEST_TOKEN;
  if (!expected || expected.length < 32)
    return json({ error: "Ingest is disabled on this server." }, 503);
  const given = request.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
  if (!given || !crypto.timingSafeEqual(digest(given), digest(expected)))
    return json({ error: "Wrong ingest token." }, 401);
}

/** Read at most MAX_BODY bytes; undefined when the body is larger. */
async function readCapped(request: Request): Promise<string | undefined> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return undefined;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export const Route = createFileRoute("/api/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = auth(request);
        if (denied) return denied;
        const text = await readCapped(request);
        if (text === undefined) return json({ error: "Batch too large." }, 413);
        let parsed: z.infer<typeof bodySchema>;
        try {
          parsed = bodySchema.parse(JSON.parse(text));
        } catch {
          return json({ error: "Batch failed validation." }, 400);
        }
        try {
          const db = getDb();
          const n = await ingest(db, parsed.transactions);
          const miniIds = parsed.transactions.map((t) => t.id);
          const rows = miniIds.length
            ? await db.select({ id: transactions.id }).from(transactions).where(inArray(transactions.miniId, miniIds))
            : [];
          await afterWrite(rows.map((r) => r.id), db);
          return json({ ok: true, count: n });
        } catch {
          return json({ error: "Store is unavailable." }, 500);
        }
      },
    },
  },
});
