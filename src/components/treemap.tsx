import { Link } from "@tanstack/react-router";
import { money } from "../lib/format";

type Category = { category: string; total: number; colorToken: string };

export function Treemap({ rows, month }: { rows: Category[]; month: string }) {
  const ranked = rows.filter((row) => row.total > 0).sort((a, b) => b.total - a.total);
  const total = ranked.reduce((sum, row) => sum + row.total, 0);
  if (!total) return <p className="text-sm text-ink-2">No spending this month.</p>;
  const other = ranked.find((row) => row.category === "Other");
  const second = ranked.find((row) => row !== other);
  const tiles = [...(other ? [other] : []), ...(second ? [second] : [])];
  if (!other) tiles.splice(0, tiles.length, ...ranked.slice(0, 2));
  const rest = ranked.filter((row) => !tiles.includes(row));
  const large = Math.max(24, Math.min(76, Math.round((tiles[0].total / total) * 100)));
  const main = (row: Category) => <Link key={row.category} to={row.category === "Other" ? "/review" : "/activity"} search={row.category === "Other" ? undefined : { month, category: row.category }} className={`flex min-w-0 flex-col justify-between rounded-lg p-3 text-ink ${row.category === "Other" ? "hatch" : ""}`} style={row.category === "Other" ? undefined : { background: `var(--color-${row.colorToken})` }}>
    <b className="truncate text-sm">{row.category}</b><span className="flex flex-col"><span className="font-serif text-[26px] leading-none">{money(row.total)}</span><span className="mt-1 text-xs">{Math.round(row.total / total * 100)}%{row.category === "Other" ? " · mostly unreviewed" : ""}</span></span>
  </Link>;
  return <>
    <div className="grid h-[190px] gap-1" style={{ gridTemplateColumns: `${large}fr ${100 - large}fr` }}>
      {main(tiles[0])}
      <div className="grid min-w-0 gap-1" style={{ gridTemplateRows: rest.length ? "1fr 34px" : "1fr" }}>
        {tiles[1] && main(tiles[1])}
        {rest.length > 0 && <div className="flex min-w-0 gap-1">{rest.map((row) => <Link key={row.category} to="/activity" search={{ month, category: row.category }} aria-label={`${row.category}: ${money(row.total)}`} title={`${row.category}: ${money(row.total)}`} className="min-w-2 rounded-md" style={{ background: `var(--color-${row.colorToken})`, flex: row.total }} />)}</div>}
      </div>
    </div>
    {rest.length > 0 && <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[13px] text-ink-2">{rest.map((row) => <Link key={row.category} to="/activity" search={{ month, category: row.category }} className="flex items-center gap-1.5 text-ink-2"><i className="size-2 rounded-sm" style={{ background: `var(--color-${row.colorToken})` }} />{row.category} {money(row.total)}</Link>)}</div>}
  </>;
}
