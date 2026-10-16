/** True for a real "YYYY-MM-DD" calendar day (rejects 2026-13-01, 2026-02-30). */
export const realDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
export type Cashflow = { date: string; amount: number };

/** Annual internal rate of return, Newton solved with a guarded bisection fallback. */
export function xirr(cashflows: Cashflow[]): number | null {
  if (cashflows.some((flow) => !realDay(flow.date) || !Number.isFinite(flow.amount))) return null;
  cashflows = [...cashflows].sort((a, b) => a.date.localeCompare(b.date));
  if (cashflows.length < 2 || !cashflows.some((flow) => flow.amount < 0) || !cashflows.some((flow) => flow.amount > 0)) return null;
  const start = Date.parse(`${cashflows[0]!.date}T00:00:00Z`);
  // Under a month of history annualises noise into absurd rates; report nothing instead.
  if (Date.parse(`${cashflows.at(-1)!.date}T00:00:00Z`) - start < 30 * 864e5) return null;
  const terms = cashflows.map((flow) => ({ amount: flow.amount, years: (Date.parse(`${flow.date}T00:00:00Z`) - start) / 31_557_600_000 }));
  const f = (rate: number) => terms.reduce((sum, flow) => sum + flow.amount / (1 + rate) ** flow.years, 0);
  const df = (rate: number) => terms.reduce((sum, flow) => sum - (flow.years * flow.amount) / (1 + rate) ** (flow.years + 1), 0);
  let rate = 0.1;
  for (let i = 0; i < 80; i++) { const slope = df(rate); const next = rate - f(rate) / slope; if (!Number.isFinite(next) || next <= -0.9999 || next > 1e6) break; if (Math.abs(next - rate) < 1e-8) return next; rate = next; }
  let low = -0.9999; let high = 10; let left = f(low); let right = f(high);
  while (left * right > 0 && high < 1e6) { high *= 2; right = f(high); }
  if (left * right > 0) return null;
  for (let i = 0; i < 100; i++) { const middle = (low + high) / 2; const value = f(middle); if (Math.abs(value) < 1e-7) return middle; if (left * value <= 0) { high = middle; right = value; } else { low = middle; left = value; } }
  return (low + high) / 2;
}
