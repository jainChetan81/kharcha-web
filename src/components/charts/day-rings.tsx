import { money, weekday } from "../../lib/format";
export function DayRings({ rows, month }: { rows: { day: string; total: number; category: string }[]; month: string }) {
  const sums = new Map<string, number>();
  rows.forEach((row) => {
    sums.set(row.day, (sums.get(row.day) ?? 0) + row.total);
  });
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  const lead = (new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1)).getUTCDay() + 6) % 7;
  const max = Math.max(...sums.values(), 1);
  return (
    <figure className="m-0 grid grid-cols-7 gap-2">
      {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => (
        <span key={d} className="text-center text-tab text-ink-3">
          <span aria-hidden="true">{d[0]}</span>
          <span className="sr-only">{d}</span>
        </span>
      ))}
      {Array.from({ length: days }, (_, i) => {
        const day = `${month}-${String(i + 1).padStart(2, "0")}`;
        const total = sums.get(day) ?? 0;
        const size = total ? 16 + (total / max) * 18 : 8;
        const heat = total ? Math.min(5, Math.ceil((total / max) * 5)) : 1;
        return (
          <span
            key={day}
            role="img"
            aria-label={total ? `${weekday(day)} ${i + 1}, spent ${money(total)}` : `${weekday(day)} ${i + 1}, no spending`}
            style={i === 0 ? { gridColumnStart: lead + 1 } : undefined}
            className="flex h-14 flex-col items-center justify-center gap-0.5"
          >
            <span
              aria-hidden="true"
              className="shrink-0 rounded-full"
              style={{ width: size, height: size, border: `${Math.max(2, size / 5)}px solid var(--color-heat-${heat})` }}
            />
            <span className="text-chart text-ink-2">
              <span aria-hidden="true">{i + 1}</span>
              <span className="sr-only">{weekday(day)}</span>
            </span>
          </span>
        );
      })}
    </figure>
  );
}
