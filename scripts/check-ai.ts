import assert from "node:assert/strict";
import { mock } from "node:test";
import { eq } from "drizzle-orm";
import { askLedger, askSpecSchema, describeScope, figuresMatchRows, redact, scrub } from "../src/server/ai/ask.ts";
import { openDb } from "../src/server/db/client.ts";
import { digests, insights, transactions } from "../src/server/db/schema.ts";
import { callOpenRouter } from "../src/server/ai/client.ts";
import { attachments, receiptJobs } from "../src/server/db/schema.ts";
import { categorize, receiptOutput, receiptSplitMatches, redactReceiptText, runReceiptJob, scrubItemName } from "../src/server/ai/receipt.ts";
import { spendByCategory } from "../src/server/db/queries.ts";
import { transactionSplits } from "../src/server/db/schema.ts";
import { validDigestLines, runDetectors, runDigest } from "../src/server/insights/jobs.ts";

const spec = askSpecSchema.safeParse({ metric: "sum", filters: { category: "Food" }, groupBy: "month", period: "last_3_months" });
assert.equal(spec.success, true);
assert.equal(askSpecSchema.safeParse({ metric: "sum", filters: { card: "2047" } }).success, false);
assert.equal(figuresMatchRows("Total is ₹1,200.", [{ value: 1200 }]), true);
assert.equal(figuresMatchRows("Total is ₹1,201.", [{ value: 1200 }]), false);
assert.equal(figuresMatchRows("About ₹1,200 so far.", [{ value: 1199.6 }]), true);
assert.equal(scrub("swiggy@axisbank"), "[private payee]");
assert.equal(scrub("A/c 123456789"), "[private payee]");
assert.equal(scrub("Swiggy"), "Swiggy");
assert.equal(scrub("Visa 4242"), "[private payee]", "card last-4 in labels");
assert.equal(redact("Over ₹ 4500 or INR 4500?"), "Over ₹ 4500 or INR 4500?", "spaced currency amounts kept");
assert.equal(scrub("Visa 1234 5678 9012 3456"), "[private payee]");
assert.equal(scrub("Visa 1234-5678-9012-3456"), "[private payee]");
assert.equal(scrub("Visa 1234.5678.9012.3456"), "[private payee]");
assert.equal(redact("Paid card 1234.5678.9012.3456"), "Paid card [number]");
assert.equal(redact("Why did card 4242 fail in 2026?"), "Why did card [number] fail in 2026?", "card last-4 redacted, years kept");
assert.equal(redact("card ••4242 vs XX1234, ₹4500 in 2025"), "card ••[number] vs XX[number], ₹4500 in 2025", "bare last-4 masked; ₹ amounts and years kept");
assert.equal(redact("Paid ravi@okhdfc from card 4111 1111 1111 1111 on 12 Oct"), "Paid [private] from card [number] on 12 Oct");
assert.equal(figuresMatchRows("You spent 120000 rupees", [{ value: 900 }]), false);
assert.equal(figuresMatchRows("Rs. 900 and INR 900", [{ value: 900 }]), true);
assert.equal(validDigestLines([{ pre: "", num: "42 rows", post: "", factKey: "backlog" }, { pre: "", num: "Food ₹900", post: "", factKey: "category" }, { pre: "", num: "Shop at 40%", post: "", factKey: "merchant" }], { backlog: "42 rows", category: "Food ₹900", merchant: "Shop at 40%" }), true);
assert.equal(validDigestLines([{ pre: "Spent ₹5,000 ", num: "42 rows", post: "", factKey: "backlog" }, { pre: "", num: "Food ₹900", post: "", factKey: "category" }, { pre: "", num: "Shop at 40%", post: "", factKey: "merchant" }], { backlog: "42 rows", category: "Food ₹900", merchant: "Shop at 40%" }), false);

