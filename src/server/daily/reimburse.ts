// Reimbursements server fns (DESIGN.md §15).
import { createServerFn } from "@tanstack/react-start";
import { and, count, desc, eq, gte, inArray, isNull, lt, ne, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.ts";
import { spendable } from "../db/queries.ts";
import {
  reimbursementLinks,
  reimbursements,
  transactionItems,
  transactions,
} from "../db/schema.ts";

const live = isNull(transactions.deletedAt);
const idSchema = z.object({ id: z.number().int().positive() });

/** Status derived from links: pending → partly → reimbursed / extra. Manual paid stays reimbursed until un-marked. */
export async function deriveClaimStatus(
  db: Awaited<ReturnType<typeof getDb>>,
  claim: { id: number; amount: number; status: string; manualPaid?: boolean },
): Promise<"pending" | "partly" | "reimbursed" | "extra" | "cancelled"> {
  if (claim.status === "cancelled") return "cancelled";
  if (claim.manualPaid) return "reimbursed";
  const [row] = await db
    .select({ total: sum(reimbursementLinks.amount).mapWith(Number) })
    .from(reimbursementLinks)
    .where(eq(reimbursementLinks.reimbursementId, claim.id));
  const linked = row?.total ?? 0;
  if (linked <= 0.005) return "pending";
  if (linked > claim.amount + 0.005) return "extra";
  if (linked >= claim.amount - 0.005) return "reimbursed";
  return "partly";
}

async function refreshClaimStatus(db: Awaited<ReturnType<typeof getDb>>, claimId: number) {
  const claim = await db
    .select({
      id: reimbursements.id,
      amount: reimbursements.amount,
      status: reimbursements.status,
      manualPaid: reimbursements.manualPaid,
    })
    .from(reimbursements)
    .where(eq(reimbursements.id, claimId))
    .get();
  if (!claim || claim.status === "cancelled" || claim.manualPaid) return;
  const status = await deriveClaimStatus(db, claim);
  const closed = status === "reimbursed" || status === "extra";
  await db
    .update(reimbursements)
    .set({ status, closedAt: closed ? sql`(datetime('now'))` : null })
    .where(eq(reimbursements.id, claimId));
}

const markSchema = z.object({
  transactionId: z.number().int().positive(),
  mode: z.enum(["full", "part", "items"]),
  amount: z.number().positive().optional(),
  itemIds: z.array(z.number().int().positive()).max(200).optional(),
  counterparty: z.string().trim().min(1).max(120),
  note: z.string().trim().max(300).optional(),
});

export const markReimbursable = createServerFn({ method: "POST" })
  .validator(markSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const txn = await db
      .select({ id: transactions.id, amount: transactions.amount })
      .from(transactions)
      .where(and(live, eq(transactions.id, data.transactionId), spendable))
      .get();
    if (!txn) throw new Error("Transaction not found or not an expense.");

    const existing = await db
      .select({ id: reimbursements.id })
      .from(reimbursements)
      .where(and(eq(reimbursements.transactionId, data.transactionId), ne(reimbursements.status, "cancelled")))
      .get();
    if (existing) throw new Error("Transaction already has an active reimbursement claim.");

    let claimAmount = 0;
    let storedItemIds: string | null = null;
    if (data.mode === "full") {
      claimAmount = txn.amount;
    } else if (data.mode === "part") {
      if (!data.amount || data.amount <= 0 || data.amount > txn.amount) {
        throw new Error("Part amount must be between ₹0 and the transaction amount.");
      }
      claimAmount = Math.round(data.amount * 100) / 100;
    } else if (data.mode === "items") {
      if (!data.itemIds?.length) throw new Error("Select at least one item.");
      const items = await db
        .select({ id: transactionItems.id, amount: transactionItems.amount })
        .from(transactionItems)
        .where(
          and(
            eq(transactionItems.transactionId, txn.id),
            inArray(transactionItems.id, data.itemIds),
          ),
        );
      if (items.length !== data.itemIds.length) {
        throw new Error("One or more selected items were not found.");
      }
      claimAmount = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
      storedItemIds = JSON.stringify(data.itemIds);
    }

    const [created] = await db
      .insert(reimbursements)
      .values({
        transactionId: txn.id,
        amount: claimAmount,
        counterparty: data.counterparty,
        note: data.note || null,
        status: "pending",
        itemIds: storedItemIds,
        manualPaid: false,
      })
      .returning({ id: reimbursements.id });
    return created?.id ?? 0;
  });

export const cancelReimbursement = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    await db
      .update(reimbursements)
      .set({ status: "cancelled", closedAt: sql`(datetime('now'))` })
      .where(eq(reimbursements.id, data.id));
    return { ok: true };
  });

