import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { runDetectors, runDigest } from "../server/insights/jobs";
import { matchRecurring } from "../server/plan/jobs";
import { runPrices } from "../server/wealth/jobs";
import { fillMissing } from "../server/ai/embed";
import { getDb } from "../server/db/client";
import { ingestAuth, noStoreJson as json } from "../server/auth";

const name = z.enum(["prices", "recurring", "detectors", "digest", "embeddings"]);
const jobs: Record<z.infer<typeof name>, () => Promise<unknown>> = {
  prices: () => runPrices(),
  recurring: async () => (await matchRecurring([]), { ok: true }),
  detectors: () => runDetectors(),
  digest: () => runDigest(),
  embeddings: () => fillMissing(getDb()),
};

export const Route = createFileRoute("/api/jobs/$name")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const denied = ingestAuth(request);
        if (denied) return denied;
        const parsed = name.safeParse((params as { name: string }).name);
        if (!parsed.success) return json({ error: "Unknown job." }, 404);
        try {
          const result = await jobs[parsed.data]();
          return json({ ok: true, result });
        } catch (error) {
          console.error(`job ${parsed.data} failed`, error);
          return json({ error: "Job failed." }, 500);
        }
      },
    },
  },
});
