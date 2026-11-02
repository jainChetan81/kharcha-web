import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createServerFn } from "@tanstack/react-start";
import { and, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "../db/client.ts";
import { holdingTxns, holdings, prices } from "../db/schema.ts";
import { navDate } from "./jobs.ts";

// CAMS/KFintech "Detailed" CAS, read from `pdftotext -layout` text.
// Line shapes follow casparser (MIT, github.com/codereverser/casparser).

export type CasTxn = { date: string; amount: number; units: number; nav: number };
export type CasScheme = { name: string; isin: string; opening: number; closing: number; nav: number | null; navDate: string | null; txns: CasTxn[] };

const DATE = String.raw`\d{2}-[A-Za-z]{3}-\d{4}`;
const NUM = String.raw`\(?-?[\d,]+\.\d+\)?`;
const ISIN = /ISIN\s*:\s*(INF[A-Z0-9]{9})/i;
const TXN = new RegExp(String.raw`^\s*(${DATE})\s+(.+?)\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s*$`);
const STAMP = new RegExp(String.raw`^\s*(${DATE})\s+\**\s*Stamp Duty\s*\**\s+(${NUM})\s*$`, "i");
const num = (value: string) => (value.startsWith("(") ? -1 : 1) * Number(value.replace(/[(),]/g, ""));

/** Parse CAS text into schemes. Rows without units (stamp duty, dividend payout, notes) carry no units. */
export function parseCasText(text: string): CasScheme[] {
  const schemes: CasScheme[] = []; let current: CasScheme | undefined; let previous = "";
  for (const line of text.split(/\r?\n/)) {
    const isin = line.match(ISIN);
    if (isin) {
      // "B205RGDG-Fund Name Direct Growth - ISIN: INF..." ; the name may sit on the previous line.
      const head = line.slice(0, isin.index).replace(/[-\s]+$/, "").trim() || previous;
      current = { name: head.replace(/^[A-Z0-9]+-/, "").replace(/\s{2,}/g, " ").trim(), isin: isin[1]!.toUpperCase(), opening: 0, closing: 0, nav: null, navDate: null, txns: [] };
      schemes.push(current);
    } else if (current) {
      const opening = line.match(/Opening Unit Balance\s*:\s*([\d,.]+)/i); if (opening) current.opening = num(opening[1]!);
      const closing = line.match(/Closing Unit Balance\s*:\s*([\d,.]+)/i); if (closing) current.closing = num(closing[1]!);
      const nav = line.match(new RegExp(String.raw`NAV on (${DATE})\s*:\s*INR\s*([\d,.]+)`, "i")); if (nav) { current.navDate = navDate(nav[1]) ?? null; current.nav = num(nav[2]!); }
      const stamp = line.match(STAMP); const row = stamp ? null : line.match(TXN);
      if (stamp) {
        // Stamp duty is part of the purchase cost; add it to that day's last buy.
        const last = current.txns.at(-1); if (last && last.date === navDate(stamp[1])) last.amount += Math.abs(num(stamp[2]!));
      } else if (row) {
        const date = navDate(row[1]); const amount = num(row[3]!); const units = num(row[4]!); const price = num(row[5]!);
        if (date && units !== 0 && price > 0) current.txns.push({ date, amount: Math.sign(units) * Math.abs(amount), units, nav: price });
      }
    }
    if (line.trim()) previous = line.trim();
  }
  // One fund held in several folios: merge so each ISIN becomes one holding.
  const byIsin = new Map<string, CasScheme>();
  for (const scheme of schemes) {
    const seen = byIsin.get(scheme.isin);
    if (!seen) { byIsin.set(scheme.isin, scheme); continue; }
    seen.opening += scheme.opening; seen.closing += scheme.closing; seen.txns.push(...scheme.txns);
    if ((scheme.navDate ?? "") > (seen.navDate ?? "")) { seen.nav = scheme.nav; seen.navDate = scheme.navDate; }
  }
  return [...byIsin.values()].map((scheme) => ({ ...scheme, txns: scheme.txns.sort((a, b) => a.date.localeCompare(b.date)) }));
}

/** Why a scheme cannot give exact units and cost, or null when it can. */
export function casProblem(scheme: CasScheme): string | null {
  if (scheme.opening > 0.0005) return "Statement starts after the first purchase. Request a CAS from inception.";
  const sum = scheme.txns.reduce((total, txn) => total + txn.units, 0);
  if (Math.abs(sum - scheme.closing) > 0.005) return "Units do not add up to the closing balance.";
  return null;
}

/** AMFI scheme code for an ISIN from NAVAll.txt (code;ISIN growth;ISIN reinvest;name;nav;date). */
export function amfiCodeForIsin(navAll: string, isin: string) {
  return navAll.split("\n").map((line) => line.split(";")).find((cols) => cols[1]?.trim() === isin || cols[2]?.trim() === isin)?.[0]?.trim() ?? null;
}

const execFileAsync = promisify(execFile);
/** Decrypt and extract text with poppler's pdftotext; no shell. The file is deleted at once and the password never stored. */
export async function casPdfText(bytes: Uint8Array, password: string): Promise<string> {
  const file = path.join(tmpdir(), `cas-${randomUUID()}.pdf`);
  await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
  try {
    // ponytail: password passes via argv (visible to `ps` inside this single-app container); poppler has no stdin password option.
    const { stdout } = await execFileAsync("pdftotext", ["-layout", "-enc", "UTF-8", ...(password ? ["-upw", password] : []), file, "-"], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024, killSignal: "SIGKILL" });
    return stdout;
  } catch (error) {
    const detail = String((error as { stderr?: string }).stderr ?? "");
    if (/password/i.test(detail)) throw new Error("Wrong PDF password. CAS passwords are usually your PAN in capitals.");
    if ((error as { code?: string }).code === "ENOENT") throw new Error("PDF reading is not installed on the server (pdftotext).");
    throw new Error("Couldn't read this PDF.");
  } finally {
    await rm(file, { force: true });
  }
}

