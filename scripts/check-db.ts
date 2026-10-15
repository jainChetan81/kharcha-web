// Self-check for ingest merge rules. Run: npm run check:db
import assert from "node:assert/strict";
import { add, edit, ingest, listTransactions, miniRowSchema, monthSummary, open, remove } from "../src/server/db.ts";

const db = open(":memory:");
const row = {
  id: 1, type: "expense" as const, amount: 250, merchant: "SWIGGY", merchantCanonical: "Swiggy",
  category: "Food", date: "2026-10-15 13:00", rawText: "Rs 250 spent at SWIGGY", senderId: "AXISBK",
  parsedBy: "regex", needsReview: 1, deletedAt: null,
};
ingest(db, [row, { ...row, id: 2, amount: 99, merchantCanonical: null, merchant: "OTP ghost" }]);
let list = listTransactions(db, { month: "2026-10", limit: 10 });
assert.equal(list.length, 2);
assert.equal(list.find((t) => t.amount === 250)?.merchant, "Swiggy", "canonical merchant preferred");

const swiggy = list.find((t) => t.amount === 250);
assert.ok(swiggy);
edit(db, { id: swiggy.id, merchant: "Swiggy Instamart", category: "Groceries", amount: 250, type: "expense" });
ingest(db, [{ ...row, category: "Food", amount: 999 }]);
list = listTransactions(db, { search: "Instamart", limit: 10 });
assert.equal(list[0]?.amount, 250, "re-push must not overwrite app edits");
assert.equal(list[0]?.needs_review, 0);

ingest(db, [{ ...row, id: 2, amount: 99, merchant: "OTP ghost", deletedAt: "2026-10-15 14:00" }]);
assert.equal(listTransactions(db, { search: "ghost", limit: 10 }).length, 0, "mini tombstone hides row");

add(db, { type: "income", amount: 1000, merchant: "Refund", category: "", date: "2026-10-14 09:00" });
const manual = listTransactions(db, { search: "Refund", limit: 1 })[0];
assert.ok(manual);
remove(db, manual.id);
assert.equal(listTransactions(db, { search: "Refund", limit: 10 }).length, 0, "manual delete");

const s = monthSummary(db, "2026-10");
assert.deepEqual(s.totals.map((t) => [t.type, t.total]), [["expense", 250]]);
assert.equal(s.categories[0]?.category, "Groceries");
remove(db, swiggy.id);
ingest(db, [row]);
assert.equal(listTransactions(db, { limit: 10 }).length, 0, "app delete survives re-push");
assert.ok(s.lastIngestAt);
assert.equal(miniRowSchema.parse({ ...row, date: "2026-04-01" }).date, "2026-04-01 00:00", "date-only rows normalise");
console.log("check-db: ok");
