/** Split CSV text into rows of trimmed cells. Handles quoted cells with commas or "" escapes and a leading BOM. */
export function csvRows(text: string): string[][] {
  return text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const cells: string[] = []; let cell = ""; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted && ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { cells.push(cell.trim()); cell = ""; }
      else cell += ch;
    }
    return [...cells, cell.trim()];
  });
}

/** Holding CSV body rows (header skipped): date, fund, amount, units, nav. */
export const holdingCsvRows = (text: string) => { const rows = csvRows(text); return rows[0]?.[0]?.toLowerCase() === "date" ? rows.slice(1) : rows; };
