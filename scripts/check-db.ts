// Self-check for ingest merge rules and queries. Run: npm run check:db
import assert from "node:assert/strict";
import { openDb } from "../src/server/db/client.ts";
import {
  addTxn, editTxn, ingest, listTxns, miniRowSchema, monthSummary, removeTxn, setBudget,
} from "../src/server/db/queries.ts";

const db = openDb(":memory:");
const row = miniRowSchema.parse({
  id: 1, type: "expense", amount: 250, merchant: "SWIGGY", merchantCanonical: "Swiggy",
  category: "Food", date: "2026-10-15 13:00", rawText: "Rs 250 spent at SWIGGY", senderId: "AXISBK",
  parsedBy: "regex", needsReview: 1, deletedAt: null,
});
const ghost = { ...row, id: 2, amount: 99, merchantCanonical: null, merchant: "OTP ghost" };
await ingest(db, [row, ghost]);
let list = await listTxns(db, { month: "2026-10", limit: 10 });
assert.equal(list.length, 2);
assert.equal(list.find((t) => t.amount === 250)?.merchant, "Swiggy", "canonical merchant preferred");
assert.equal(list.find((t) => t.amount === 250)?.needsReview, true, "boolean mode maps");

const swiggy = list.find((t) => t.amount === 250);
assert.ok(swiggy);
await editTxn(db, { id: swiggy.id, merchant: "Swiggy Instamart", category: "Groceries", amount: 250, type: "expense" });
await ingest(db, [{ ...row, amount: 999 }]);
list = await listTxns(db, { search: "Instamart", limit: 10 });
assert.equal(list[0]?.amount, 250, "re-push must not overwrite app edits");
assert.equal(list[0]?.needsReview, false);

await ingest(db, [{ ...ghost, deletedAt: "2026-10-15 14:00" }]);
assert.equal((await listTxns(db, { search: "ghost", limit: 10 })).length, 0, "mini tombstone hides row");

await addTxn(db, { type: "income", amount: 1000, merchant: "Refund", category: "", date: "2026-10-14 09:00" });
const manual = (await listTxns(db, { search: "Refund", limit: 1 }))[0];
assert.ok(manual);
await removeTxn(db, manual.id);
assert.equal((await listTxns(db, { search: "Refund", limit: 10 })).length, 0, "manual delete");

await setBudget(db, { category: "Groceries", monthlyLimit: 200 });
await setBudget(db, { category: "Travel", monthlyLimit: 5000 });
const s = await monthSummary(db, "2026-10");
assert.deepEqual(s.totals.map((t) => [t.type, t.total]), [["expense", 250]]);
assert.deepEqual(s.categories.map((c) => [c.category, c.total, c.limit]), [["Groceries", 250, 200], ["Travel", 0, 5000]]);
assert.equal(s.reviewCount, 0);
assert.ok(s.lastIngestAt);
await setBudget(db, { category: "Travel", monthlyLimit: 0 });
assert.equal((await monthSummary(db, "2026-10")).categories.length, 1, "limit 0 removes budget");

await removeTxn(db, swiggy.id);
await ingest(db, [row]);
assert.equal((await listTxns(db, { limit: 10 })).length, 0, "app delete survives re-push");
assert.equal(miniRowSchema.parse({ ...row, date: "2026-04-01" }).date, "2026-04-01 00:00", "date-only rows normalise");
await assert.rejects(ingest(db, [{ ...row, id: 3, amount: -1 }]), "CHECK rejects negative, batch rolls back");
assert.throws(() => miniRowSchema.parse({ ...row, date: "2026-02-30 10:00" }), "impossible date rejected");
assert.throws(() => miniRowSchema.parse({ ...row, date: "2026-10-15 24:00" }), "impossible time rejected");
await addTxn(db, { type: "expense", amount: 1, merchant: "Edge", category: "", date: "2026-11-01 00:00" });
assert.equal((await listTxns(db, { month: "2026-10", search: "Edge", limit: 5 })).length, 0, "next month excluded");
assert.equal((await listTxns(db, { month: "2026-11", search: "Edge", limit: 5 })).length, 1, "month start included");
await addTxn(db, { type: "expense", amount: 1, merchant: "YearEnd", category: "", date: "2026-12-31 23:59" });
assert.equal((await listTxns(db, { month: "2026-12", search: "YearEnd", limit: 5 })).length, 1, "December rolls to next year");
const { meta } = await import("../src/server/db/schema.ts");
const { eq } = await import("drizzle-orm");
assert.equal(await db.select().from(meta).where(eq(meta.key, "missing")).get(), undefined, "get() miss is undefined");
console.log("check-db: ok");