const MAX_PDF = 10 * 1024 * 1024;
export type CasResult = { imported: { name: string; txns: number; units: number }[]; skipped: { name: string; reason: string }[] };

/** NAV history from MFAPI (all dates); failures give an empty list. */
async function navHistory(code: string, from: string) {
  try {
    const response = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(20_000) });
    const body = await response.json() as { data?: { date?: string; nav?: string }[] };
    return (body.data ?? []).map((row) => ({ date: navDate(row.date), nav: Number(row.nav) })).filter((row): row is { date: string; nav: number } => !!row.date && row.date >= from && Number.isFinite(row.nav) && row.nav > 0);
  } catch { return []; }
}

/** Replace a CAS-covered holding's history with exact units, then switch it from statement value to live NAV. */
export async function applyCas(db: Db, schemes: CasScheme[], navAll: string): Promise<CasResult> {
  const result: CasResult = { imported: [], skipped: [] };
  const all = await db.select().from(holdings);
  for (const scheme of schemes) {
    const problem = casProblem(scheme); if (problem) { result.skipped.push({ name: scheme.name, reason: problem }); continue; }
    const code = amfiCodeForIsin(navAll, scheme.isin); if (!code) { result.skipped.push({ name: scheme.name, reason: "ISIN not in the AMFI list." }); continue; }
    let holding = all.find((row) => row.schemeCode === code) ?? all.find((row) => row.name.toLowerCase() === scheme.name.toLowerCase());
    if (!holding) { [holding] = await db.insert(holdings).values({ name: scheme.name.slice(0, 120), kind: "fund", assetClass: "Mutual funds", schemeCode: code }).returning(); all.push(holding!); }
    const id = holding!.id; const cutoff = scheme.navDate ?? scheme.txns.at(-1)?.date ?? "9999-12-31";
    const history = await navHistory(code, scheme.txns[0]?.date ?? cutoff);
    const ops = [
      // SMS-linked buys up to the statement date are inside the CAS already; later ones stay.
      db.delete(holdingTxns).where(and(eq(holdingTxns.holdingId, id), lte(holdingTxns.date, cutoff))),
      ...scheme.txns.map((txn) => db.insert(holdingTxns).values({ holdingId: id, date: txn.date, amount: txn.amount, units: txn.units, nav: txn.nav, source: "cas" })),
      ...history.map((row) => db.insert(prices).values({ schemeCode: code, date: row.date, nav: row.nav, source: "mfapi" }).onConflictDoNothing()),
      ...(scheme.nav && scheme.navDate ? [db.insert(prices).values({ schemeCode: code, date: scheme.navDate, nav: scheme.nav, source: "cas" }).onConflictDoNothing()] : []),
      db.update(holdings).set({ schemeCode: code, manualValue: null, manualValueDate: null, manualInvested: null, isClosed: scheme.closing <= 0.0005 }).where(eq(holdings.id, id)),
    ];
    await db.batch(ops as [typeof ops[number], ...typeof ops[number][]]);
    result.imported.push({ name: holding!.name, txns: scheme.txns.length, units: scheme.closing });
  }
  return result;
}

export const importCas = createServerFn({ method: "POST" })
  .validator(z.object({ base64: z.string().min(1).max(Math.ceil(MAX_PDF * 4 / 3) + 8), password: z.string().max(64) }))
  .handler(async ({ data }): Promise<CasResult> => {
    const bytes = Uint8Array.from(Buffer.from(data.base64, "base64"));
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") throw new Error("Not a PDF.");
    const schemes = parseCasText(await casPdfText(bytes, data.password));
    if (!schemes.length) throw new Error("No funds found. Use the CAMS/KFintech Detailed CAS (not Summary).");
    let navAll: string;
    try { navAll = await (await fetch("https://www.amfiindia.com/spages/NAVAll.txt", { signal: AbortSignal.timeout(20_000) })).text(); } catch { throw new Error("Couldn't reach AMFI to match funds. Try again later."); }
    return applyCas(getDb(), schemes, navAll);
  });