export const undoCancelReimbursement = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const claim = await db
      .select({
        id: reimbursements.id,
        amount: reimbursements.amount,
        status: reimbursements.status,
        manualPaid: reimbursements.manualPaid,
      })
      .from(reimbursements)
      .where(eq(reimbursements.id, data.id))
      .get();
    if (!claim || claim.status !== "cancelled") throw new Error("Reimbursement is not cancelled.");
    // Re-derive status from links
    const status = await deriveClaimStatus(db, { ...claim, status: "pending" });
    const closed = status === "reimbursed" || status === "extra";
    await db
      .update(reimbursements)
      .set({ status, closedAt: closed ? sql`(datetime('now'))` : null })
      .where(eq(reimbursements.id, claim.id));
    return { ok: true };
  });

const fullyPaidSchema = z.object({ id: z.number().int().positive(), paid: z.boolean() });
export const markFullyPaid = createServerFn({ method: "POST" })
  .validator(fullyPaidSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    if (data.paid) {
      await db
        .update(reimbursements)
        .set({ status: "reimbursed", manualPaid: true, closedAt: sql`(datetime('now'))` })
        .where(and(eq(reimbursements.id, data.id), ne(reimbursements.status, "cancelled")));
    } else {
      await db
        .update(reimbursements)
        .set({ manualPaid: false, closedAt: null })
        .where(eq(reimbursements.id, data.id));
      await refreshClaimStatus(db, data.id);
    }
    return { ok: true };
  });

const linkCreditSchema = z.object({
  reimbursementId: z.number().int().positive(),
  creditTransactionId: z.number().int().positive(),
  amount: z.number().positive().optional(),
});

export const linkCredit = createServerFn({ method: "POST" })
  .validator(linkCreditSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const claim = await db
      .select()
      .from(reimbursements)
      .where(eq(reimbursements.id, data.reimbursementId))
      .get();
    if (!claim || claim.status === "cancelled") throw new Error("Claim not found or cancelled.");

    const credit = await db
      .select()
      .from(transactions)
      .where(and(live, eq(transactions.id, data.creditTransactionId), eq(transactions.type, "income")))
      .get();
    if (!credit) throw new Error("Credit transaction not found.");

    // Check existing links for this credit excluding current claim
    const [existingOther] = await db
      .select({ total: sum(reimbursementLinks.amount).mapWith(Number) })
      .from(reimbursementLinks)
      .where(
        and(
          eq(reimbursementLinks.creditTransactionId, credit.id),
          ne(reimbursementLinks.reimbursementId, claim.id),
        ),
      );
    const usedOnOthers = existingOther?.total ?? 0;
    const remainingOnCredit = Math.max(0, credit.amount - usedOnOthers);
    if (remainingOnCredit <= 0.005) {
      throw new Error("Credit has already been fully linked to other claims.");
    }

    // Default amount: remaining on credit capped at what's still owed on claim
    const [currentClaimLinked] = await db
      .select({ total: sum(reimbursementLinks.amount).mapWith(Number) })
      .from(reimbursementLinks)
      .where(
        and(
          eq(reimbursementLinks.reimbursementId, claim.id),
          ne(reimbursementLinks.creditTransactionId, credit.id),
        ),
      );
    const claimOwed = Math.max(0, claim.amount - (currentClaimLinked?.total ?? 0));
    const targetAmount = data.amount
      ? Math.min(data.amount, remainingOnCredit)
      : Math.min(remainingOnCredit, claimOwed > 0 ? claimOwed : remainingOnCredit);

    if (targetAmount <= 0.005) throw new Error("Link amount must be greater than zero.");
    const linkAmt = Math.round(targetAmount * 100) / 100;

    // Verify sum of this credit's links will never exceed the credit
    if (usedOnOthers + linkAmt > credit.amount + 0.005) {
      throw new Error("Sum of credit's links cannot exceed the credit transaction amount.");
    }

    await db
      .insert(reimbursementLinks)
      .values({
        reimbursementId: claim.id,
        creditTransactionId: credit.id,
        amount: linkAmt,
      })
      .onConflictDoUpdate({
        target: [reimbursementLinks.reimbursementId, reimbursementLinks.creditTransactionId],
        set: { amount: linkAmt },
      });

    await refreshClaimStatus(db, claim.id);
    return { ok: true, amount: linkAmt };
  });

const unlinkSchema = z.object({
  reimbursementId: z.number().int().positive(),
  creditTransactionId: z.number().int().positive(),
});

