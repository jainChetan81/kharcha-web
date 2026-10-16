// Plan area server functions (budgets, recurring, trips). Owner: Plan+Wealth agent.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type UpcomingPayment = { seriesId: number; date: string; name: string; amount: number; kind: string };

/** CONTRACT (used by Today): recurring payments due in the next `days` days, soonest first. */
export const getUpcoming = createServerFn({ method: "GET" })
  .validator(z.object({ days: z.number().int().min(1).max(60) }))
  .handler(async (): Promise<UpcomingPayment[]> => []);