const db = openDb(":memory:");
const now = new Date();
const date = (days: number) => new Date(now.getTime() - days * 864e5).toISOString().slice(0, 10);
for (let week = 1; week <= 8; week++) await db.insert(transactions).values({ source: "manual", type: "expense", amount: 100, merchant: "Test store", category: "Food", date: `${date(week * 7)} 12:00` });
await db.insert(transactions).values({ source: "manual", type: "expense", amount: 300, merchant: "Test store", category: "Food", date: `${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now)} 00:00` }); // this IST week, whatever the weekday
await runDetectors(db);
const unusual = await db.select().from(insights).where(eq(insights.detector, "unusual"));
assert.ok(unusual.length >= 1);

// Synthetic clock, key and fetch: no outbound AI calls, even when testing enabled paths.
const savedAi = process.env.KHARCHA_AI; const savedKey = process.env.OPENROUTER_API_KEY; const savedFetch = globalThis.fetch;
try {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-19T01:30:00Z") });
  const digestDb = openDb(":memory:"); let requests = 0; let payload = "";
  globalThis.fetch = async (_input, init) => { requests++; payload = String(init?.body); return Response.json({ choices: [{ message: { content: "{}" } }] }); };
  process.env.KHARCHA_AI = "off"; process.env.OPENROUTER_API_KEY = "synthetic-test-key";
  assert.deepEqual(await callOpenRouter([], { db: digestDb }), { ok: false, reason: "disabled" });
  await runDigest(digestDb);
  assert.equal(requests, 0, "AI off blocks Ask and digest HTTP requests");
  await digestDb.insert(transactions).values([
    { source: "manual", type: "expense", amount: 500, merchant: "Visa 1234 5678 9012 3456", category: "Visa 1234-5678-9012-3456", date: "2026-10-14 12:00" },
    { source: "manual", type: "expense", amount: 900, merchant: "New week", category: "New week", date: "2026-10-19 06:00" },
  ]);
  process.env.KHARCHA_AI = "on";
  await runDigest(digestDb);
  assert.equal(requests, 1);
  assert.ok(!payload.includes("1234"), "private merchant/category labels never reach model");
  const digest = await digestDb.select().from(digests).get();
  assert.equal(digest?.weekStart, "2026-10-12", "Monday digest uses prior full week");
  assert.ok(digest?.factsJson.includes("500"), "prior week expense included");
} finally {
  mock.timers.reset(); globalThis.fetch = savedFetch;
  if (savedAi === undefined) delete process.env.KHARCHA_AI; else process.env.KHARCHA_AI = savedAi;
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedKey;
}

// Receipt reading: synthetic inputs only, no network.
assert.equal(scrubItemName("Milk 1L 4111 1111 1111 1111"), "Milk 1L");
assert.equal(scrubItemName("Bread 5612-3456-7890-1234 x"), "Bread x");
assert.equal(scrubItemName("Refund ravi@okhdfc"), "Refund");
assert.equal(scrubItemName("Eggs 12 pack"), "Eggs 12 pack");
assert.equal(categorize("Mystery item", "Unknown", [], new Set(["Food", "Other"]), "Food", "Other"), "Food");
assert.equal(categorize("Mystery item", "Unknown", [], new Set(["Shopping", "Other"]), "Shopping", "Other"), "Shopping");
assert.equal(categorize("Milk", "BigBasket", [{ match: "bigbasket*", category: "Shopping" }], new Set(["Shopping", "Food"]), "Food", "Other"), "Shopping");
assert.equal(categorize("Bread", "Shop", [], new Set(["Food"]), "Home", "Other"), "Food");
const good = receiptOutput.safeParse({ isReceipt: true, total: 120, currency: "INR", items: [{ name: "Milk", qty: 1, amount: 60, confidence: 0.9 }] });
assert.equal(good.success, true);
assert.equal(receiptOutput.safeParse({ isReceipt: true, total: 1, currency: null, items: [{ name: "x", qty: null, amount: 1, confidence: 2 }] }).success, false);
assert.equal(receiptOutput.safeParse({ isReceipt: "yes", total: null, currency: null, items: [] }).success, false);
assert.equal(receiptSplitMatches(100, [{ amount: 60 }, { amount: 40 }]), true);
assert.equal(receiptSplitMatches(100, [{ amount: 60 }, { amount: 30 }]), false);
assert.equal(receiptSplitMatches(100, []), false);

