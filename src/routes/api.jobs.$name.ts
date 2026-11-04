import crypto from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { runDetectors, runDigest } from "../server/insights/jobs";
import { matchRecurring } from "../server/plan/jobs";
import { runPrices } from "../server/wealth/jobs";
import { fillMissing } from "../server/ai/embed";
import { getDb } from "../server/db/client";

const name = z.enum(["prices", "recurring", "detectors", "digest", "embeddings"]);
const jobs: Record<z.infer<typeof name>, () => Promise<unknown>> = {
  prices: () => runPrices(),
  recurring: async () => (await matchRecurring([]), { ok: true }),
  detectors: () => runDetectors(),
  digest: () => runDigest(),
  embeddings: () => fillMissing(getDb()),
};
const digest = (value: string) => crypto.createHash("sha256").update(value).digest();
const json = (value: unknown, status = 200) => Response.json(value, status === 200 ? { headers: { "Cache-Control": "no-store" } } : { status, headers: { "Cache-Control": "no-store" } });
function auth(request: Request): Response | undefined {
  const expected = process.env.INGEST_TOKEN;
  if (!expected || expected.length < 32) return json({ error: "Jobs are disabled on this server." }, 503);
  const given = request.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
  if (!given || !crypto.timingSafeEqual(digest(given), digest(expected))) return json({ error: "Wrong ingest token." }, 401);
}

export const Route = createFileRoute("/api/jobs/$name")({
  server: { handlers: { POST: async ({ request, params }) => {
    const denied = auth(request); if (denied) return denied;
    const parsed = name.safeParse((params as { name: string }).name); if (!parsed.success) return json({ error: "Unknown job." }, 404);
    try {
      const result = await jobs[parsed.data]();
      return json({ ok: true, result });
    } catch (error) { console.error(`job ${parsed.data} failed`, error); return json({ error: "Job failed." }, 500); }
  } } },
});
