import { createFileRoute } from "@tanstack/react-router";
import { ingestAuth, noStoreJson as json } from "../server/auth";
import { getDb } from "../server/db/client";
import { minipoll } from "../server/mini";

// The mini calls this every 30 s (bearer token). `?done=1` after it finishes a requested sync.
export const Route = createFileRoute("/api/mini/poll")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = ingestAuth(request);
        if (denied) return denied;
        try {
          const done = new URL(request.url).searchParams.get("done") === "1";
          return json(await minipoll(getDb(), done));
        } catch {
          return json({ error: "Store is unavailable." }, 500);
        }
      },
    },
  },
});
