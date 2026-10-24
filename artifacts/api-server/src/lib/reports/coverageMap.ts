import { escapeHtml as esc } from "../teamPages/escape";
import { FONT } from "./charts";
import { INK, VIEW_W } from "./chartCss";

// The Coverage report's picture of the island (SYC-396 PR 3.3b; plan
// Decision 13): 250 m squares as an SVG drawn by the server, with no map
// pictures and no script. The squares sit on lib/geo's grid, which is
// already lng × cos(37.44°), so a square's row and column place it exactly.
//
// **No position is printed.** Every coordinate in the picture is a whole
// number of picture units, worked out from a square's row and column (or an
// area centre's place on the grid, rounded). A cell's degrees never reach
// the page (coverage.test.ts asserts no long decimals in the page or CSV).
//
// Never colour alone (§12.3): looked-at squares are filled grey, not-looked-
// at squares are white with a dashed outline. That reads in black and
// white. Each square has a <title> saying which it is and its area.

const MAX_H = 640;
const PAD = 6;
const SEEN_OPACITY = 0.45;

export interface MapCell {
  row: number;
  col: number;
  seen: boolean;
  area: string;
}

/** A swatch for the legend: the same shape as the map's squares. */
export const swatch = (seen: boolean) =>
  `<svg class="mapswatch" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">` +
  (seen
    ? `<rect x="1" y="1" width="12" height="12" fill="${INK}" fill-opacity="${SEEN_OPACITY}"/>`
    : `<rect x="1.5" y="1.5" width="11" height="11" fill="#fff" stroke="${INK}" stroke-width="1.5" stroke-dasharray="3 2"/>`) +
  "</svg>";

export function coverageMap(o: {
  cells: readonly MapCell[];
  labels: readonly { name: string; row: number; col: number }[];
  title: string;
  /** The island's outline as [lat, lng] points (lib/geo SYROS_OUTLINE). */
  outline: readonly (readonly [number, number])[];
  /** Maps a point onto the same grid the squares use (fractional row and column, not floored). */
  toGrid: (lat: number, lng: number) => { row: number; col: number };
}): string {
  if (o.cells.length === 0) return "";
  const rows = o.cells.map((c) => c.row);
  const cols = o.cells.map((c) => c.col);
  const rMin = Math.min(...rows);
  const rMax = Math.max(...rows);
  const cMin = Math.min(...cols);
  const cMax = Math.max(...cols);
  const nRows = rMax - rMin + 1;
  const nCols = cMax - cMin + 1;
  const s = Math.max(4, Math.min(Math.floor((VIEW_W - 2 * PAD) / nCols), Math.floor(MAX_H / nRows)));
  const ox = Math.floor((VIEW_W - nCols * s) / 2);

  // Area names sit just above the box round that area's squares, centred on
  // it. Worked out relative to the top of the squares (gy), so the picture
  // can make room above for the highest name. An area with no drawn squares
  // gets no name: there is nothing to label. A name that would overlap one
  // already placed moves up a line (never down, which would land on squares).
  const byArea = new Map<string, { rLo: number; rHi: number; cLo: number; cHi: number }>();
  for (const c of o.cells) {
    const b = byArea.get(c.area);
    if (!b) byArea.set(c.area, { rLo: c.row, rHi: c.row, cLo: c.col, cHi: c.col });
    else {
      b.rLo = Math.min(b.rLo, c.row);
      b.rHi = Math.max(b.rHi, c.row);
      b.cLo = Math.min(b.cLo, c.col);
      b.cHi = Math.max(b.cHi, c.col);
    }
  }
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const named: { name: string; x: number; gy: number }[] = [];
  const seenNames = new Set<string>();
  for (const l of o.labels) {
    const b = byArea.get(l.name);
    if (!b || seenNames.has(l.name)) continue;
    seenNames.add(l.name);
    const w = Math.ceil(l.name.length * FONT * 0.56);
    const cx = Math.round(ox + ((b.cLo + b.cHi + 1) / 2 - cMin) * s);
    const x = Math.min(VIEW_W - PAD - Math.ceil(w / 2), Math.max(PAD + Math.ceil(w / 2), cx));
    let gy = (rMax - b.rHi) * s - 4;
    for (let tries = 0; tries < 12; tries++) {
      const box = { x0: x - w / 2, x1: x + w / 2, y0: gy - FONT, y1: gy + 4 };
      if (!placed.some((q) => q.x0 < box.x1 && box.x0 < q.x1 && q.y0 < box.y1 && box.y0 < q.y1)) break;
      gy -= FONT + 2;
    }
    placed.push({ x0: x - w / 2, x1: x + w / 2, y0: gy - FONT, y1: gy + 4 });
    named.push({ name: l.name, x, gy });
  }
  const oy = PAD + Math.max(0, ...named.map((n) => FONT - n.gy));
  const H = oy + nRows * s + PAD;

  const pt = (lat: number, lng: number) => {
    const g = o.toGrid(lat, lng);
    return `${Math.round(ox + (g.col - cMin) * s)},${Math.round(oy + (rMax + 1 - g.row) * s)}`;
  };
  const island =
    `<polygon points="${o.outline.map(([lat, lng]) => pt(lat, lng)).join(" ")}" fill="#e9e5da" stroke="#cfc9ba" stroke-width="1" ` +
    `vector-effect="non-scaling-stroke" stroke-linejoin="round" aria-hidden="true"/>`;

  const squares = o.cells
    .map((c) => {
      const x = ox + (c.col - cMin) * s;
      const y = oy + (rMax - c.row) * s;
      const what = c.seen ? "Sighted in this period" : "Not looked at yet";
      const shape = c.seen
        ? `fill="${INK}" fill-opacity="${SEEN_OPACITY}"`
        : `fill="#fff" stroke="${INK}" stroke-width="1.5" stroke-dasharray="3 2" vector-effect="non-scaling-stroke"`;
      return `<rect x="${x}" y="${y}" width="${s - 1}" height="${s - 1}" ${shape}><title>${esc(`${what} · ${c.area}`)}</title></rect>`;
    })
    .join("");

  const names = named
    .map(
      (n) =>
        `<text x="${n.x}" y="${oy + n.gy}" font-size="${FONT}" text-anchor="middle" fill="${INK}" font-weight="700" ` +
        `stroke="#fff" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${esc(n.name)}</text>`,
    )
    .join("");

  return (
    `<svg class="chart" viewBox="0 0 ${VIEW_W} ${H}" role="img" aria-label="${esc(o.title)}" xmlns="http://www.w3.org/2000/svg">` +
    island +
    squares +
    names +
    "</svg>" +
    `<ul class="chartlegend"><li>${swatch(true)}Sighted in this period</li><li>${swatch(false)}Not looked at yet (within 500 m of an area's centre)</li></ul>`
  );
}
