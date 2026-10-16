import crypto from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { runDetectors, runDigest } from "../server/insights/jobs";
import { matchRecurring } from "../server/plan/jobs";
import { runPrices } from "../server/wealth/jobs";

const name = z.enum(["prices", "recurring", "detectors", "digest"]);
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
      const result = parsed.data === "prices" ? await runPrices() : parsed.data === "recurring" ? (await matchRecurring([]), { ok: true }) : parsed.data === "detectors" ? await runDetectors() : await runDigest();
      return json({ ok: true, result });
    } catch { return json({ error: "Job failed." }, 500); }
  } } },
});
