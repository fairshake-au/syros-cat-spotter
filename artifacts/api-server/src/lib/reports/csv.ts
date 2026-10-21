// Spreadsheet files for every report table (SYC-396 PR 3.3a; spec §9.3).
//
// **Made safe against spreadsheet formulas.** A colony name, a place label or
// any other text the team or a cat guardian typed could start with `=`, `+`,
// `-` or `@`, and Excel or LibreOffice would run it as a formula ("CSV
// injection"). Such text gets a leading apostrophe, which a spreadsheet shows
// as plain text. A real number (a count, a per cent) is never text, so a
// negative change like -3 stays a number. A wrong escape fails silently (the
// file still opens), so csv.test.ts pins each case and has a mutation probe.

/** Text starting with one of these (after any leading spaces) could run as a formula. */
const FORMULA_START = /^[\s]*[=+\-@\t\r]/;

/** One cell. Text is made formula-safe, then quoted if it holds a quote, comma or line break. */
export function csvCell(v: string | number | null): string {
  if (v === null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const safe = FORMULA_START.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * A whole file: a header row of the columns' labels, then one row per row,
 * in the columns' order. It starts with a UTF-8 byte-order mark, so Greek
 * names open correctly in Excel, and lines end CRLF, as spreadsheets expect.
 */
export function toCsv(
  columns: readonly { key: string; label: string }[],
  rows: readonly Record<string, string | number | null>[],
): string {
  const line = (cells: (string | number | null)[]) => cells.map(csvCell).join(",");
  return (
    "﻿" +
    [line(columns.map((c) => c.label)), ...rows.map((r) => line(columns.map((c) => r[c.key] ?? null)))]
      .map((l) => `${l}\r\n`)
      .join("")
  );
}