export const unlinkCredit = createServerFn({ method: "POST" })
  .validator(unlinkSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    await db
      .delete(reimbursementLinks)
      .where(
        and(
          eq(reimbursementLinks.reimbursementId, data.reimbursementId),
          eq(reimbursementLinks.creditTransactionId, data.creditTransactionId),
        ),
      );
    await refreshClaimStatus(db, data.reimbursementId);
    return { ok: true };
  });

/**
 * Suggest credits for a claim:
 * - incoming transactions (`type === 'income'`)
 * - amount within 10%
 * - date after spend within 45 days
 * - counterparty name match ranks higher
 */
export const suggestCredits = createServerFn({ method: "GET" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const claim = await db
      .select({
        id: reimbursements.id,
        amount: reimbursements.amount,
        counterparty: reimbursements.counterparty,
        transactionId: reimbursements.transactionId,
      })
      .from(reimbursements)
      .where(eq(reimbursements.id, data.id))
      .get();
    if (!claim) return [];

    const spend = await db
      .select({ date: transactions.date })
      .from(transactions)
      .where(eq(transactions.id, claim.transactionId))
      .get();
    if (!spend) return [];

    const spendDate = spend.date.slice(0, 10);
    const [y, m, d] = spendDate.split("-").map(Number);
    const maxMs = Date.UTC(y, m - 1, d) + 45 * 864e5;
    const maxDate = new Date(maxMs).toISOString().slice(0, 10) + " 24:00";

    // Linked amounts per credit
    const links = await db
      .select({
        creditId: reimbursementLinks.creditTransactionId,
        total: sum(reimbursementLinks.amount).mapWith(Number),
      })
      .from(reimbursementLinks)
      .groupBy(reimbursementLinks.creditTransactionId);
    const usedMap = new Map(links.map((l) => [l.creditId, l.total ?? 0]));

    // Already linked to this claim?
    const alreadyLinked = new Set(
      (
        await db
          .select({ id: reimbursementLinks.creditTransactionId })
          .from(reimbursementLinks)
          .where(eq(reimbursementLinks.reimbursementId, claim.id))
      ).map((r) => r.id),
    );

    const candidates = await db
      .select({
        id: transactions.id,
        amount: transactions.amount,
        date: transactions.date,
        merchant: transactions.merchant,
        accountLast4: transactions.accountLast4,
      })
      .from(transactions)
      .where(
        and(
          live,
          eq(transactions.type, "income"),
          gte(transactions.date, `${spendDate} 00:00`),
          lt(transactions.date, maxDate),
        ),
      )
      .orderBy(desc(transactions.date))
      .limit(200);

    const cpNorm = claim.counterparty.trim().toUpperCase();

    return candidates
      .filter((c) => {
        if (alreadyLinked.has(c.id)) return false;
        const used = usedMap.get(c.id) ?? 0;
        const available = c.amount - used;
        if (available <= 0.005) return false;
        // Amount within 10%
        const diff = Math.abs(c.amount - claim.amount);
        return diff <= claim.amount * 0.101;
      })
      .map((c) => {
        const merchantNorm = c.merchant.trim().toUpperCase();
        const nameMatch =
          merchantNorm.includes(cpNorm) || (cpNorm.length > 2 && cpNorm.includes(merchantNorm));
        const diff = Math.abs(c.amount - claim.amount);
        return {
          id: c.id,
          amount: c.amount,
          date: c.date,
          merchant: c.merchant,
          accountLast4: c.accountLast4,
          nameMatch,
          diff,
        };
      })
      .sort((a, b) => {
        if (a.nameMatch !== b.nameMatch) return a.nameMatch ? -1 : 1;
        return a.diff - b.diff;
      })
      .slice(0, 5);
  });

export const recentCounterparties = createServerFn({ method: "GET" }).handler(async () => {
  const db = getDb();
  const rows = await db
    .select({ name: reimbursements.counterparty, count: count() })
    .from(reimbursements)
    .groupBy(reimbursements.counterparty)
    .orderBy(desc(count()))
    .limit(6);
  return rows.map((r) => r.name);
});

const listOwedSchema = z.object({ view: z.enum(["pending", "done"]).default("pending") });

export type OwedRow = {
  id: number;
  transactionId: number;
  merchant: string;
  spendDate: string;
  spendAmount: number;
  claimAmount: number;
  counterparty: string;
  note: string | null;
  status: "pending" | "partly" | "reimbursed" | "extra" | "cancelled";
  itemIds: string | null;
  manualPaid: boolean;
  createdAt: string;
  closedAt: string | null;
  linkedTotal: number;
  dueAmount: number;
  yoursAmount: number;
  daysOld: number;
  isOverdue: boolean;
};

