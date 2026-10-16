// Synthetic dev data for .data/kharcha.db (never real exports). Run: npm run seed:dev
import { rmSync } from "node:fs";
import { openDb } from "../src/server/db/client.ts";
import { ingest, setBudget } from "../src/server/db/queries.ts";

rmSync(".data/kharcha.db", { force: true });
rmSync(".data/kharcha.db-wal", { force: true });
rmSync(".data/kharcha.db-shm", { force: true });
const db = openDb(".data/kharcha.db");

const merchants: [string, string | null, number, string, string][] = [
  ["SWIGGY INSTAMART", "Swiggy Instamart", 220, "Food", "2047"],
  ["SWIGGY E COM", "Swiggy", 460, "Food", "2047"],
  ["BLINKIT", "Blinkit", 840, "Utilities", "0532"],
  ["FLIPKAR", null, 1800, "Shopping", "3266"],
  ["UBER INDIA", "Uber", 310, "Transport", "2047"],
  ["NETFLIX", "Netflix", 649, "Entertainment", "3266"],
  ["APOLLO PHARMACY", "Apollo Pharmacy", 540, "Health", "0532"],
  ["METAPAY* SZ9LV96VF4", null, 203, "", "2047"],
  ["OPENROUTER INC", null, 4304, "", "3266"],
  ["DECATHLON", "Decathlon", 1999, "Sports", "0532"],
];
const rows = [];
let id = 1;
const now = new Date();
for (let back = 0; back < 180; back++) {
  const d = new Date(now.getTime() - back * 864e5);
  const ymd = d.toISOString().slice(0, 10);
  const perDay = 1 + ((back * 7) % 3);
  for (let k = 0; k < perDay; k++) {
    const [m, canon, base, cat, card] = merchants[(back * 3 + k * 5) % merchants.length];
    const amount = Math.round(base * (0.6 + ((back * 13 + k * 7) % 9) / 10));
    rows.push({
      id: id++, type: "expense" as const, amount, merchant: m, merchantCanonical: canon, category: cat || null,
      date: `${ymd} ${String(9 + ((k * 5 + back) % 12)).padStart(2, "0")}:${String((back * 7) % 60).padStart(2, "0")}`,
      rawText: `Rs.${amount}.00 spent on card xx${card} at ${m} on ${ymd}.`, senderId: "AXISBK", parsedBy: "regex",
      accountLast4: card, bankName: "Axis Bank", needsReview: back < 20 && !cat ? 1 : 0, deletedAt: null,
    });
  }
  if (d.getDate() === 1)
    rows.push({ id: id++, type: "income" as const, amount: 142000, merchant: "SALARY ACME", merchantCanonical: "Salary", category: "Salary", date: `${ymd} 09:00`, rawText: "Salary credited", parsedBy: "regex", needsReview: 0, deletedAt: null });
  if (d.getDate() === 20)
    rows.push({ id: id++, type: "investment" as const, amount: 10000, merchant: "NIFTY 50 INDEX SIP", merchantCanonical: null, category: "Investment", date: `${ymd} 10:00`, rawText: "SIP debit Rs 10000 NIFTY 50 INDEX", parsedBy: "regex", accountLast4: "0532", needsReview: 0, deletedAt: null });
}
for (let i = 0; i < rows.length; i += 500) await ingest(db, rows.slice(i, i + 500));
for (const [category, monthlyLimit] of [["Food", 8000], ["Utilities", 2000], ["Shopping", 15000], ["Transport", 5000], ["Entertainment", 2000]] as const)
  await setBudget(db, { category, monthlyLimit });
console.log(`seeded ${rows.length} synthetic rows into .data/kharcha.db`);
