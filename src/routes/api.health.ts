import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "../server/db/client";
import { health } from "../server/db/queries";

// Uptime probe: row count and last ingest time, no transaction data.
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return Response.json(await health(getDb()), { headers: { "Cache-Control": "no-store" } });
        } catch {
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
