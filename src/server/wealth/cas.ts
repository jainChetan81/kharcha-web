import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServerFn } from "@tanstack/react-start";
import { and, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "../db/client.ts";
import { holdingTxns, holdings, prices } from "../db/schema.ts";
import { navDate } from "./jobs.ts";
import { realDay } from "./xirr.ts";

// CAS PDFs are read by casparser (MIT, github.com/codereverser/casparser) via scripts/cas-to-json.py.

export type CasTxn = { date: string; amount: number; units: number; nav: number };
export type CasScheme = { name: string; isin: string; amfi: string | null; opening: number; closing: number; closingCalculated: number; nav: number | null; navDate: string | null; txns: CasTxn[] };
type RawTxn = { date: string; type: string; amount: string | null; units: string | null; nav: string | null };
type RawScheme = { scheme: string; isin: string | null; amfi: string | null; open: string; close: string; close_calculated: string; valuation: { date: string; nav: string }; transactions: RawTxn[] };
export type CasJson = { cas_type: string; folios: { schemes: RawScheme[] }[] };

const n = (value: string | null | undefined) => Number(value ?? 0);
/** casparser JSON to one scheme per ISIN (a fund held in several folios merges). Rows without units only add stamp duty to that day's buy. */
export function casSchemes(json: CasJson): CasScheme[] {
  const byIsin = new Map<string, CasScheme>();
  for (const raw of json.folios.flatMap((folio) => folio.schemes)) {
    if (!raw.isin) continue;
    const txns: CasTxn[] = [];
    for (const row of raw.transactions) {
      const units = n(row.units); const nav = n(row.nav);
      if (row.type === "STAMP_DUTY_TAX") { const last = txns.at(-1); if (last?.date === row.date && last.units > 0) last.amount += Math.abs(n(row.amount)); continue; }
      if (!units || !realDay(row.date)) continue;
      // Gifts and mergers can carry no amount: value them at their NAV.
      const amount = row.amount == null ? units * nav : Math.abs(n(row.amount));
      txns.push({ date: row.date, amount: Math.sign(units) * amount, units, nav: nav > 0 ? nav : Math.abs(amount / units) });
    }
    const scheme: CasScheme = { name: raw.scheme.replace(/\s{2,}/g, " ").trim(), isin: raw.isin, amfi: raw.amfi, opening: n(raw.open), closing: n(raw.close), closingCalculated: n(raw.close_calculated), nav: n(raw.valuation.nav) || null, navDate: realDay(raw.valuation.date) ? raw.valuation.date : null, txns };
    const seen = byIsin.get(scheme.isin);
    if (!seen) { byIsin.set(scheme.isin, scheme); continue; }
    seen.opening += scheme.opening; seen.closing += scheme.closing; seen.closingCalculated += scheme.closingCalculated; seen.txns.push(...scheme.txns); seen.amfi ??= scheme.amfi;
    if ((scheme.navDate ?? "") > (seen.navDate ?? "")) { seen.nav = scheme.nav; seen.navDate = scheme.navDate; }
  }
  return [...byIsin.values()].map((scheme) => ({ ...scheme, txns: scheme.txns.sort((a, b) => a.date.localeCompare(b.date)) }));
}

/** Why a scheme cannot give exact units and cost, or null when it can. */
export function casProblem(scheme: CasScheme): string | null {
  if (scheme.opening > 0.0005) return "Statement starts after the first purchase. Request a CAS from inception.";
  const sum = scheme.txns.reduce((total, txn) => total + txn.units, 0);
  if (Math.abs(sum - scheme.closing) > 0.005 || Math.abs(scheme.closingCalculated - scheme.closing) > 0.005) return "Units do not add up to the closing balance.";
  if (!scheme.amfi) return "No AMFI scheme code for this ISIN.";
  return null;
}

const CAS_PYTHON = process.env.CAS_PYTHON ?? path.resolve(".cas/bin/python");
/** Run casparser on a temp copy; the password goes on stdin (not argv) and nothing is kept. */
async function readCasPdf(bytes: Uint8Array, password: string): Promise<CasJson> {
  const file = path.join(tmpdir(), `cas-${randomUUID()}.pdf`);
  await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
  try {
    const { code, stdout } = await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
      const child = spawn(CAS_PYTHON, ["-I", path.resolve("scripts/cas-to-json.py"), file], { stdio: ["pipe", "pipe", "ignore"], timeout: 60_000, killSignal: "SIGKILL" });
      let out = ""; child.stdout.setEncoding("utf8").on("data", (chunk: string) => { if (out.length < 16 * 1024 * 1024) out += chunk; });
      child.on("error", reject).on("close", (exit) => resolve({ code: exit, stdout: out }));
      child.stdin.end(`${password}\n`);
    }).catch((error: { code?: string }) => { throw new Error(error.code === "ENOENT" ? "CAS reading is not installed on the server (casparser)." : "Couldn't read this PDF."); });
    if (code === 2) throw new Error("Wrong PDF password. CAS passwords are usually your PAN in capitals.");
    if (code !== 0) throw new Error("Couldn't read this PDF as a CAS.");
    return JSON.parse(stdout) as CasJson;
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
export async function applyCas(db: Db, schemes: CasScheme[]): Promise<CasResult> {
  const result: CasResult = { imported: [], skipped: [] };
  const all = await db.select().from(holdings);
  for (const scheme of schemes) {
    const problem = casProblem(scheme); if (problem) { result.skipped.push({ name: scheme.name, reason: problem }); continue; }
    const code = scheme.amfi!;
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
    const json = await readCasPdf(bytes, data.password);
    if (json.cas_type !== "DETAILED") throw new Error("This is a Summary CAS. Request the Detailed CAS, from inception.");
    const schemes = casSchemes(json);
    if (!schemes.length) throw new Error("No mutual funds found in this CAS.");
    return applyCas(getDb(), schemes);
  });
