import { sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { TRANSFER_CATEGORY } from "../db/queries.ts";

const MON: Record<string, string> = {
  JAN: "01",
  FEB: "02",
  MAR: "03",
  APR: "04",
  MAY: "05",
  JUN: "06",
  JUL: "07",
  AUG: "08",
  SEP: "09",
  OCT: "10",
  NOV: "11",
  DEC: "12",
};
const num = (v: string) => Number(v.replace(/,/g, ""));

export function parseCardBill(text: string, sentAt: string): { amount: number | null; dueDate: string | null; issued: string } | null {
  const issued = sentAt.slice(0, 10);
  let m = text.match(/Payment of INR ([\d,.]+) for Axis Bank Credit Card .*?due on (\d{2})-(\d{2})-(\d{2})/is);
  if (m) return { amount: num(m[1]), dueDate: `20${m[4]}-${m[3]}-${m[2]}`, issued };
  m = text.match(/Amount Due Rs\.?\s*([\d,.]+) on HDFC Bank Credit Card .*?by (\d{2})\/([A-Z]{3})\/(\d{4})/is);
  if (m && MON[m[3].toUpperCase()]) return { amount: num(m[1]), dueDate: `${m[4]}-${MON[m[3].toUpperCase()]}-${m[2]}`, issued };
  m = text.match(/Statement: Total due: Rs\.?\s*([\d,.]+).*?Pay by (\d{2})-(\d{2})-(\d{4})/is);
  if (m) return { amount: num(m[1]), dueDate: `${m[4]}-${m[3]}-${m[2]}`, issued };
  if (/^Statement Generated/i.test(text.trim())) return { amount: null, dueDate: null, issued };
  return null;
}

/** Credit card spend vs payments, per card. A payment row (category Credit Card Payment, from the bank account)
 * is matched to a card by its "payment received" receipt: same amount within 3 days, receipt may be a tombstone. */
export async function cardBalances(db: Db, cards: readonly string[]) {
  const pays = await db.all<{ id: number; date: string; amount: number; card: string | null }>(sql`
    SELECT p.id, p.date, p.amount,
      (SELECT r.account_last4 FROM transactions r WHERE r.account_last4 IN (${sql.join(
        cards.map((c) => sql`${c}`),
        sql`, `,
      )})
        AND r.merchant LIKE '%Credit Card' AND abs(r.amount - p.amount) <= 50
        AND abs(julianday(substr(r.date, 1, 10)) - julianday(substr(p.date, 1, 10))) <= 3 LIMIT 1) AS card
    FROM transactions p WHERE p.deleted_at IS NULL AND p.category = ${TRANSFER_CATEGORY} ORDER BY p.date DESC`);
  return Promise.all(
    cards.map(async (card) => {
      const mine = pays.filter((p) => p.card === card);
      const last = mine[0] ?? null;
      const since = last?.date ?? "0000";
      const [row] = await db.all<{ spent: number | null; n: number }>(sql`
      SELECT SUM(amount) AS spent, COUNT(*) AS n FROM transactions
      WHERE deleted_at IS NULL AND duplicate_of IS NULL AND type = 'expense' AND account_last4 = ${card} AND date > ${since}`);
      const [refund] = await db.all<{ back: number | null }>(sql`
      SELECT SUM(amount) AS back FROM transactions
      WHERE deleted_at IS NULL AND type = 'income' AND category = 'Refunds' AND account_last4 = ${card} AND date > ${since}`);
      // Bill SMS arrive as ₹0 rows (tombstoned on ingest); their raw text still holds the bill.
      const notices = await db.all<{ date: string; raw_text: string }>(sql`
      SELECT date, raw_text FROM transactions WHERE amount = 0 AND raw_text LIKE ${`%${card}%`}
        AND (raw_text LIKE '%due%' OR raw_text LIKE 'Statement Generated%') AND raw_text NOT LIKE '%declined%' AND raw_text NOT LIKE '%OTP%' ORDER BY date DESC LIMIT 50`);
      const bill = notices.map((n) => parseCardBill(n.raw_text, n.date)).find((b) => b !== null) ?? null;
      return {
        card,
        owed: Math.round(((row?.spent ?? 0) - (refund?.back ?? 0)) * 100) / 100,
        spends: row?.n ?? 0,
        lastPayment: last ? { date: last.date, amount: last.amount } : null,
        payments: mine.slice(0, 6),
        bill,
      };
    }),
  );
}