const splitDb = openDb(":memory:");
await splitDb.insert(transactions).values([
  { source: "manual", type: "expense", amount: 100, merchant: "Mart", category: "Shopping", date: "2026-10-05 10:00" },
  { source: "manual", type: "expense", amount: 50, merchant: "Cafe", category: "Food", date: "2026-10-06 10:00" },
]);
await splitDb.insert(transactionSplits).values([{ transactionId: 1, category: "Food", amount: 70 }, { transactionId: 1, category: "Home", amount: 30 }]);
const byCat = Object.fromEntries((await spendByCategory(splitDb, "2026-10-01", "2026-11-01")).map((row) => [row.category, row.total]));
assert.equal(byCat.Food, 120, "split contributes split amounts, unsplit rows keep category");
assert.equal(byCat.Home, 30);
assert.equal(byCat.Shopping, undefined, "split replaces the single category");

// Local OCR redaction: synthetic bill text only.
const bill = redactReceiptText("Mart Bill\nCard 4111 1111 1111 1111\nUPI: someone@okbank\nA/c 123456789012\nMilk 60.00\nTotal 1,234.50");
assert.ok(bill.includes("Milk 60.00\nTotal 1,234.50"), "items, amounts and line breaks kept");
assert.ok(!redactReceiptText("Ravi Kumar\n9876543210\nhi@shop.in").match(/9876543210|@shop/), "phone and email removed");
assert.ok(!bill.includes("4111") && !bill.includes("@okbank") && !bill.includes("123456789012"), "card, UPI and account removed");

// runReceiptJob: injected OCR, mocked fetch, in-memory DB. Never touches disk or network.
async function receiptHarness(text: string | null) {
  const rdb = openDb(":memory:");
  await rdb.insert(transactions).values({ source: "manual", type: "expense", amount: 60, merchant: "Mart", category: "Food", date: "2026-10-05 10:00" });
  await rdb.insert(attachments).values({ transactionId: 1, path: "/synthetic/none.jpg", mime: "image/jpeg", bytes: 1 });
  await rdb.insert(receiptJobs).values({ transactionId: 1, status: "queued" });
  let calls = 0; let body = "";
  globalThis.fetch = async (_input, init) => { calls++; body = String(init?.body); return Response.json({ choices: [{ message: { content: JSON.stringify({ isReceipt: true, total: 60, currency: "INR", items: [{ name: "Milk", qty: 1, amount: 60, confidence: 0.9 }] }) } }] }); };
  process.env.KHARCHA_AI = "on"; process.env.OPENROUTER_API_KEY = "synthetic-test-key";
  await runReceiptJob(rdb, 1, 1, async () => text);
  const job = await rdb.select().from(receiptJobs).get();
  return { job, calls, body };
}
try {
  const ok = await receiptHarness("Mart Bill\nCard 4111 1111 1111 1111\nUPI: someone@okbank\nA/c 123456789012\nMilk 60.00\nTotal 60.00");
  assert.equal(ok.calls, 1);
  assert.ok(!ok.body.includes("base64") && !ok.body.includes("image_url"), "no image payload");
  assert.ok(!ok.body.includes("4111") && !ok.body.includes("@okbank") && !ok.body.includes("123456789012"), "sensitive OCR text not sent");
  assert.equal(ok.job?.status, "done");
  const none = await receiptHarness(null);
  assert.equal(none.calls, 0, "OCR unavailable: no AI call");
  assert.equal(none.job?.status, "failed");
  assert.equal(none.job?.error, "unreadable");
} finally {
  globalThis.fetch = savedFetch;
  if (savedAi === undefined) delete process.env.KHARCHA_AI; else process.env.KHARCHA_AI = savedAi;
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedKey;
}

