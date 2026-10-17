import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { ruleMatches } from "../db/queries.ts";
import { attachments, categories, merchantRules, receiptJobs, reimbursements, transactionItems, transactions } from "../db/schema.ts";
import { callOpenRouter } from "./client.ts";
import { callCostUsd } from "./pricing.ts";

const execFileAsync = promisify(execFile);

export type ReceiptError = "unreadable" | "not_receipt" | "ai_unavailable";
export const receiptSplitMatches = (amount: number, splits: { amount: number }[]) => splits.length > 0 && Math.abs(splits.reduce((sum, row) => sum + row.amount, 0) - amount) <= 0.01;

// 13–19 digits, optionally spaced or dashed; UPI handles look like name@bank.
const CARD_RUN = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;
const UPI_ID = /[\w.+-]+@[a-z]{2,}/gi;
const PRIVATE_RECEIPT_LINE = /\b(?:upi|vpa|card|a\s*\/\s*c|acct|account|ifsc|txn\s*id|ref\s*no|rrn|auth\s*code|approval|qr|scan\s+to\s+pay|pan)\b/i;

/** OCR one local image without invoking a shell. OCR output and errors stay local. */
export async function ocrImage(path: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("tesseract", [path, "stdout", "-l", "eng", "--psm", "6"], {
      timeout: 20_000,
      maxBuffer: 256 * 1024,
      killSignal: "SIGKILL",
    });
    return stdout;
  } catch {
    return null;
  }
}

/** Remove sensitive receipt lines and identifiers before text leaves this server. */
export function redactReceiptText(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !PRIVATE_RECEIPT_LINE.test(line))
    .join("\n")
    .replace(CARD_RUN, "[number]")
    .replace(/(?<![\d,.])\d{9,}(?![\d,.])/g, "[number]")
    .replace(UPI_ID, "[id]")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 8000);
}

/** Drop card-like digit runs and UPI handles from an item name before it is stored. */
export function scrubItemName(name: string): string {
  return name.replace(CARD_RUN, " ").replace(UPI_ID, " ").replace(/\s{2,}/g, " ").trim().slice(0, 120);
}

// Model output is untrusted: validate every field before it touches the DB.
export const receiptOutput = z.object({
  isReceipt: z.boolean(),
  total: z.number().nonnegative().nullable(),
  currency: z.string().max(5).nullable(),
  items: z
    .array(
      z.object({
        name: z.string().max(300),
        qty: z.number().positive().nullable(),
        amount: z.number().nonnegative(),
        confidence: z.number().min(0).max(1),
        category: z.string().max(40).nullish(),
      }),
    )
    .max(100),
});

// Item-name heuristics: first match wins, and only for categories the user still has.
const HINTS: [RegExp, string][] = [
  [/\b(milk|bread|eggs?|rice|atta|dal|paneer|curd|vegetables?|fruits?|onions?|tomato(es)?|biscuits?|chips|coffee|tea)\b/i, "Food"],
  [/\b(medicines?|tablets?|syrup|bandage|paracetamol|vitamins?)\b/i, "Health"],
  [/\b(shampoo|soap|detergent|tissues?|cleaner|toilet)\b/i, "Home"],
  [/\b(charger|cable|shirts?|shoes?|jeans)\b/i, "Shopping"],
];

type Rule = { match: string; category: string };

/** Order: merchant rule, item-name heuristic, model hint, then the transaction's own category. */
export function categorize(item: string, merchant: string, rules: Rule[], known: Set<string>, hint: string | null | undefined, fallback: string): string {
  const byRule = rules.find((rule) => known.has(rule.category) && ruleMatches(rule, merchant));
  if (byRule) return byRule.category;
  const byName = HINTS.find(([pattern, category]) => pattern.test(item) && known.has(category));
  if (byName) return byName[1];
  if (hint && known.has(hint)) return hint;
  return fallback;
}

const prompt = (names: string[]) =>
  [
    "Read the receipt text below (OCR, may contain errors) as one order.",
    'Return only JSON: {"isReceipt": boolean, "total": number|null, "currency": string|null, "items": [{"name": string, "qty": number|null, "amount": number, "confidence": number between 0 and 1, "category": string}]}.',
    "Set isReceipt to false if the text is not a receipt or bill.",
    "Give low confidence for lines the OCR may have garbled.",
    "Never write card numbers, account numbers or UPI IDs into names.",
    `Category must be one of: ${names.join(", ")}. Omit it if none fits.`,
  ].join("\n");

