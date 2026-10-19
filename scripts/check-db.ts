// Self-check for ingest merge rules and queries. Run: npm run check:db
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { openDb } from "../src/server/db/client.ts";
import {
  addTxn, editTxn, ingest, listTxns, miniRowSchema, monthSummary, removeTxn, setBudget,
} from "../src/server/db/queries.ts";
import { merchantRules } from "../src/server/db/schema.ts";

const db = openDb(":memory:");
assert.deepEqual(await db.all(sql`SELECT ${250} AS amount, ${"Test store"} AS merchant`), [{ amount: 250, merchant: "Test store" }], "raw SQL returns named columns");
{
  const xdb = openDb(":memory:");
  const id = await addTxn(xdb, { type: "expense", amount: 99, merchant: "Not a spend add", category: "Other", date: "2026-10-16 09:00", excluded: true });
  assert.equal((await xdb.all<{ excluded: number }>(sql`SELECT excluded FROM transactions WHERE id = ${id}`))[0]?.excluded, 1, "Add with Not a spend stores excluded in one insert");
}
// Deleting a category merges its split into an existing Other row without a PK collision.
{
  const sdb = openDb(":memory:");
  const { transactionSplits } = await import("../src/server/db/schema.ts");
  const withOther = await addTxn(sdb, { type: "expense", amount: 30, merchant: "Split merge", category: "Dining", date: "2026-10-16 09:00" });
  const withoutOther = await addTxn(sdb, { type: "expense", amount: 40, merchant: "Split insert", category: "Dining", date: "2026-10-16 09:01" });
  await sdb.insert(transactionSplits).values([
    { transactionId: withOther, category: "Other", amount: 5 },
    { transactionId: withOther, category: "Dining", amount: 7 },
    { transactionId: withoutOther, category: "Dining", amount: 11 },
  ]);
  await sdb.run(sql`INSERT INTO transaction_splits (transaction_id, category, amount)
    SELECT transaction_id, 'Other', amount FROM transaction_splits WHERE category = ${"Dining"}
    ON CONFLICT (transaction_id, category) DO UPDATE SET amount = amount + excluded.amount`);
  await sdb.delete(transactionSplits).where(sql`${transactionSplits.category} = ${"Dining"}`);
  assert.deepEqual(
    (await sdb.select().from(transactionSplits).where(sql`${transactionSplits.transactionId} IN (${withOther}, ${withoutOther})`).orderBy(transactionSplits.transactionId)).map(({ transactionId, category, amount }) => [transactionId, category, amount]),
    [[withOther, "Other", 12], [withoutOther, "Other", 11]],
    "category delete combines existing Other splits and renames lone splits",
  );
}
assert.deepEqual(await db.all(sql`SELECT id FROM transactions WHERE 0`), [], "raw SQL empty result");
assert.deepEqual(await db.batch([db.all(sql`SELECT ${250} AS amount`)]), [[{ amount: 250 }]], "batched raw SQL returns named columns");
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
await assert.rejects(ingest(db, [{ ...row, id: 3 }, { ...row, id: 4, amount: -1 }]), "CHECK rejects negative, batch rolls back");
assert.equal((await listTxns(db, { limit: 10 })).length, 0, "invalid batch leaves no partial writes");
assert.equal(await ingest(db, [{ ...row, id: 3 }, { ...row, id: 4, amount: 0 }]), 1, "zero parser rows skip without blocking valid rows");
assert.equal(await ingest(db, [{ ...row, id: 3, amount: 0, deletedAt: "2026-10-16 10:00" }]), 1, "zero tombstone still ingests");
assert.equal((await listTxns(db, { limit: 10 })).length, 0, "zero tombstone hides existing transaction");
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
await db.update(meta).set({ value: "2000-01-01T00:00:00.000Z" }).where(eq(meta.key, "last_ingest_at"));
assert.equal(await ingest(db, [{ ...row, id: 9000, amount: 0 }]), 0, "zero-only push creates no transactions");
assert.notEqual((await db.select().from(meta).where(eq(meta.key, "last_ingest_at")).get())?.value, "2000-01-01T00:00:00.000Z", "zero-only push refreshes sync timestamp");