// Ask scope: server enforces it, the planner's period can't widen it, card digits never reach the model.
{
  const savedAi = process.env.KHARCHA_AI; const savedKey = process.env.OPENROUTER_API_KEY; const savedFetch = globalThis.fetch;
  try {
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-19T01:30:00Z") });
    const sdb = openDb(":memory:"); const bodies: string[] = [];
    await sdb.insert(transactions).values([
      { source: "manual", type: "expense", amount: 100, merchant: "Cafe", category: "Food", date: "2026-10-05 12:00", accountLast4: "4242" },
      { source: "manual", type: "expense", amount: 200, merchant: "Cafe", category: "Food", date: "2026-10-06 12:00", accountLast4: "9999" },
      { source: "manual", type: "expense", amount: 400, merchant: "Shop", category: "Shopping", date: "2026-10-06 13:00", accountLast4: "4242" },
      { source: "manual", type: "expense", amount: 800, merchant: "Cafe", category: "Food", date: "2026-09-06 12:00", accountLast4: "4242" },
    ]);
    // Planner asks for everything, all time; scope must still win.
    const replies = [JSON.stringify({ queries: [{ metric: "sum", period: "all", filters: {} }] }), JSON.stringify({ answer: "In scope you spent ₹100.", followUps: [] })];
    globalThis.fetch = async (_input, init) => { bodies.push(String(init?.body)); return Response.json({ choices: [{ message: { content: replies[(bodies.length - 1) % 2] } }] }); };
    process.env.KHARCHA_AI = "on"; process.env.OPENROUTER_API_KEY = "synthetic-test-key";
    const result = await askLedger(sdb, "How much?", { month: "2026-10", categories: ["expense:Food"], card: "4242" });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.rows.map((r) => r.value), [100], "scope: Oct + Food + card 4242 only");
      assert.equal(result.answer, "In scope you spent ₹100.", "figure from scoped rows passes the check");
    }
    assert.ok(bodies.every((b) => !b.includes("4242")), "card digits never reach OpenRouter");
    assert.ok(bodies[0]?.includes("one card") && bodies[0]?.includes("Food"), "planner told the scope by name");
    replies[1] = JSON.stringify({ answer: "Total ₹1,500.", followUps: [] });
    const all = await askLedger(sdb, "How much?");
    assert.equal(all.ok && all.rows[0]?.value, 1500, "no scope: planner's period applies");
    // Split row: scope Food counts only the Food part.
    const { transactionSplits: splits } = await import("../src/server/db/schema.ts");
    const [split] = await sdb.insert(transactions).values({ source: "manual", type: "expense", amount: 100, merchant: "Mixed", category: "Food", date: "2026-10-07 12:00", accountLast4: "4242" }).returning({ id: transactions.id });
    await sdb.insert(splits).values([{ transactionId: split.id, category: "Food", amount: 50 }, { transactionId: split.id, category: "Travel", amount: 50 }]);
    replies[1] = JSON.stringify({ answer: "₹150 in scope.", followUps: [] });
    const withSplit = await askLedger(sdb, "How much?", { month: "2026-10", categories: ["expense:Food"], card: "4242" });
    assert.equal(withSplit.ok && withSplit.rows[0]?.value, 150, "split row counts only its Food part");
    // Card digits typed into category or merchant never reach the model.
    await askLedger(sdb, "How much?", { month: "2026-10", category: "Visa 4242", merchant: "4242" });
    assert.ok(bodies.every((b) => !b.includes("4242")), "4-digit runs in scope labels are dropped");
    assert.equal(describeScope({}), null);
    assert.deepEqual(describeScope({ merchant: "pay@okaxis", min: 10 }), { merchant: "[private payee]", amount: "an amount range" });
  } finally {
    mock.timers.reset(); globalThis.fetch = savedFetch;
    if (savedAi === undefined) delete process.env.KHARCHA_AI; else process.env.KHARCHA_AI = savedAi;
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedKey;
  }
}

console.log("ai checks passed");
