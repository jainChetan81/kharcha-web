import assert from "node:assert/strict";
import { nextDue } from "../src/server/plan/jobs.ts";
import { amfiLine, mfapiNav, navDate, runPrices } from "../src/server/wealth/jobs.ts";
import { openDb } from "../src/server/db/client.ts";
import { holdingTxns, holdings, prices } from "../src/server/db/schema.ts";
import { amfiCodeForIsin, applyCas, casProblem, parseCasText } from "../src/server/wealth/cas.ts";
import { isNotFutureDateInIST, navDayChange, nextSipDate, snapshotDate, valueHolding } from "../src/server/wealth/fns.ts";
import { realDay, xirr } from "../src/server/wealth/xirr.ts";
import { holdingCsvRows } from "../src/lib/csv.ts";

const rate = xirr([{ date: "2026-01-01", amount: -1000 }, { date: "2027-01-01", amount: 1100 }]);
assert(rate && Math.abs(rate - 0.1) < 0.002, `Expected 10%, got ${rate}`);
assert.equal(xirr([{ date: "bad", amount: -1000 }, { date: "2027-01-01", amount: 1100 }]), null);
assert.equal(realDay("2026-02-30"), false);
assert.equal(nextDue("2026-01-31", "monthly", 31), "2026-02-28");
assert.equal(nextDue("2026-01-01", "weekly"), "2026-01-08");
assert.equal(nextSipDate(5, new Date("2026-10-17T00:00:00Z")), "2026-11-05", "SIP date uses IST day");
assert.equal(nextSipDate(31, new Date("2026-02-01T00:00:00Z")), "2026-02-28", "SIP date clamps to month end");
assert.equal(nextSipDate(17, new Date("2026-10-17T00:00:00Z")), "2026-10-17", "today's SIP remains upcoming");
assert.equal(nextSipDate(17, new Date("2026-10-17T20:00:00Z")), "2026-11-17", "passed IST day advances to next month");
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

// CAS import (synthetic statement text in `pdftotext -layout` shape).
const casText = `
Folio No: 1234567 / 89          PAN: ABCDE1234F   KYC: OK  PAN: OK
B205RGDG-Synthetic Index Fund - Direct Plan Growth - ISIN: INF000A01AB2(Advisor: DIRECT)   Registrar : CAMS
Opening Unit Balance: 0.000
05-Jan-2026    Purchase - Systematic              4,999.75        49.998        100.0000        49.998
05-Jan-2026    *** Stamp Duty ***                     0.25
05-Feb-2026    Purchase - Systematic              4,999.75        45.452        110.0000        95.450
10-Mar-2026    Redemption                        (2,400.00)       (20.000)        120.0000        75.450
Closing Unit Balance: 75.450     NAV on 31-Oct-2026: INR 125.0000     Total Cost Value: 7,600.00
Folio No: 7654321
Synthetic Index Fund - Direct Plan Growth
- ISIN: INF000A01AB2
Opening Unit Balance: 0.000
01-Apr-2026    Purchase                           1,000.00        10.000        100.0000        10.000
Closing Unit Balance: 10.000     NAV on 31-Oct-2026: INR 125.0000
Folio No: 1111111
B9-Synthetic Debt Fund - ISIN: INF000B01CD3
Opening Unit Balance: 12.000
Closing Unit Balance: 12.000     NAV on 31-Oct-2026: INR 30.0000
`;
const [index, debt] = parseCasText(casText);
assert.equal(index?.name, "Synthetic Index Fund - Direct Plan Growth");
assert.equal(index?.txns.length, 4, "two folios of one ISIN merge");
assert.deepEqual(index?.txns[0], { date: "2026-01-05", amount: 5000, units: 49.998, nav: 100 }, "stamp duty joins the buy");
assert.equal(index?.txns[2]?.amount, -2400, "redemption is negative");
assert.equal(index?.closing, 85.45);
assert.equal(casProblem(index!), null);
assert.match(casProblem(debt!) ?? "", /inception/);
assert.equal(amfiCodeForIsin("999;INF000A01AB2;-;Synthetic;125;31-Oct-2026", "INF000A01AB2"), "999");
{
  const db = openDb(":memory:");
  const [old] = await db.insert(holdings).values({ name: "Index fund", kind: "fund", schemeCode: "999", manualValue: 9000, manualValueDate: "2026-09-30", manualInvested: 8000 }).returning();
  await db.insert(holdingTxns).values([{ holdingId: old!.id, date: "2026-01-05", amount: 5000, source: "sms" }, { holdingId: old!.id, date: "2026-11-05", amount: 5000, source: "sms" }]);
  globalThis.fetch = async () => new Response("{}");
  try {
    const result = await applyCas(db, [index!, debt!], "999;INF000A01AB2;-;Synthetic;125;31-Oct-2026");
    assert.equal(result.imported.length, 1); assert.equal(result.skipped.length, 1);
  } finally { globalThis.fetch = savedFetch; }
  const after = await db.select().from(holdings).get();
  assert.deepEqual([after?.manualValue, after?.manualValueDate, after?.manualInvested], [null, null, null], "CAS clears the statement value");
  const txns = await db.select().from(holdingTxns);
  assert.equal(txns.length, 5, "4 CAS rows replace pre-statement buys; the later SMS buy stays");
  const live = valueHolding(after!, txns, { date: "2026-10-31", nav: 125, prev: null, prev_date: null });
  assert.equal(Math.round(live.value), Math.round(85.45 * 125), "value is units × NAV");
}
console.log("wealth checks passed");
