import crypto from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getDb, ingest, miniRowSchema } from "../server/db";

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

export const Route = createFileRoute("/api/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = auth(request);
        if (denied) return denied;
        const text = await request.text();
        if (text.length > MAX_BODY) return json({ error: "Batch too large." }, 413);
        let parsed: z.infer<typeof bodySchema>;
        try {
          parsed = bodySchema.parse(JSON.parse(text));
        } catch {
          return json({ error: "Batch failed validation." }, 400);
        }
        try {
          return json({ ok: true, count: ingest(getDb(), parsed.transactions) });
        } catch {
          return json({ error: "Store is unavailable." }, 500);
        }
      },
    },
  },
});
