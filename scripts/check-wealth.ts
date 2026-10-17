import assert from "node:assert/strict";
import { nextDue } from "../src/server/plan/jobs.ts";
import { amfiLine, mfapiNav, navDate, runPrices } from "../src/server/wealth/jobs.ts";
import { openDb } from "../src/server/db/client.ts";
import { holdings, prices } from "../src/server/db/schema.ts";
import { isNotFutureDateInIST, navDayChange, snapshotDate, valueHolding } from "../src/server/wealth/fns.ts";
import { realDay, xirr } from "../src/server/wealth/xirr.ts";
import { holdingCsvRows } from "../src/lib/csv.ts";

const rate = xirr([{ date: "2026-01-01", amount: -1000 }, { date: "2027-01-01", amount: 1100 }]);
assert(rate && Math.abs(rate - 0.1) < 0.002, `Expected 10%, got ${rate}`);
assert.equal(xirr([{ date: "bad", amount: -1000 }, { date: "2027-01-01", amount: 1100 }]), null);
assert.equal(realDay("2026-02-30"), false);
assert.equal(nextDue("2026-01-31", "monthly", 31), "2026-02-28");
assert.equal(nextDue("2026-01-01", "weekly"), "2026-01-08");
assert.deepEqual(holdingCsvRows('\uFEFFdate,fund,amount,units,nav\n2026-01-05,"HDFC, Growth ""Direct""",-1000,-10,100\n'), [["2026-01-05", 'HDFC, Growth "Direct"', "-1000", "-10", "100"]]);
assert.equal(navDate("15-Oct-2026"), "2026-10-15");
assert.equal(navDate("31-Feb-2026"), undefined);
assert.equal(mfapiNav({ data: [{ date: "15-Oct-2026", nav: "12.5" }] })?.nav, 12.5);
assert.equal(mfapiNav({ data: [{ date: "15-Oct-2026", nav: "Infinity" }] }), undefined);
assert.equal(amfiLine("123;isin;isin;Fund;Infinity;15-Oct-2026", "123"), undefined);
assert.equal(amfiLine("123;isin;isin;Fund;12.5;15-Oct-2026", "123")?.nav, 12.5);
const earlyIST = new Date("2026-10-15T20:00:00Z");
assert.equal(isNotFutureDateInIST("2026-10-16", earlyIST), true);
assert.equal(isNotFutureDateInIST("2026-10-17", earlyIST), false);
assert.equal(navDayChange([
  { date: "2026-10-14", units: 10 },
  { date: "2026-10-15", units: 2 },
  { date: "2026-10-15", units: -4 },
], "2026-10-14", 102, 100), 20);
assert.equal(navDayChange([{ date: "2026-10-15", units: 10 }], "2026-10-14", 110, 100), 0, "same-day purchase has no prior exposure");
assert.equal(navDayChange([{ date: "2026-10-13", units: 10 }, { date: "2026-10-14", units: -4 }], "2026-10-14", 110, 100), 60, "prior redemptions reduce exposure");
// Statement snapshot (synthetic): no buys, so value and basis come from the statement.
const snap = valueHolding({ manualValue: 110_000, manualInvested: 100_000 }, [], undefined);
assert.deepEqual([snap.value, snap.invested, snap.gain, snap.units, snap.dayChange], [110_000, 100_000, 10_000, 0, 0]);
assert.equal(valueHolding({ manualValue: 50_000, manualInvested: null }, [], undefined).gain, 0, "unknown basis never invents a gain");
assert.equal(valueHolding({ manualValue: null, manualInvested: 999 }, [{ date: "2026-10-01", amount: 1000, units: 10 }], { date: "2026-10-15", nav: 120, prev: null, prev_date: null }).gain, 200, "buy history overrides snapshot basis");
assert.equal(snapshotDate([{ manualValue: 1, manualValueDate: "2026-10-09" }, { manualValue: null, manualValueDate: "2026-12-01" }, { manualValue: 2, manualValueDate: "2026-09-01" }]), "2026-10-09");
const savedFetch = globalThis.fetch;
try {
  for (const failure of ["network", "json"]) {
    const db = openDb(":memory:"); let requests = 0;
    await db.insert(holdings).values({ name: "Synthetic fund", kind: "fund", schemeCode: "123" });
    globalThis.fetch = async (input) => {
      requests++;
      if (String(input).includes("api.mfapi.in")) {
        if (failure === "network") throw new Error("synthetic network failure");
        return new Response("invalid json");
      }
      return new Response("123;isin;isin;Fund;12.5;15-Oct-2026");
    };
    assert.equal((await runPrices(db)).updated, 1, `${failure} failure falls back to AMFI`);
    assert.equal(requests, 2);
    assert.equal((await db.select().from(prices).get())?.source, "amfi");
  }
} finally { globalThis.fetch = savedFetch; }
console.log("wealth checks passed");
