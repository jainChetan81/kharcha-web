import assert from "node:assert/strict";
import { nextDue } from "../src/server/plan/jobs.ts";
import { xirr } from "../src/server/wealth/xirr.ts";
import { holdingCsvRows } from "../src/lib/csv.ts";

const rate = xirr([{ date: "2026-01-01", amount: -1000 }, { date: "2027-01-01", amount: 1100 }]);
assert(rate && Math.abs(rate - 0.1) < 0.002, `Expected 10%, got ${rate}`);
assert.equal(nextDue("2026-01-31", "monthly", 31), "2026-02-28");
assert.equal(nextDue("2026-01-01", "weekly"), "2026-01-08");
assert.deepEqual(holdingCsvRows('\uFEFFdate,fund,amount,units,nav\n2026-01-05,"HDFC, Growth ""Direct""",-1000,-10,100\n'), [["2026-01-05", 'HDFC, Growth "Direct"', "-1000", "-10", "100"]]);
console.log("wealth checks passed");
