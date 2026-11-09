/** Client-safe date helpers. IST is the server's zone (start.ts pins TZ); the device clock stays on the client. */

export function istToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

export function realDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function realDate(value: string): boolean {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== m - 1 || day.getUTCDate() !== d) return false;
  if (value.length === 10) return true;
  const [h, min] = value.slice(11).split(":").map(Number);
  return h < 24 && min < 60;
}

export function monthBounds(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  return [`${month}-01`, `${next}-01`];
}
