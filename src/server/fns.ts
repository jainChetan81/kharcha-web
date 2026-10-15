import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db/client";
import {
  addSchema,
  addTxn,
  budgetSchema,
  categoryNames,
  editSchema,
  editTxn,
  listSchema,
  listTxns,
  monthSchema,
  monthSummary,
  removeTxn,
  setBudget,
} from "./db/queries";

export const getOverview = createServerFn({ method: "GET" })
  .validator(z.object({ month: monthSchema }))
  .handler(async ({ data }) => {
    const db = getDb();
    const [summary, recent] = await Promise.all([
      monthSummary(db, data.month),
      listTxns(db, { month: data.month, limit: 15 }),
    ]);
    return { summary, recent };
  });

export const getTransactions = createServerFn({ method: "GET" })
  .validator(listSchema)
  .handler(async ({ data }) => {
    const db = getDb();
    const [transactions, categories] = await Promise.all([
      listTxns(db, { ...data, limit: 500, withRaw: true }),
      categoryNames(db),
    ]);
    return { transactions, categories };
  });

export const getCategories = createServerFn({ method: "GET" }).handler(() => categoryNames(getDb()));

export const saveEdit = createServerFn({ method: "POST" })
  .validator(editSchema)
  .handler(({ data }) => editTxn(getDb(), data));

export const addTransaction = createServerFn({ method: "POST" })
  .validator(addSchema)
  .handler(({ data }) => addTxn(getDb(), data));

export const deleteTransaction = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(({ data }) => removeTxn(getDb(), data.id));

export const saveBudget = createServerFn({ method: "POST" })
  .validator(budgetSchema)
  .handler(({ data }) => setBudget(getDb(), data));