// Design rebuild: unknown category files as Other; rules apply on ingest; transfers excluded.
{
  const { addRule, listTxns: list } = await import("../src/server/db/queries.ts");
  const base = { ...row, needsReview: 1 };
  await ingest(db, [{ ...base, id: 100, category: "Beverages", merchant: "CAFE X", merchantCanonical: null }]);
  assert.equal((await list(db, { search: "CAFE X", limit: 1 }))[0]?.category, "Other", "unknown category maps to Other");
  await addRule(db, { match: "BLUE TOKAI*", displayMerchant: "Blue Tokai", category: "Food" });
  await ingest(db, [{ ...base, id: 101, category: null, merchant: "BLUE TOKAI KORAMANGALA", merchantCanonical: null }]);
  const ruled = (await list(db, { search: "Blue Tokai", limit: 1 }))[0];
  assert.equal(ruled?.category, "Food", "rule sets category on ingest");
  assert.equal(ruled?.merchant, "Blue Tokai", "rule renames merchant");
  assert.equal(ruled?.rawMerchant, "BLUE TOKAI KORAMANGALA", "raw merchant kept");
  assert.equal(ruled?.needsReview, false, "ruled rows skip review");
  await ingest(db, [{ ...base, id: 102, category: "Credit Card Payment", merchant: "CC BILL", merchantCanonical: null }]);
  assert.equal((await list(db, { search: "CC BILL", limit: 1 }))[0]?.excluded, true, "card bill is not a spend");
}
// 0003 soft-deletes stored ₹0 parser misses; real rows stay.
{
  const { readFileSync } = await import("node:fs");
  const { transactions } = await import("../src/server/db/schema.ts");
  const { eq } = await import("drizzle-orm");
  await db.insert(transactions).values([
    { id: 9901, source: "sms", type: "expense", amount: 0, merchant: "Unknown", date: "2026-10-15 14:44" },
    { id: 9902, source: "sms", type: "expense", amount: 219, merchant: "Swiggy Instamart", date: "2026-10-15 14:44" },
  ]);
  await db.run(sql.raw(readFileSync("drizzle/0003_hide_zero_rows.sql", "utf8")));
  assert.notEqual((await db.select().from(transactions).where(eq(transactions.id, 9901)).get())?.deletedAt, null, "₹0 row soft-deleted");
  assert.equal((await db.select().from(transactions).where(eq(transactions.id, 9902)).get())?.deletedAt, null, "real row untouched");
}
// List filters: date range inclusive, multi-category matches name AND type, min/max, transfer = excluded.
{
  const { listSchema, summarizeTxns } = await import("../src/server/db/queries.ts");
  const fdb = openDb(":memory:");
  const seed = (id: number, date: string, amount: number, type: "expense" | "income", category: string, excluded = false) =>
    addTxn(fdb, { type, amount, merchant: `M${id}`, category, date }).then(async (newId) => {
      if (excluded) await fdb.update((await import("../src/server/db/schema.ts")).transactions).set({ excluded: true }).where(sql`id = ${newId}`);
      return newId;
    });
  await seed(1, "2026-10-01 09:00", 100, "expense", "Food");
  await seed(2, "2026-10-15 23:59", 300, "expense", "Health");
  await seed(3, "2026-10-16 00:00", 500, "expense", "Food");
  await seed(4, "2026-10-10 12:00", 900, "income", "Food");
  await seed(5, "2026-10-12 12:00", 700, "expense", "Food", true);
  const ids = async (q: Partial<Parameters<typeof listTxns>[1]>) =>
    (await listTxns(fdb, { limit: 50, ...q } as Parameters<typeof listTxns>[1])).map((t) => t.id).sort((a, b) => a - b);
  assert.deepEqual(await ids({ from: "2026-10-01", to: "2026-10-15" }), [1, 2, 4, 5], "range inclusive of both ends, excludes 16th");
  assert.deepEqual(await ids({ categories: ["Food"] }), [1, 3, 4, 5], "multi category, Food across types");
  assert.deepEqual(await ids({ type: "transfer" }), [5], "transfer means excluded rows");
  assert.deepEqual(await ids({ min: 200, max: 600 }), [2, 3], "amount bounds inclusive");
  assert.deepEqual(await ids({ type: "expense", min: 0 }).then((r) => r.length), 4, "expense type filter");
  assert.equal(listSchema.safeParse({ from: "2026-02-30" }).success, false, "impossible from rejected");
  assert.equal(listSchema.safeParse({ from: "2026-10-15", to: "2026-10-01" }).success, false, "to before from rejected");
  assert.equal(listSchema.safeParse({ min: 900, max: 100 }).success, false, "min above max rejected");
  const sum = await summarizeTxns(fdb, { from: "2026-10-01", to: "2026-10-15", limit: 50 } as Parameters<typeof summarizeTxns>[1]);
  assert.equal(sum.count, 4, "summary count matches list WHERE");
  assert.equal(sum.spent, 400, "spent = expense, not excluded: 100 + 300");
  assert.equal(sum.income, 900, "income summed");
  assert.equal(sum.transferred, 700, "transferred = excluded rows in range");
  assert.equal(sum.biggest?.merchant, "M2", "biggest counted spend");
  assert.equal(sum.avgPerDay, 400 / 15, "avg/day over 15 inclusive days");
  const empty = await summarizeTxns(fdb, { from: "2025-01-01", to: "2025-01-02", limit: 50 } as Parameters<typeof summarizeTxns>[1]);
  assert.deepEqual([empty.count, empty.spent, empty.top, empty.biggest, empty.frequent], [0, 0, [], null, null], "empty range summary");
}
// Insights uses Activity's filters: same scope, same spend, income and payment count.
{
  const { summarizeTxns } = await import("../src/server/db/queries.ts");
  const { insightsFor } = await import("../src/server/insights/fns.ts");
  const idb = openDb(":memory:");
  const { transactions: t } = await import("../src/server/db/schema.ts");
  await idb.insert(t).values([
    { source: "manual", type: "expense", amount: 100, merchant: "Cafe", category: "Food", date: "2026-10-02 09:00", accountLast4: "1111" },
    { source: "manual", type: "expense", amount: 250, merchant: "Cafe", category: "Food", date: "2026-10-03 09:00", accountLast4: "2222" },
    { source: "manual", type: "expense", amount: 900, merchant: "Shop", category: "Shopping", date: "2026-10-04 09:00", accountLast4: "1111" },
    { source: "manual", type: "income", amount: 5000, merchant: "Pay", category: "Salary", date: "2026-10-01 09:00" },
    { source: "manual", type: "expense", amount: 70, merchant: "Cafe", category: "Food", date: "2026-09-20 09:00", accountLast4: "1111" },
  ]);
  for (const scope of [{ month: "2026-10" }, { month: "2026-10", card: "1111" }, { month: "2026-10", categories: ["expense:Food"] }, { from: "2026-09-15", to: "2026-10-03" }]) {
    const [ins, sum] = await Promise.all([insightsFor(idb, scope), summarizeTxns(idb, scope)]);
    assert.equal(ins.waterfall.spending, sum.spent, `insights spend = activity spend for ${JSON.stringify(scope)}`);
    assert.equal(ins.waterfall.income, sum.income, `insights income = activity income for ${JSON.stringify(scope)}`);
  }
  const food = await insightsFor(idb, { month: "2026-10", categories: ["expense:Food"] });
  assert.deepEqual(food.merchants.map((m) => m.merchant), ["Cafe"], "category filter narrows merchants");
  assert.deepEqual(food.six.slice(-2).map((m) => m.total), [70, 350], "six months keep the filter, one month each");
  const range = await insightsFor(idb, { from: "2026-09-15", to: "2026-10-03" });
  assert.equal(range.month, "2026-10", "range anchors on its end month");
  assert.equal(range.bees.length, 3, "range covers both months");
  // Type prefix: "income:Travel" must not pull the Travel half of an expense split.
  const { transactionSplits: ts } = await import("../src/server/db/schema.ts");
  const [mixed] = await idb.insert(t).values({ source: "manual", type: "expense", amount: 100, merchant: "Mixed", category: "Food", date: "2026-10-05 09:00" }).returning({ id: t.id });
  await idb.insert(ts).values([{ transactionId: mixed.id, category: "Food", amount: 50 }, { transactionId: mixed.id, category: "Travel", amount: 50 }]);
  const typed = await summarizeTxns(idb, { month: "2026-10", merchant: "Mixed", categories: ["expense:Food", "income:Travel"] });
  assert.equal(typed.spent, 50, "income:Travel scope skips the expense split's Travel part");
  const open = await insightsFor(idb, { from: "2026-01-01" });
  assert.equal(open.month, new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()).slice(0, 7), "from-only range anchors on now");
  const { scopeSearch } = await import("../src/lib/filters.ts");
  assert.equal(scopeSearch.safeParse({ from: "2026-02-30" }).success, false, "client rejects impossible dates like the server");
  assert.equal(scopeSearch.safeParse({ categories: [" "] }).success, false, "client rejects blank categories like the server");
}
// Reimbursement accounting uses only synthetic transactions.
{
  const { transactions, reimbursements, reimbursementLinks, transactionItems, transactionSplits } = await import("../src/server/db/schema.ts");
  const { spendByCategory, listTxns, monthSummary, summarizeTxns } = await import("../src/server/db/queries.ts");
  const { deriveClaimStatus } = await import("../src/server/daily/reimburse.ts");
  const rdb = openDb(":memory:");
  const add = (id: number, type: "expense" | "income", amount: number, date: string, category: string) => rdb.insert(transactions).values({ id, source: "manual", type, amount, merchant: `Synthetic ${id}`, category, date });
  await rdb.batch([
    add(9601, "expense", 300, "2026-10-01 10:00", "Food"),
    add(9602, "income", 120, "2026-10-05 10:00", ""),
    add(9603, "income", 300, "2026-10-08 10:00", ""),
    add(9604, "expense", 100, "2026-10-10 10:00", "Food"),
    add(9605, "expense", 100, "2026-10-11 10:00", "Other"),
    rdb.insert(transactionItems).values([
      { id: 9601, transactionId: 9601, name: "Shared meal", qty: null, amount: 120, category: "Food", source: "manual", confidence: null, sortOrder: 0 },
      { id: 9602, transactionId: 9601, name: "Personal meal", qty: null, amount: 180, category: "Food", source: "manual", confidence: null, sortOrder: 1 },
    ]),
    rdb.insert(transactionSplits).values([
      { transactionId: 9601, category: "Food", amount: 300 },
      { transactionId: 9605, category: "Food", amount: 70 },
      { transactionId: 9605, category: "Home", amount: 30 },
    ]),
    rdb.insert(reimbursements).values([
      { id: 9601, transactionId: 9601, amount: 120, counterparty: "Alex", status: "pending", itemIds: JSON.stringify([9601]) },
      { id: 9602, transactionId: 9604, amount: 100, counterparty: "Sam", status: "cancelled" },
    ]),
    rdb.insert(reimbursementLinks).values([
      { reimbursementId: 9601, creditTransactionId: 9602, amount: 120 },
      { reimbursementId: 9601, creditTransactionId: 9603, amount: 200 },
    ]),
  ]);
  assert.equal(await deriveClaimStatus(rdb, { id: 9601, amount: 120, status: "pending" }), "extra", "overpayment derives extra status");
  assert.equal(await deriveClaimStatus(rdb, { id: 9601, amount: 120, status: "pending", manualPaid: true }), "reimbursed", "manual paid status persists");
  assert.equal(await deriveClaimStatus(rdb, { id: 9601, amount: 120, status: "cancelled" }), "cancelled", "cancelled status persists");
  const [category] = await spendByCategory(rdb, "2026-10-01", "2026-11-01");
  assert.equal(category?.total, 350, "selected receipt item reduces its category share only");
  const all = await summarizeTxns(rdb, { month: "2026-10" });
  assert.equal(all.spent, 380, "summary expense excludes item claim, includes split rows");
  assert.deepEqual(all.top.slice(0, 2), [{ category: "Food", total: 350 }, { category: "Home", total: 30 }], "top categories honor saved splits");
  const food = await summarizeTxns(rdb, { month: "2026-10", categories: ["expense:Food"] });
  assert.equal(food.spent, 350, "filtered summary subtracts item claim from selected category");
  const two = await summarizeTxns(rdb, { month: "2026-10", categories: ["expense:Food", "expense:Home"] });
  assert.equal(two.spent, 380, "multi-category summary counts only selected split parts");
  const home = await summarizeTxns(rdb, { month: "2026-10", categories: ["expense:Home"] });
  assert.deepEqual(home.top, [{ category: "Home", total: 30 }], "top excludes unselected split parts");
  assert.equal(home.spent, 30, "home-only summary is the saved split part");
  const counted = await listTxns(rdb, { month: "2026-10", limit: 20 });
  assert.equal(counted.find((t) => t.id === 9601)?.yours, 180, "your share subtracts open or settled claim, never below zero");
  assert.equal(counted.find((t) => t.id === 9604)?.yours, 100, "cancelled claim counts full expense");
  assert.equal(counted.find((t) => t.id === 9602)?.amount, 120);
  const summary = await monthSummary(rdb, "2026-10");
  // Claim 120 linked 320 (extra 200). Extra split pro rata: 9602 gets 75, 9603 gets 125. Income = (120-120+75) + (300-200+125) = 300.
  assert.equal(summary.totals.find((t) => t.type === "income")?.total, 300, "linked credit excludes claimed repayment; extra back counts as income");
  // Cancel releases linked credits. Reused credit must not allow the old claim to revive.
  const [release] = await rdb.all<{ id: number }>(sql`
    INSERT INTO reimbursements (transaction_id, amount, counterparty, status)
    SELECT ${9605}, ${80}, ${"Taylor"}, 'pending'
    RETURNING id`);
  assert.ok(release?.id, "second synthetic claim created");
  await rdb.update(reimbursements).set({ status: "cancelled" }).where(sql`${reimbursements.id} = ${9601}`);
  const used = await rdb.all<{ amount: number }>(sql`
    INSERT INTO reimbursement_links (reimbursement_id, credit_transaction_id, amount)
    SELECT ${release.id}, ${9602}, ${80}
    WHERE (SELECT amount FROM transactions WHERE id = ${9602}) >= ${80} + COALESCE((
      SELECT SUM(l.amount) FROM reimbursement_links l JOIN reimbursements r ON r.id=l.reimbursement_id
      WHERE l.credit_transaction_id=${9602} AND r.status != 'cancelled'), 0)
    RETURNING amount`);
  assert.equal(used[0]?.amount, 80, "cancelled claim frees credit for another claim");
  assert.equal((await monthSummary(rdb, "2026-10")).totals.find((t) => t.type === "income")?.total, 340, "reused credit is counted only once");
  console.log("check-reimbursements: ok");
}
console.log("check-db: ok");

