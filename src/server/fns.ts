import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  add,
  addSchema,
  categories,
  edit,
  editSchema,
  getDb,
  listTransactions,
  monthSummary,
  remove,
} from "./db";

const month = z.string().regex(/^\d{4}-\d{2}$/);

export const getOverview = createServerFn({ method: "GET" })
  .validator(z.object({ month }))
  .handler(({ data }) => {
    const db = getDb();
    return {
      summary: monthSummary(db, data.month),
      recent: listTransactions(db, { month: data.month, limit: 15 }),
    };
  });

export const getTransactions = createServerFn({ method: "GET" })
  .validator(
    z.object({
      month: month.optional(),
      search: z.string().max(60).optional(),
      review: z.boolean().optional(),
    }),
  )
  .handler(({ data }) => {
    const db = getDb();
    return {
      transactions: listTransactions(db, { ...data, limit: 500 }),
      categories: categories(db),
    };
  });

export const getCategories = createServerFn({ method: "GET" }).handler(() =>
  categories(getDb()),
);

export const saveEdit = createServerFn({ method: "POST" })
  .validator(editSchema)
  .handler(({ data }) => edit(getDb(), data));

export const addTransaction = createServerFn({ method: "POST" })
  .validator(addSchema)
  .handler(({ data }) => add(getDb(), data));

export const deleteTransaction = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(({ data }) => remove(getDb(), data.id));
