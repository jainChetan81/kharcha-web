import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import path from "node:path";
import { and, count, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { attachments, transactions } from "../db/schema";

const MAX_ATTACHMENTS = 5;
const MAX_BYTES = 8 * 1024 * 1024;
const MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
type ReceiptMime = (typeof MIME_TYPES)[number];

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function isReceiptMime(mime: string, bytes: Uint8Array): mime is ReceiptMime {
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
  if (mime === "image/webp") return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
  return mime === "application/pdf" && ascii(bytes, 0, 5) === "%PDF-";
}

/** Store one validated receipt file outside the public tree and associate it with a transaction. */
async function storeReceiptFile(transactionId: number, mime: string, bytes: Uint8Array): Promise<number> {
  if (!Number.isSafeInteger(transactionId) || transactionId < 1) throw new Error("Invalid transaction id.");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES || !isReceiptMime(mime, bytes))
    throw new Error("Unsupported receipt file.");

  const db = getDb();
  const [txn, attachmentCount] = await Promise.all([
    db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.id, transactionId), isNull(transactions.deletedAt))).get(),
    db.select({ count: count() }).from(attachments).where(eq(attachments.transactionId, transactionId)).get(),
  ]);
  if (!txn) throw new Error("Transaction not found.");
  if ((attachmentCount?.count ?? 0) >= MAX_ATTACHMENTS) throw new Error("A receipt can have at most five files.");

  const directory = path.resolve(process.env.STATE_DIRECTORY ?? ".data", "attachments");
  const filename = `${randomUUID()}.${mime === "application/pdf" ? "pdf" : mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp"}`;
  const filepath = path.join(directory, filename);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(filepath, bytes, { flag: "wx", mode: 0o600 });
  try {
    const [row] = await db.insert(attachments).values({ transactionId, path: filepath, mime, bytes: bytes.byteLength }).returning({ id: attachments.id });
    if (!row) throw new Error("Could not save receipt attachment.");
    // Concurrent uploads can both pass the pre-check; recount and drop our own row when over the cap.
    const after = await db.select({ count: count() }).from(attachments).where(eq(attachments.transactionId, transactionId)).get();
    if ((after?.count ?? 0) > MAX_ATTACHMENTS) {
      await db.delete(attachments).where(eq(attachments.id, row.id));
      throw new Error("A receipt can have at most five files.");
    }
    return row.id;
  } catch (error) {
    await rm(filepath, { force: true });
    throw error;
  }
}

// Keep manual item and split writes shared with the receipt editor.
export { saveReceipt } from "./fns";

export const uploadReceipt = createServerFn({ method: "POST" })
  .validator(
    z.object({
      transactionId: z.number().int().positive(),
      mime: z.enum(MIME_TYPES),
      base64: z.string().min(1).max(Math.ceil(MAX_BYTES * 4 / 3) + 8),
    }),
  )
  .handler(async ({ data }) => {
    const bytes = Uint8Array.from(Buffer.from(data.base64, "base64"));
    const id = await storeReceiptFile(data.transactionId, data.mime, bytes);
    return { id };
  });

