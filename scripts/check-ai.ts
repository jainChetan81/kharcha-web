import assert from "node:assert/strict";
import { mock } from "node:test";
import { eq } from "drizzle-orm";
import { askSpecSchema, figuresMatchRows, redact, scrub } from "../src/server/ai/ask.ts";
import { openDb } from "../src/server/db/client.ts";
import { digests, insights, transactions } from "../src/server/db/schema.ts";
import { callOpenRouter } from "../src/server/ai/client.ts";
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
assert.equal(scrub("Visa 1234 5678 9012 3456"), "[private payee]");
assert.equal(scrub("Visa 1234-5678-9012-3456"), "[private payee]");
assert.equal(scrub("Visa 1234.5678.9012.3456"), "[private payee]");
assert.equal(redact("Paid card 1234.5678.9012.3456"), "Paid card [number]");
assert.equal(redact("Paid ravi@okhdfc from card 4111 1111 1111 1111 on 12 Oct"), "Paid [private] from card [number] on 12 Oct");
assert.equal(figuresMatchRows("You spent 120000 rupees", [{ value: 900 }]), false);
assert.equal(figuresMatchRows("Rs. 900 and INR 900", [{ value: 900 }]), true);
assert.equal(validDigestLines([{ pre: "", num: "42 rows", post: "", factKey: "backlog" }, { pre: "", num: "Food ₹900", post: "", factKey: "category" }, { pre: "", num: "Shop at 40%", post: "", factKey: "merchant" }], { backlog: "42 rows", category: "Food ₹900", merchant: "Shop at 40%" }), true);
assert.equal(validDigestLines([{ pre: "Spent ₹5,000 ", num: "42 rows", post: "", factKey: "backlog" }, { pre: "", num: "Food ₹900", post: "", factKey: "category" }, { pre: "", num: "Shop at 40%", post: "", factKey: "merchant" }], { backlog: "42 rows", category: "Food ₹900", merchant: "Shop at 40%" }), false);

const db = openDb(":memory:");
const now = new Date();
const date = (days: number) => new Date(now.getTime() - days * 864e5).toISOString().slice(0, 10);
for (let week = 1; week <= 8; week++) await db.insert(transactions).values({ source: "manual", type: "expense", amount: 100, merchant: "Test store", category: "Food", date: `${date(week * 7)} 12:00` });
await db.insert(transactions).values({ source: "manual", type: "expense", amount: 300, merchant: "Test store", category: "Food", date: `${date(1)} 12:00` });
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
console.log("ai checks passed");