export const listOwed = createServerFn({ method: "GET" })
  .validator(listOwedSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const isDone = data.view === "done";
    const statusFilter = isDone
      ? inArray(reimbursements.status, ["reimbursed", "extra", "cancelled"])
      : inArray(reimbursements.status, ["pending", "partly"]);

    const rows = await db
      .select({
        id: reimbursements.id,
        transactionId: reimbursements.transactionId,
        claimAmount: reimbursements.amount,
        counterparty: reimbursements.counterparty,
        note: reimbursements.note,
        status: reimbursements.status,
        itemIds: reimbursements.itemIds,
        manualPaid: reimbursements.manualPaid,
        createdAt: reimbursements.createdAt,
        closedAt: reimbursements.closedAt,
        merchant: transactions.merchant,
        spendDate: transactions.date,
        spendAmount: transactions.amount,
      })
      .from(reimbursements)
      .innerJoin(transactions, eq(transactions.id, reimbursements.transactionId))
      .where(and(live, statusFilter))
      .orderBy(isDone ? desc(reimbursements.createdAt) : reimbursements.createdAt);

    const nowMs = Date.now();
    const dayMs = 864e5;

    // Get linked sums
    const claimIds = rows.map((r) => r.id);
    const linkSums = claimIds.length
      ? await db
          .select({
            reimbursementId: reimbursementLinks.reimbursementId,
            total: sum(reimbursementLinks.amount).mapWith(Number),
          })
          .from(reimbursementLinks)
          .where(inArray(reimbursementLinks.reimbursementId, claimIds))
          .groupBy(reimbursementLinks.reimbursementId)
      : [];
    const linkMap = new Map(linkSums.map((l) => [l.reimbursementId, l.total ?? 0]));

    const owedRows: OwedRow[] = rows.map((r) => {
      const linkedTotal = linkMap.get(r.id) ?? 0;
      const dueAmount =
        r.status === "reimbursed" || r.status === "cancelled"
          ? 0
          : Math.max(0, r.claimAmount - linkedTotal);
      const yoursAmount =
        r.status === "cancelled" ? r.spendAmount : Math.max(0, r.spendAmount - r.claimAmount);
      const createdMs = Date.parse(r.spendDate.slice(0, 10));
      const daysOld = Math.max(0, Math.floor((nowMs - createdMs) / dayMs));
      const isOverdue = !isDone && daysOld > 30;

      return {
        ...r,
        status: r.status as OwedRow["status"],
        linkedTotal,
        dueAmount,
        yoursAmount,
        daysOld,
        isOverdue,
      };
    });

    // Person totals for pending view
    const personMap = new Map<string, { counterparty: string; totalDue: number; count: number }>();
    let totalOwed = 0;
    let overdueCount = 0;
    let overdueTotal = 0;
    let oldestDays = 0;

    for (const r of owedRows) {
      if (r.status !== "cancelled" && r.status !== "reimbursed") {
        totalOwed += r.dueAmount;
        if (r.daysOld > oldestDays) oldestDays = r.daysOld;
        if (r.isOverdue) {
          overdueCount += 1;
          overdueTotal += r.dueAmount;
        }
        const existing = personMap.get(r.counterparty) ?? {
          counterparty: r.counterparty,
          totalDue: 0,
          count: 0,
        };
        existing.totalDue += r.dueAmount;
        existing.count += 1;
        personMap.set(r.counterparty, existing);
      }
    }

    return {
      view: data.view,
      rows: owedRows,
      byPerson: [...personMap.values()].sort((a, b) => b.totalDue - a.totalDue),
      totalOwed,
      overdueCount,
      overdueTotal,
      oldestDays,
    };
  });

export const getClaimDetails = createServerFn({ method: "GET" })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const claim = await db
      .select()
      .from(reimbursements)
      .where(eq(reimbursements.transactionId, data.id))
      .orderBy(desc(reimbursements.id))
      .get();
    if (!claim) return null;

    const links = await db
      .select({
        reimbursementId: reimbursementLinks.reimbursementId,
        creditId: reimbursementLinks.creditTransactionId,
        amount: reimbursementLinks.amount,
        merchant: transactions.merchant,
        date: transactions.date,
        accountLast4: transactions.accountLast4,
      })
      .from(reimbursementLinks)
      .innerJoin(transactions, eq(transactions.id, reimbursementLinks.creditTransactionId))
      .where(eq(reimbursementLinks.reimbursementId, claim.id));

    return {
      claim: {
        ...claim,
        status: claim.status as OwedRow["status"],
      },
      links,
    };
  });
