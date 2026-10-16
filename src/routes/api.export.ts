import { createFileRoute } from "@tanstack/react-router";
import { isNull } from "drizzle-orm";
import { isSignedIn } from "../server/auth";
import { getDb } from "../server/db/client";
import { transactions } from "../server/db/schema";

// Leading = + - @ tab or CR makes spreadsheets run the cell as a formula; a ' prefix keeps it text. Numbers stay numbers.
const quote = (value: unknown) => { const text = typeof value === "number" ? String(value) : String(value ?? "").replace(/^[=+\-@\t\r]/, "'$&"); return `"${text.replaceAll('"', '""')}"`; };
export const Route = createFileRoute("/api/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (process.env.KHARCHA_AUTH !== "off" && !isSignedIn(request))
          return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
        const rows = await getDb().select().from(transactions).where(isNull(transactions.deletedAt));
        const headers = ["date", "merchant", "category", "type", "amount", "card", "source"];
        const body = [headers.join(","), ...rows.map((x) => [x.date, x.merchant, x.category, x.type, x.amount, x.accountLast4, x.source].map(quote).join(","))].join("\n");
        return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=kharcha.csv", "Cache-Control": "no-store" } });
      },
    },
  },
});