// Auth helpers: session signing, expiry, tamper, password hash, redirect safety.
{
  const { makeSession, validSession, checkPassword, safeNext } = await import("../src/server/auth.ts");
  const crypto = await import("node:crypto");
  const secret = "x".repeat(40);
  const s = makeSession(secret, Date.UTC(2026, 9, 15));
  assert.ok(validSession(secret, s, Date.UTC(2026, 9, 16)), "fresh session valid");
  assert.ok(!validSession(secret, s, Date.UTC(2027, 1, 1)), "expired session rejected");
  assert.ok(!validSession("y".repeat(40), s, Date.UTC(2026, 9, 16)), "other secret rejected");
  assert.ok(!validSession(secret, `9999999999.${s.split(".")[1]}`), "tampered expiry rejected");
  const salt = crypto.randomBytes(16);
  const hash = `scrypt:${salt.toString("hex")}:${crypto.scryptSync("correct horse", salt, 64).toString("hex")}`;
  assert.ok(await checkPassword(hash, "correct horse"), "right password");
  assert.ok(!(await checkPassword(hash, "wrong horse")), "wrong password");
  assert.equal(safeNext("//evil.example"), "/", "protocol-relative next blocked");
  assert.equal(safeNext("/\\evil.example"), "/", "backslash next blocked");
  assert.equal(safeNext("/history?review=true"), "/history?review=true");
  // Expired session on client navigation: start.ts sends the browser to /login?next=<page>.
  const next = new URLSearchParams(`next=${encodeURIComponent("/wealth?tab=sip&x=1")}`).get("next");
  assert.equal(safeNext(next), "/wealth?tab=sip&x=1", "login next round-trips the current page");
  console.log("check-auth: ok");
}

