// Wealth area server functions. Owner: Plan+Wealth agent.
import { createServerFn } from "@tanstack/react-start";

export type WealthSummary = { value: number; dayChange: number; navDate: string | null; spark: number[] };

/** CONTRACT (used by Today): portfolio value, day change, NAV date, ~30-point sparkline. Null when no holdings. */
export const getWealthSummary = createServerFn({ method: "GET" }).handler(async (): Promise<WealthSummary | null> => null);
