import { createFileRoute } from "@tanstack/react-router";
import { ingestAuth } from "../server/auth";
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
          return Response.json(await minipoll(getDb(), done), { headers: { "Cache-Control": "no-store" } });
        } catch {
          return Response.json({ error: "Store is unavailable." }, { status: 500, headers: { "Cache-Control": "no-store" } });
        }
      },
    },
  },
});
