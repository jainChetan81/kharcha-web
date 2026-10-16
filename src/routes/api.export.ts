import { createFileRoute } from "@tanstack/react-router";
import { isNull } from "drizzle-orm";
import { getDb } from "../server/db/client";
import { transactions } from "../server/db/schema";

const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
export const Route = createFileRoute("/api/export")({
  server: {
    handlers: {
      GET: async () => {
        const rows = await getDb().select().from(transactions).where(isNull(transactions.deletedAt));
        const headers = ["date", "merchant", "category", "type", "amount", "card", "source"];
        const body = [headers.join(","), ...rows.map((x) => [x.date, x.merchant, x.category, x.type, x.amount, x.accountLast4, x.source].map(quote).join(","))].join("\n");
        return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=kharcha.csv", "Cache-Control": "no-store" } });
      },
    },
  },
});