const now = () => new Date().toISOString();

/** Run one local OCR read for a transaction and store its AI items. Job row records the outcome. */
export async function runReceiptJob(db: Db, jobId: number, transactionId: number, ocr = ocrImage): Promise<void> {
  const setJob = (values: Partial<typeof receiptJobs.$inferInsert>) => db.update(receiptJobs).set(values).where(eq(receiptJobs.id, jobId));
  const fail = async (error: ReceiptError): Promise<void> => { await setJob({ status: "failed", error, finishedAt: now() }); };
  await setJob({ status: "reading", startedAt: now() });

  const [txn, files, known, rules] = await Promise.all([
    db.select().from(transactions).where(and(eq(transactions.id, transactionId), isNull(transactions.deletedAt))).get(),
    db.select({ path: attachments.path, mime: attachments.mime }).from(attachments).where(eq(attachments.transactionId, transactionId)),
    db.select({ name: categories.name, type: categories.type }).from(categories),
    db.select({ match: merchantRules.match, category: merchantRules.category }).from(merchantRules).orderBy(desc(merchantRules.id)),
  ]);
  if (!txn) { await fail("unreadable"); return; }
  // PDFs are stored but not sent: OCR runs on images only.
  const images = files.filter((file) => file.mime !== "application/pdf").slice(0, 5);
  if (!images.length) { await fail("unreadable"); return; }

  // Pixels never leave the server: OCR locally, redact, send text only. No raw-image fallback.
  const texts: string[] = [];
  for (const image of images) {
    const raw = await ocr(image.path);
    if (raw !== null) texts.push(redactReceiptText(raw));
  }
  const text = texts.filter(Boolean).join("\n---\n");
  const words = text.match(/[a-z0-9]+/gi) ?? [];
  if (words.length < 3 || !/\d/.test(text)) { await fail("unreadable"); return; }

  const type = txn.type === "income" ? "income" : "expense";
  const names = new Set(known.filter((c) => c.type === type).map((c) => c.name));
  const reply = await callOpenRouter([{ role: "user", content: `${prompt([...names])}\n\nReceipt text:\n${text}` }], { db });
  if (!reply.ok) { await fail("ai_unavailable"); return; }
  let json: unknown;
  try {
    json = JSON.parse(reply.content);
  } catch {
    await fail("unreadable");
    return;
  }
  const parsed = receiptOutput.safeParse(json);
  if (!parsed.success) { await fail("unreadable"); return; }
  if (!parsed.data.isReceipt) { await fail("not_receipt"); return; }

  const fallback = txn.category && names.has(txn.category) ? txn.category : "Other";
  const rows = parsed.data.items
    .map((item, sortOrder) => {
      const name = scrubItemName(item.name);
      return {
        transactionId,
        name,
        qty: item.qty,
        amount: item.amount,
        category: categorize(name, txn.merchant, rules, names, item.category, fallback),
        source: "ai" as const,
        confidence: item.confidence,
        sortOrder,
      };
    })
    .filter((row) => row.name && row.amount > 0);

  const costUsd = await callCostUsd(db, reply.model, reply.tokensIn, reply.tokensOut, reply.costUsd);
  const provenance = { model: reply.model, tokensIn: reply.tokensIn, tokensOut: reply.tokensOut, costUsd };
  const itemClaim = await db.select({ id: reimbursements.id }).from(reimbursements)
    .where(and(eq(reimbursements.transactionId, transactionId), sql`${reimbursements.itemIds} IS NOT NULL`, sql`${reimbursements.status} != 'cancelled'`)).get();
  // Keep this successful read in the job log, but do not replace IDs used by an item claim.
  if (itemClaim) { await setJob({ ...provenance, status: "done", finishedAt: now() }); return; }

  // Re-read replaces only AI rows; manual rows stay.
  const operations = [
    db.delete(transactionItems).where(and(eq(transactionItems.transactionId, transactionId), eq(transactionItems.source, "ai"))),
    ...(rows.length ? [db.insert(transactionItems).values(rows)] : []),
    setJob({ ...provenance, status: "done", finishedAt: now() }),
  ];
  await db.batch(operations as [typeof operations[number], ...typeof operations[number][]]);
}
