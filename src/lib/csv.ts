import { istToday, realDay } from "./dates.ts";

export function csvRows(text: string): string[][] {
  return text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const cells: string[] = [];
      let cell = "";
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted && ch === '"' && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') quoted = !quoted;
        else if (ch === "," && !quoted) {
          cells.push(cell.trim());
          cell = "";
        } else cell += ch;
      }
      return [...cells, cell.trim()];
    });
}

export const holdingCsvRows = (text: string) => {
  const rows = csvRows(text);
  return rows[0]?.[0]?.toLowerCase() === "date" ? rows.slice(1) : rows;
};

export function holdingCsvIssue(
  row: { date: string; fund: string; amount: string; units: string; nav: string },
  names: Set<string>,
): boolean {
  const { date, fund, amount, units, nav } = row;
  return (
    !realDay(date) ||
    date > istToday() ||
    !fund.trim() ||
    !names.has(fund.toLowerCase()) ||
    ![amount, units, nav].every((value) => Number.isFinite(Number(value))) ||
    Number(nav) <= 0 ||
    Number(amount) === 0 ||
    Number(units) === 0 ||
    Math.sign(Number(amount)) !== Math.sign(Number(units))
  );
}