// Recurring schedule regressions use only synthetic rows in the in-memory DB.
{
  const { recurringOccurrences, recurringSeries, transactions } = await import("../src/server/db/schema.ts");
  const { matchRecurring, nextDue, scheduleSeries } = await import("../src/server/plan/jobs.ts");
  const { eq } = await import("drizzle-orm");
  const { mock } = await import("node:test");
  const actualToday = new Date().toISOString().slice(0, 10);
  const addTxnRow = (id: number, merchant: string, date: string, amount = 50, fields: Partial<typeof transactions.$inferInsert> = {}) =>
    db.insert(transactions).values({ id, source: "sms", type: "expense", amount, merchant, category: "", date, ...fields });
  const seriesRow = (id: number, name: string, match: string, cadence: "monthly" | "quarterly" | "yearly" | "weekly", usualDay: number | null, expectedAmount = 50) => ({
    id, name, kind: "bill" as const, match, cadence, usualDay, expectedAmount, tolerancePct: 0, status: "active" as const,
  });

  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-16T12:00:00Z") });
  try {
    await db.insert(recurringSeries).values([
      seriesRow(9201, "Quarterly", "Quarterly Vendor", "quarterly", 15),
      seriesRow(9202, "Yearly", "Yearly Vendor", "yearly", 15),
      seriesRow(9203, "Weekly", "Weekly Vendor", "weekly", null, 70),
      seriesRow(9204, "Schedule target", "Scoped Vendor", "monthly", 16),
      seriesRow(9205, "Schedule sibling", "Scoped Vendor", "monthly", 16),
      seriesRow(9206, "Guards", "Guard Vendor", "monthly", 16, 20),
      seriesRow(9207, "New quarterly", "New quarterly", "quarterly", 20),
      seriesRow(9208, "New yearly", "New yearly", "yearly", 25),
      seriesRow(9209, "Late first quarterly", "Late first quarterly", "quarterly", 15),
      seriesRow(9210, "Unpaid weekly", "Unpaid weekly", "weekly", null),
    ]);
    await db.batch([
      addTxnRow(9201, "Quarterly Vendor", "2026-07-15 10:00"),
      addTxnRow(9202, "Quarterly Vendor", "2026-08-15 10:00"),
      addTxnRow(9203, "Quarterly Vendor", "2026-10-15 10:00"),
      addTxnRow(9211, "Yearly Vendor", "2025-10-15 10:00"),
      addTxnRow(9212, "Yearly Vendor", "2026-03-15 10:00"),
      addTxnRow(9213, "Yearly Vendor", "2026-10-15 10:00"),
      addTxnRow(9221, "Weekly Vendor", "2026-01-01 10:00", 70),
      addTxnRow(9231, "Scoped Vendor", `${actualToday} 10:00`),
      addTxnRow(9241, "Guard Vendor", "2026-10-16 10:00", 20, { type: "income" }),
      addTxnRow(9242, "Guard Vendor", "2026-10-16 11:00", 20, { excluded: true }),
      addTxnRow(9243, "Guard Vendor", "2026-10-16 12:00", 20, { deletedAt: "2026-10-16 12:01" }),
      db.insert(recurringOccurrences).values({ seriesId: 9203, dueDate: "2026-01-01", transactionId: 9221, status: "cleared" }),
      db.insert(recurringOccurrences).values({ seriesId: 9210, dueDate: "2026-01-01", transactionId: null, status: "upcoming" }),
    ]);

    await matchRecurring([9203, 9202, 9201], db, 9201);
    let quarterly = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, 9201));
    assert.equal(quarterly.find((o) => o.dueDate === "2026-07-15")?.transactionId, 9201, "quarterly first payment anchors July");
    assert.ok(!quarterly.some((o) => o.transactionId === 9202), "quarterly off-cycle August payment stays unmatched");
    assert.equal(quarterly.find((o) => o.dueDate === "2026-10-15")?.transactionId, 9203, "quarterly cadence resumes in October");
    await addTxnRow(9204, "Quarterly Vendor", "2026-07-16 10:00");
    await matchRecurring([9204, 9201], db, 9201);
    quarterly = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, 9201));
    assert.equal(quarterly.find((o) => o.dueDate === "2026-07-15")?.transactionId, 9201, "different payment cannot replace a matched transaction");
    await matchRecurring([9201], db, 9201);
    quarterly = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, 9201));
    assert.equal(quarterly.find((o) => o.dueDate === "2026-07-15")?.transactionId, 9201, "same transaction re-push is idempotent");

    await matchRecurring([9213, 9212, 9211], db, 9202);
    const yearly = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, 9202));
    assert.equal(yearly.find((o) => o.dueDate === "2025-10-15")?.transactionId, 9211, "yearly first payment anchors October");
    assert.ok(!yearly.some((o) => o.transactionId === 9212), "yearly off-cycle payment stays unmatched");
    assert.equal(yearly.find((o) => o.dueDate === "2026-10-15")?.transactionId, 9213, "yearly cadence resumes at anchor month");

    await matchRecurring([], db, 9203);
    let weekly = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, 9203));
    assert.equal(weekly.filter((o) => o.status === "past_due").length, 40, "weekly catch-up advances every missed period");
    assert.equal(weekly.find((o) => o.status === "past_due" && o.dueDate === "2026-10-08")?.status, "past_due");
    assert.deepEqual(weekly.filter((o) => o.status === "upcoming").map((o) => o.dueDate), ["2026-10-15"], "only current cadence occurrence remains upcoming");
    await matchRecurring([], db, 9203);
    weekly = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, 9203));
    assert.deepEqual(weekly.filter((o) => o.status === "upcoming").map((o) => o.dueDate), ["2026-10-15"], "repeat run keeps one current upcoming occurrence");
    await addTxnRow(9222, "Weekly Vendor", "2026-10-20 10:00", 70);
    await matchRecurring([9222], db, 9203);
    weekly = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, 9203));
    assert.equal(weekly.find((o) => o.dueDate === "2026-10-15")?.status, "cleared_late", "payment within five day grace clears due late");
    await matchRecurring([9222], db, 9203);
    weekly = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, 9203));
    assert.equal(weekly.filter((o) => o.transactionId === 9222).length, 1, "late weekly re-push cannot clear the following due too");
    assert.deepEqual(weekly.filter((o) => o.status === "upcoming").map((o) => o.dueDate), ["2026-10-22"]);
    await matchRecurring([], db, 9210);
    const unpaid = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, 9210));
    assert.equal(unpaid.find((o) => o.dueDate === "2026-01-01")?.status, "past_due", "unpaid persisted due becomes past_due");
    assert.equal(unpaid.filter((o) => o.status === "past_due").length, 41, "unpaid weekly schedule catches up without a prior payment");

    await scheduleSeries(9204, db);
    assert.ok((await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, 9204))).length > 0, "scheduleSeries processes requested series");
    assert.equal((await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, 9205))).length, 0, "scheduleSeries leaves sibling series untouched");
    await db.update(recurringSeries).set({ usualDay: 20, cadence: "quarterly" }).where(eq(recurringSeries.id, 9204));
    await scheduleSeries(9204, db);
    const edited = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, 9204));
    assert.equal(edited.filter((o) => o.transactionId === 9231).length, 1, "rescheduling preserves one historical match per payment");
    assert.equal(edited.find((o) => o.status === "upcoming")?.dueDate, nextDue(edited.find((o) => o.transactionId === 9231)!.dueDate, "quarterly", 20), "edited series uses new cadence and due day");
    await matchRecurring([9241, 9242, 9243], db, 9206);
    const guarded = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, 9206));
    assert.equal(guarded.find((o) => o.status === "upcoming")?.transactionId, null, "income, excluded, and deleted rows do not clear a due");
    await matchRecurring([], db, 9207);
    await matchRecurring([], db, 9208);
    assert.equal((await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, 9207)).get())?.dueDate, "2026-10-20", "new quarterly respects configured day");
    assert.equal((await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, 9208)).get())?.dueDate, "2026-10-25", "new yearly respects configured day");
    await addTxnRow(9251, "Late first quarterly", "2026-07-17 10:00");
    await matchRecurring([9251], db, 9209);
    const firstQuarterly = await db.select().from(recurringOccurrences).where(eq(recurringOccurrences.seriesId, 9209));
    assert.equal(firstQuarterly.find((o) => o.transactionId === 9251)?.dueDate, "2026-07-15", "first quarterly payment honors usual day");
    assert.equal(firstQuarterly.find((o) => o.transactionId === 9251)?.status, "cleared_late");
  } finally {
    mock.timers.reset();
  }
  console.log("check-recurring: ok");
}

