import { describe, expect, it } from "vitest";
import { CHART_MIN_PX, barChart, lineChart, niceScale, sortedBars, tableFor } from "./charts";

// SYC-396 PR 3.3a, Task 3.3a.1 (plan Decision 12, spec §12.3): server-drawn
// SVG charts with a table beside each.

const at = (d: number) => new Date(Date.UTC(2026, 8, d, 12));

/** Every <text>'s size in px when the chart is CHART_MIN_PX wide (a 390px phone). */
function textSizesAtPhone(svg: string): number[] {
  const width = Number(/viewBox="0 0 (\d+(?:\.\d+)?) /.exec(svg)![1]);
  return [...svg.matchAll(/<text\b[^>]*font-size="(\d+(?:\.\d+)?)"/g)].map((m) => (Number(m[1]) * CHART_MIN_PX) / width);
}

const twoLines = () =>
  lineChart({
    title: "Confirmed sterilised and all street cats known",
    series: [
      { label: "Confirmed sterilised", mark: "sterilised", points: [{ at: at(1), value: 10 }, { at: at(8), value: 14 }, { at: at(15), value: 19 }] },
      { label: "All street cats known", neutral: true, points: [{ at: at(1), value: 40 }, { at: at(8), value: 41 }, { at: at(15), value: 45 }] },
    ],
  });

describe("lineChart", () => {
  it("two series: two paths, two end labels, one axis", () => {
    const svg = twoLines();
    expect(svg.match(/<path\b/g)).toHaveLength(2);
    expect(svg).toContain(">Confirmed sterilised: 19</text>");
    expect(svg).toContain(">All street cats known: 45</text>");
    // One scale: one set of grid lines, every one starting at the same left edge.
    const lefts = new Set([...svg.matchAll(/<line x1="([\d.]+)"/g)].map((m) => m[1]));
    expect(lefts.size).toBe(1);
  });

  it("a <title> with the exact value and date on every point, and an aria-label", () => {
    const svg = twoLines();
    expect(svg.match(/<circle\b/g)).toHaveLength(6);
    expect(svg.match(/<title>/g)).toHaveLength(6);
    expect(svg).toContain("<title>Confirmed sterilised: 14 on 8 Sep 2026</title>");
    expect(svg).toMatch(/^<svg class="chart" viewBox="[^"]+" role="img" aria-label="Confirmed sterilised and all street cats known"/);
  });

  it("2px lines; the neutral total is grey ink at 55% with open points", () => {
    const svg = twoLines();
    for (const m of svg.matchAll(/<path [^>]*>/g)) expect(m[0]).toContain('stroke-width="2" vector-effect="non-scaling-stroke"');
    expect(svg).toContain('stroke="#0a4d59"');
    expect(svg).toMatch(/<path [^>]*stroke="#1d1d1b"[^>]*stroke-opacity="0.55"/);
    expect(svg).toMatch(/<circle [^>]*fill="#fff" stroke="#1d1d1b"/);
  });

  it("escapes a label", () => {
    const svg = lineChart({ title: "<x>", series: [{ label: "<script>", neutral: true, points: [{ at: at(1), value: 1 }] }] });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});

describe("text is never below 12px on a 390px phone", () => {
  const charts = {
    line: twoLines(),
    bar: barChart({
      title: "Reports per week",
      bars: [
        { at: at(1), parts: [{ key: "u", label: "Urgent", value: 2, colour: "#b42318" }, { key: "l", label: "Litter", value: 1, colour: "#5b4b8a" }] },
        { at: at(8), parts: [{ key: "u", label: "Urgent", value: 0, colour: "#b42318" }] },
      ],
    }),
  };
  for (const [name, svg] of Object.entries(charts)) {
    it(name, () => {
      const sizes = textSizesAtPhone(svg);
      expect(sizes.length).toBeGreaterThan(0);
      for (const s of sizes) expect(s).toBeGreaterThanOrEqual(12);
    });
  }
});

describe("barChart", () => {
  it("stacks the parts with a title each, and names every part in the legend", () => {
    const svg = barChart({
      title: "Reports per week",
      bars: [{ at: at(1), parts: [{ key: "u", label: "Urgent", value: 2, colour: "#b42318" }, { key: "n", label: "Needs attention", value: 3, colour: "#a08000" }] }],
    });
    expect(svg.match(/<rect\b/g)).toHaveLength(2);
    expect(svg).toContain("<title>Urgent: 2, from 1 Sep 2026</title>");
    expect(svg).toContain("Needs attention</li>");
  });
});

describe("niceScale", () => {
  it("rounds the top up to a whole step of 1, 2 or 5", () => {
    expect(niceScale(45)).toEqual({ top: 50, ticks: [0, 10, 20, 30, 40, 50] });
    expect(niceScale(3)).toEqual({ top: 3, ticks: [0, 1, 2, 3] });
    expect(niceScale(0)).toEqual({ top: 1, ticks: [0, 1] });
  });
});

describe("sortedBars", () => {
  it("keeps the order given, links each row, and says % confirmed sterilised", () => {
    const html = sortedBars({
      title: "Colonies",
      rows: [
        { label: "Kini <1>", href: "/api/team/colonies/2", split: { sterilised: 1, probably: 0, not_sterilised: 3, not_known: 0 } },
        { label: "Vaporia", split: { sterilised: 4, probably: 0, not_sterilised: 0, not_known: 0 } },
      ],
    });
    expect(html.indexOf("Kini")).toBeLessThan(html.indexOf("Vaporia"));
    expect(html).toContain('<a href="/api/team/colonies/2">Kini &lt;1&gt;</a>');
    expect(html).toContain("4 street cats · 25% confirmed sterilised");
    expect(html).toContain("4 street cats · 100% confirmed sterilised");
  });
});

describe("tableFor", () => {
  it("is folded inside Show as table, and escapes every cell", () => {
    const html = tableFor({
      caption: "Colonies",
      columns: [{ key: "name", label: "Colony" }, { key: "n", label: "Cats", numeric: true }],
      rows: [{ name: "<script>alert(1)</script>", n: 3 }],
    });
    expect(html.startsWith('<details class="astable"><summary>Show as table</summary>')).toBe(true);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain('<td class="num" data-label="Cats">3</td>');
  });
});
