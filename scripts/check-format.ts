// Self-check for src/lib/format.ts (DESIGN.md §4). Run: npm run check:format
import assert from "node:assert/strict";
import {
  ago, aiCost, card, compact, dayMonth, evalAmount, foreign, fromSource, money, monthName, navsOf, overOrLeft, rangeLabel, shiftMonth, shortDate, signed, statementOf, time, weekday, weekdayDate,
} from "../src/lib/format.ts";

assert.equal(money(123450), "₹1,23,450");
assert.equal(money(219), "₹219");
assert.equal(money(219.5), "₹219.50");
assert.equal(money(219.004), "₹219");
assert.equal(compact(123450), "1.2L");
assert.equal(compact(45000), "45K");
assert.equal(signed(85000), "+₹85,000");
assert.equal(overOrLeft(5088, 2000), "₹3,088 over");
assert.equal(overOrLeft(47854, 50000), "₹2,146 left");
assert.equal(foreign("USD", 12.99, 1143), "$12.99 · ₹1,143");
assert.equal(foreign(null, null, 1143), "₹1,143");
assert.equal(card("2047"), "••2047");
assert.equal(weekdayDate("2026-10-15"), "Thu 15 Oct");
assert.equal(shortDate("2026-10-15 14:44"), "15 Oct, 2:44 PM");
assert.equal(time("2026-10-15 00:05"), "12:05 AM");
assert.equal(time("2026-10-15 12:00"), "12:00 PM");
assert.equal(time(new Date(2026, 9, 15, 23, 58)), "11:58 PM");
assert.equal(weekday("2026-10-15"), "Thu");
assert.equal(monthName("2026-10", "short"), "Oct");
assert.equal(dayMonth("2026-09-24"), "24 Sept");
assert.equal(navsOf("2026-10-15"), "NAVs of 15 Oct");
assert.equal(statementOf("2026-10-09"), "Statement of 9 Oct");
assert.equal(shiftMonth("2026-12", 1), "2027-01");
assert.equal(rangeLabel("2026-10-01", "2026-10-15"), "1–15 Oct");
assert.equal(rangeLabel("2026-09-29", "2026-10-03"), "29 Sept–3 Oct");
assert.equal(rangeLabel("2025-12-29", "2026-01-03"), "29 Dec 2025–3 Jan 2026");
assert.equal(ago(new Date(Date.now() - 3 * 60000).toISOString()), "3 min ago");
assert.equal(ago(new Date().toISOString()), "just now");
assert.equal(ago("2026-10-17 14:42:40", Date.parse("2026-10-17T14:45:40Z")), "3 min ago");
assert.equal(evalAmount("450+120"), 570);
assert.equal(evalAmount("450+120-20.5"), 549.5);
assert.equal(evalAmount("4++5"), undefined);
assert.equal(evalAmount(""), undefined);
assert.equal(fromSource("sms", "2026-10-18 19:47"), "From SMS · 18 Oct, 7:47 PM");

// Dates, times and numbers are formatted only in src/lib/format.ts.
const { readdirSync, readFileSync } = await import("node:fs");
const banned = /toLocale(Date|Time)?String\(|\.slice\(11, ?16\)/;
const offenders = (readdirSync("src", { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f) && !f.endsWith("lib/format.ts"))
  .filter((f) => banned.test(readFileSync(`src/${f}`, "utf8")));
assert.deepEqual(offenders, [], "format dates, times and numbers via src/lib/format.ts");
console.log("check-format: ok");
assert.equal(aiCost(0), money(0));

// Activity filter helpers (src/lib/filters.ts, §16).
{
  const { countFor, preset, presetOn, today } = await import("../src/lib/filters.ts");
  const now = today();
  assert.deepEqual(preset("This month"), { from: undefined, to: undefined, month: now.slice(0, 7) });
  assert.equal(preset("Last month").month, shiftMonth(now.slice(0, 7), -1));
  assert.deepEqual(preset("Today"), { from: now, to: now, month: undefined });
  assert.ok(presetOn({ month: now.slice(0, 7) }, "This month"));
  assert.ok(!presetOn({ month: now.slice(0, 7), from: now, to: now }, "This month"));
  assert.ok(presetOn({ from: now, to: now }, "Today"));
  assert.ok(!presetOn({}, "Today"));
  assert.equal(countFor({ month: "2026-10" }), 0);
  assert.equal(countFor({ from: "2026-10-01", to: "2026-10-05", categories: ["Food", "Travel"], status: ["review", "split"], min: 100 }), 6);
  assert.equal(countFor({ review: true, status: ["review"] }), 1);
  assert.equal(countFor({ review: true }), 1);
  assert.equal(countFor({ sort: "oldest" }), 1);
  assert.equal(countFor({ sort: "oldest" }, false), 0);
  assert.equal(countFor({ sort: "newest" }), 0);
}