{
  // Mini presence and Sync now (§18).
  const { minipoll, miniStatus, requestSync } = await import("../src/server/mini.ts");
  const mdb = openDb(":memory:");
  const t0 = new Date("2026-10-16T10:00:00Z");
  assert.deepEqual(await minipoll(mdb, false, t0), { sync: false }, "no request, no sync");
  let s = await miniStatus(mdb, t0.getTime() + 60_000);
  assert.equal(s.online, true, "seen a minute ago is online");
  assert.equal(s.sync, "idle");
  assert.equal((await miniStatus(mdb, t0.getTime() + 3 * 60_000)).online, false, "3 min silent is offline");
  await requestSync(mdb, new Date(t0.getTime() + 60_000));
  assert.equal((await miniStatus(mdb, t0.getTime() + 61_000)).sync, "waiting");
  assert.deepEqual(await minipoll(mdb, false, new Date(t0.getTime() + 90_000)), { sync: true }, "poll picks up the request");
  assert.deepEqual(await minipoll(mdb, true, new Date(t0.getTime() + 120_000)), { sync: false }, "done clears it");
  s = await miniStatus(mdb, t0.getTime() + 121_000);
  assert.equal(s.sync, "synced");
  console.log("check-mini: ok");
}
// A new rule files pending rows it matches, not just the source row.
{
  const { addRule } = await import("../src/server/db/queries.ts");
  const rdb = openDb(":memory:");
  const base = { type: "expense" as const, amount: 99, category: "Other", date: "2026-10-16 09:00" };
  const a = await addTxn(rdb, { ...base, merchant: "OPENROUTER INC" });
  const b = await addTxn(rdb, { ...base, merchant: "OPENROUTER INC" });
  const c = await addTxn(rdb, { ...base, merchant: "CAFE Y" });
  await rdb.run(sql`UPDATE transactions SET needs_review = 1`);
  const { ids } = await addRule(rdb, { match: "OPENROUTER INC", displayMerchant: "OpenRouter", category: "Work", createdFromTxnId: a });
  assert.deepEqual(ids.sort(), [a, b].sort(), "rule files every matching pending row");
  const rows = await listTxns(rdb, { limit: 10 });
  assert.equal(rows.find((t) => t.id === b)?.category, "Work");
  assert.equal(rows.find((t) => t.id === b)?.needsReview, false);
  assert.equal(rows.find((t) => t.id === c)?.needsReview, true, "other merchants stay in review");
}
// Same match twice: newest category wins, exactly one rule remains.
{
  const { addRule } = await import("../src/server/db/queries.ts");
  const rdb = openDb(":memory:");
  await addRule(rdb, { match: "AMAZON INDIA", displayMerchant: "Amazon", category: "Utilities" });
  await addRule(rdb, { match: "  amazon india ", displayMerchant: "Amazon", category: "Shopping" });
  const rules = await rdb.select().from(merchantRules);
  assert.equal(rules.length, 1, "same match leaves one rule");
  assert.equal(rules[0]?.category, "Shopping", "newest category wins");
}
