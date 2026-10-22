import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

// SYC-396 PR 3.3a, Task 3.3a.1 (spec §9.3): every download is safe against
// spreadsheet formulas. A wrong escape fails silently, so each case is pinned
// (and the `-` case has a mutation probe: drop "-" from FORMULA_START and
// "text starting with -" must go red).

describe("csvCell", () => {
  it("makes text starting with = + - @ tab or CR safe with a leading apostrophe", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("+44 7700")).toBe("'+44 7700");
    expect(csvCell("\tcmd")).toBe("'\tcmd");
    expect(csvCell("\r=cmd")).toBe("\"'\r=cmd\"");
  });

  it("text starting with -", () => {
    expect(csvCell("-3")).toBe("'-3");
    expect(csvCell("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
  });

  it("leading spaces don't hide a formula", () => {
    expect(csvCell("  =cmd")).toBe("'  =cmd");
  });

  it("a number stays a number, negative ones too", () => {
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(null)).toBe("");
  });

  it("quotes a cell holding a quote, a comma or a line break, doubling quotes", () => {
    expect(csvCell('Kini, "harbour" steps')).toBe('"Kini, ""harbour"" steps"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
  });

  it("leaves ordinary text alone, Greek included", () => {
    expect(csvCell("Βαπόρια")).toBe("Βαπόρια");
    expect(csvCell("a-b")).toBe("a-b");
  });
});

describe("toCsv", () => {
  it("starts with a UTF-8 BOM, has a header row, and ends every line CRLF", () => {
    const out = toCsv(
      [
        { key: "name", label: "Colony" },
        { key: "n", label: "Cats now" },
      ],
      [
        { name: "=cmd", n: 4 },
        { name: "Kini", n: null },
      ],
    );
    expect(out.startsWith("﻿")).toBe(true);
    expect(out.slice(1)).toBe("Colony,Cats now\r\n'=cmd,4\r\nKini,\r\n");
  });
});
