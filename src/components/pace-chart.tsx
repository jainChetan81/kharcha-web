import { compact, money, shiftMonth, thisMonth } from "../lib/format";

type Point = { date: string; amount: number; merchant: string };
type PreviousPoint = { date: string; amount: number };

export function PaceChart({ month, points, previous, limit }: { month: string; points: Point[]; previous: PreviousPoint[]; limit: number }) {
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  const lastMonth = shiftMonth(month, -1);
  const priorDays = new Date(Number(lastMonth.slice(0, 4)), Number(lastMonth.slice(5)), 0).getDate();
  const currentDay = month === thisMonth() ? Math.min(days, new Date().getDate()) : month > thisMonth() ? 0 : days;
  const daily = Array.from({ length: days }, () => 0);
  const past = Array.from({ length: priorDays }, () => 0);
  for (const point of points) daily[Number(point.date.slice(8, 10)) - 1] += point.amount;
  for (const point of previous) past[Number(point.date.slice(8, 10)) - 1] += point.amount;
  const cumulative = (values: number[]) => { let total = 0; return values.map((value) => (total += value)); };
  const spent = cumulative(daily);
  const earlier = cumulative(past);
  const max = Math.max(limit, spent.at(-1) ?? 0, earlier.at(-1) ?? 0, 1) * 1.08;
  const x = (day: number) => (day / days) * 330;
  const y = (amount: number) => 130 - (amount / max) * 108;
  const path = (values: number[], count: number) => `0,130 ${values.map((amount, index) => `${x(((index + 1) / count) * days).toFixed(1)},${y(amount).toFixed(1)}`).join(" ")}`;
  const current = path(spent.slice(0, currentDay), days);
  const prior = path(earlier, priorDays);
  const currentTotal = spent[currentDay - 1] ?? 0;
  const ahead = currentTotal - (limit * currentDay) / days;
  const spike = points.filter((point) => Number(point.date.slice(8, 10)) <= currentDay).reduce<Point | null>((largest, point) => !largest || point.amount > largest.amount ? point : largest, null);
  const spikeX = spike ? x(Number(spike.date.slice(8, 10))) : 0;
  const spikeY = spike ? y(spent[Number(spike.date.slice(8, 10)) - 1] ?? 0) : 0;

  return <figure className="m-0">
    <svg viewBox="-4 -6 340 150" className="block h-[150px] w-full" role="img" aria-label={`Cumulative ${month} spend ${money(currentTotal)} against budget pace ${money(limit)} and ${lastMonth} spend`}>
      <defs><pattern id="pace-future" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line y2="6" stroke="var(--color-on-ink)" strokeOpacity=".12" /></pattern></defs>
      {currentDay < days && <rect x={x(currentDay)} y="0" width={330 - x(currentDay)} height="130" fill="url(#pace-future)" />}
      <line x1="0" y1="130" x2="330" y2="130" stroke="var(--color-on-ink)" strokeOpacity=".2" />
      <polyline points={prior} fill="none" stroke="var(--color-on-ink)" strokeOpacity=".3" strokeWidth="2" />
      {limit > 0 && <line x1="0" y1="130" x2="330" y2={y(limit)} stroke="var(--color-on-ink-pace)" strokeWidth="2" strokeDasharray="2 4" />}
      <polygon points={`${current} ${x(currentDay)},130`} fill="var(--color-on-ink-month)" fillOpacity=".16" />
      <polyline points={current} fill="none" stroke="var(--color-on-ink-month)" strokeWidth="2.5" strokeLinejoin="round" />
      {currentDay > 0 && <circle cx={x(currentDay)} cy={y(currentTotal)} r="4.5" fill="var(--color-on-ink-month)" />}
      {spike && <><line x1={spikeX} x2={spikeX} y1={spikeY} y2="75" stroke="var(--color-on-ink-month)" strokeDasharray="1 2" /><text x={Math.max(0, Math.min(210, spikeX - 65))} y="20" fill="var(--color-on-ink-month)" fontSize="10">{spike.merchant.slice(0, 18)} {compact(spike.amount)}</text></>}
      {limit > 0 && currentDay > 0 && <text x={Math.min(220, x(currentDay) + 8)} y="31" fill="var(--color-on-ink)" fontSize="10">{money(Math.abs(ahead))} {ahead >= 0 ? "ahead" : "behind"} pace</text>}
      <text x="0" y="143" fill="var(--color-on-ink-2)" fontSize="10">1 {new Date(`${month}-01T00:00:00`).toLocaleString("en-IN", { month: "short" })}</text>
      {currentDay > 1 && currentDay < days && <text x={Math.max(0, x(currentDay) - 12)} y="143" fill="var(--color-on-ink)" fontSize="10">Today</text>}
      <text x="297" y="143" fill="var(--color-on-ink-2)" fontSize="10">{days} {new Date(`${month}-01T00:00:00`).toLocaleString("en-IN", { month: "short" })}</text>
    </svg>
    <figcaption className="mt-1 flex gap-3 text-xs text-on-ink-2">
      <span><i className="mr-1 inline-block w-3 border-t-2 border-on-ink-month align-middle" />{new Date(`${month}-01T00:00:00`).toLocaleString("en-IN", { month: "long" })}</span>
      {limit > 0 && <span><i className="mr-1 inline-block w-3 border-t-2 border-dotted border-on-ink-pace align-middle" />Budget pace</span>}
      <span><i className="mr-1 inline-block w-3 border-t-2 border-on-ink-2 align-middle" />{new Date(`${lastMonth}-01T00:00:00`).toLocaleString("en-IN", { month: "long" })}</span>
    </figcaption>
  </figure>;
}
