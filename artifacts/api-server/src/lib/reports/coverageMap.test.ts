import { describe, expect, it } from "vitest";
import { CELL_LAT_DEG, CELL_LNG_DEG } from "@workspace/geo";
import { FONT } from "./charts";
import { coverageMap, type MapCell } from "./coverageMap";

const OUTLINE: [number, number][] = [
  [37.5, 24.9], [37.5, 24.95], [37.4, 24.95], [37.4, 24.9],
];
const toGrid = (lat: number, lng: number) => ({ row: lat / CELL_LAT_DEG, col: lng / CELL_LNG_DEG });

const r0 = Math.floor(37.45 / CELL_LAT_DEG);
const c0 = Math.floor(24.92 / CELL_LNG_DEG);
const cell = (dr: number, dc: number, area: string, seen = true): MapCell => ({ row: r0 + dr, col: c0 + dc, seen, area });

const CELLS: MapCell[] = [
  cell(0, 0, "Alpha"), cell(0, 1, "Alpha"), cell(1, 0, "Alpha", false),
  cell(2, 3, "Beta"), cell(3, 3, "Beta"),
  cell(2, 4, "Gamma"),
];
const LABELS = [
  { name: "Alpha", row: r0 + 0.5, col: c0 + 1 },
  { name: "Beta", row: r0 + 3, col: c0 + 3.5 },
  { name: "Gamma", row: r0 + 2.5, col: c0 + 4.5 },
  { name: "Nowhere", row: r0 - 40, col: c0 - 40 },
];
const run = (cells = CELLS, labels = LABELS) => coverageMap({ cells, labels, title: "t", outline: OUTLINE, toGrid });

type Box = { x0: number; x1: number; y0: number; y1: number };
const num = (s: string, a: string) => Number(new RegExp(`${a}="(-?[\\d.]+)"`).exec(s)![1]);
const texts = (svg: string) =>
  [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => {
    const w = Math.ceil(m[1]!.length * FONT * 0.56);
    const x = num(m[0], "x");
    const y = num(m[0], "y");
    return { name: m[1]!, box: { x0: x - w / 2, x1: x + w / 2, y0: y - FONT, y1: y + 4 } as Box };
  });
const rects = (svg: string) =>
  [...svg.matchAll(/<rect [^>]*><title>[^<]*· ([^<]*)<\/title>/g)].map((m) => ({
    area: m[1]!,
    box: { x0: num(m[0], "x"), x1: num(m[0], "x") + num(m[0], "width"), y0: num(m[0], "y"), y1: num(m[0], "y") + num(m[0], "height") } as Box,
  }));
const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe("coverageMap", () => {
  it("draws the island outline first, light-filled, before any square", () => {
    const svg = run();
    const shapes = [...svg.matchAll(/<(path|polygon|rect)\b/g)];
    expect(shapes[0]![1]).toMatch(/path|polygon/);
    const outline = /<(?:path|polygon)\b[^>]*>/.exec(svg)![0];
    expect(outline).toMatch(/fill="#[0-9a-f]{3,6}"/);
    expect(outline).not.toMatch(/stroke-width="[2-9]/);
    expect(svg.indexOf(outline)).toBeLessThan(svg.indexOf("<rect"));
  });

  it("puts each area name above its own squares, never on them", () => {
    const svg = run();
    const rs = rects(svg);
    const ts = texts(svg);
    expect(ts.map((t) => t.name).sort()).toEqual(["Alpha", "Beta", "Gamma"]);
    for (const t of ts) {
      const mine = rs.filter((r) => r.area === t.name).map((r) => r.box);
      const bb = {
        x0: Math.min(...mine.map((b) => b.x0)), x1: Math.max(...mine.map((b) => b.x1)),
        y0: Math.min(...mine.map((b) => b.y0)), y1: Math.max(...mine.map((b) => b.y1)),
      };
      expect(t.box.y1, t.name).toBeLessThanOrEqual(bb.y0);
      expect(t.box.y0, t.name).toBeGreaterThanOrEqual(0);
      expect(hit(t.box, bb), t.name).toBe(false);
    }
  });

  it("keeps every name off every square, a neighbouring area's too", () => {
    const cells = [cell(0, 0, "South"), cell(0, 1, "South"), cell(1, 0, "South"), cell(1, 1, "South"),
      cell(2, 0, "North"), cell(2, 1, "North"), cell(3, 0, "North"), cell(3, 1, "North")];
    const labels = [{ name: "South", row: r0 + 1, col: c0 + 1 }, { name: "North", row: r0 + 3, col: c0 + 1 }];
    const svg = run(cells, labels);
    const ts = texts(svg);
    expect(ts.map((t) => t.name).sort()).toEqual(["North", "South"]);
    for (const t of ts) {
      expect(t.box.y0, t.name).toBeGreaterThanOrEqual(0);
      for (const r of rects(svg)) expect(hit(t.box, r.box), `${t.name} on a ${r.area} square`).toBe(false);
    }
  });

  it("never lets two names overlap, and draws no name for an area with no squares", () => {
    const labels = [
      { name: "Alpha", row: 0, col: 0 },
      { name: "Alphb", row: 0, col: 0 },
      { name: "Empty", row: 0, col: 0 },
    ];
    const cells = [cell(0, 0, "Alpha"), cell(0, 0, "Alphb")];
    const ts = texts(run(cells, labels));
    expect(ts).toHaveLength(2);
    expect(hit(ts[0]!.box, ts[1]!.box)).toBe(false);
  });

  it("draws the outline with north up and east to the right", () => {
    const outline: [number, number][] = [[37.5, 24.92], [37.4, 24.92], [37.45, 24.97], [37.45, 24.87]];
    const svg = coverageMap({ cells: CELLS, labels: LABELS, title: "t", outline, toGrid });
    const pts = /<polygon points="([^"]+)"/.exec(svg)![1]!.split(" ").map((p) => p.split(",").map(Number) as [number, number]);
    const [north, south, east, west] = pts as [[number, number], [number, number], [number, number], [number, number]];
    expect(north[1]).toBeLessThan(south[1]);
    expect(east[0]).toBeGreaterThan(west[0]);
  });

  it("keeps the legend text", () => {
    const svg = run();
    expect(svg).toContain("Sighted in this period</li>");
    expect(svg).toContain("Not looked at yet (within 500 m of an area's centre)</li>");
  });

  it("returns nothing without squares", () => {
    expect(run([], LABELS)).toBe("");
  });
});
