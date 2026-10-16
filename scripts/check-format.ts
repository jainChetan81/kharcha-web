// Self-check for src/lib/format.ts (DESIGN.md §4). Run: npm run check:format
import assert from "node:assert/strict";
import {
  ago, card, compact, dayMonth, evalAmount, foreign, money, navsOf, overOrLeft, shiftMonth, shortDate, signed, weekdayDate,
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
assert.equal(shortDate("2026-10-15 14:44"), "15 Oct, 14:44");
assert.equal(dayMonth("2026-09-24"), "24 Sept");
assert.equal(navsOf("2026-10-15"), "NAVs of 15 Oct");
assert.equal(shiftMonth("2026-12", 1), "2027-01");
assert.equal(ago(new Date(Date.now() - 3 * 60000).toISOString()), "3 min ago");
assert.equal(evalAmount("450+120"), 570);
assert.equal(evalAmount("450+120-20.5"), 549.5);
assert.equal(evalAmount("4++5"), undefined);
assert.equal(evalAmount(""), undefined);
console.log("check-format: ok");
