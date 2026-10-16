import { createFileRoute } from "@tanstack/react-router";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { isSignedIn } from "../server/auth";
import { getDb } from "../server/db/client";
import { attachments, transactions } from "../server/db/schema";

const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const noStore = { "Cache-Control": "no-store" };

/** Serve one stored receipt by DB id. Client never supplies a filesystem path. */
export const Route = createFileRoute("/api/attachments/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (process.env.KHARCHA_AUTH !== "off" && !isSignedIn(request))
          return new Response("Unauthorized.", { status: 401, headers: noStore });
        const id = Number(params.id);
        if (!Number.isSafeInteger(id) || id < 1) return new Response("Bad id.", { status: 400, headers: noStore });

        const row = await getDb().select({ path: attachments.path, mime: attachments.mime, bytes: attachments.bytes }).from(attachments).innerJoin(transactions, eq(transactions.id, attachments.transactionId)).where(and(eq(attachments.id, id), isNull(transactions.deletedAt))).get();
        if (!row || !MIME_TYPES.has(row.mime)) return new Response("Not found.", { status: 404, headers: noStore });
        const root = path.resolve(process.env.STATE_DIRECTORY ?? ".data", "attachments") + path.sep;
        const filepath = path.resolve(row.path);
        if (!filepath.startsWith(root)) return new Response("Not found.", { status: 404, headers: noStore });

        try {
          const body = await readFile(filepath);
          if (body.byteLength !== row.bytes) return new Response("File is unavailable.", { status: 404, headers: noStore });
          return new Response(new Uint8Array(body), {
            headers: {
              "Content-Type": row.mime,
              "Content-Length": String(row.bytes),
              "Content-Disposition": "inline",
              "Content-Security-Policy": "default-src 'none'; sandbox",
              "X-Content-Type-Options": "nosniff",
              ...noStore,
            },
          });
        } catch {
          return new Response("File is unavailable.", { status: 404, headers: noStore });
        }
      },
    },
  },
});
