import { describe, expect, it } from "vitest";
import { rowMenu } from "./rowMenu";

// SYC-619 Task 8 (spec §7.2): the colony's cat rows take a new compact "⋯"
// form. rowMenu is shared with the team cat page's History (catHistory.ts,
// SYC-602), which is out of scope: its output must not change by a byte.
// These snapshots were taken before the compact option was added.

const ITEM = `<form class="x" method="post" action="/a"><button type="submit">Go</button></form>`;

describe("rowMenu: the forms other pages use are unchanged", () => {
  it("the plain 'More' form", () => {
    expect(rowMenu("More", "Mimi <b>", [ITEM])).toBe(
      `<details class="rowmenu"><summary>More<span class="sr"> (Mimi &lt;b&gt;)</span></summary>` +
        `<div class="rowmenuitems">${ITEM}</div></details>`,
    );
  });

  it("the cat page History's dots form, closed and open", () => {
    expect(rowMenu("⋯", "Seen 3 Oct", [ITEM], { dots: true, open: false })).toBe(
      `<details class="rowmenu dots"><summary><span aria-hidden="true">⋯</span><span class="sr">More for Seen 3 Oct</span></summary>` +
        `<div class="rowmenuitems">${ITEM}</div></details>`,
    );
    expect(rowMenu("⋯", "Seen 3 Oct", [ITEM], { dots: true, open: true })).toBe(
      `<details class="rowmenu dots" open><summary><span aria-hidden="true">⋯</span><span class="sr">More for Seen 3 Oct</span></summary>` +
        `<div class="rowmenuitems">${ITEM}</div></details>`,
    );
  });

  it("no items, no menu", () => {
    expect(rowMenu("More", "Mimi", ["", ""])).toBe("");
  });
});

describe("rowMenu: the compact '⋯' form (a colony's cat rows, spec §7.2)", () => {
  it("draws a hidden glyph and reads the label and the row's name", () => {
    expect(rowMenu("More", "Mimi <b>", [ITEM], { compact: true })).toBe(
      `<details class="rowmenu compact"><summary><span aria-hidden="true">⋯</span><span class="sr">More (Mimi &lt;b&gt;)</span></summary>` +
        `<div class="rowmenuitems">${ITEM}</div></details>`,
    );
  });

  it("no items, no menu, compact or not", () => {
    expect(rowMenu("More", "Mimi", [""], { compact: true })).toBe("");
  });
});
