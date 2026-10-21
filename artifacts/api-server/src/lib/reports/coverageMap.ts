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

export function coverageMap(o: { cells: readonly MapCell[]; labels: readonly { name: string; row: number; col: number }[]; title: string }): string {
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
  const oy = PAD;
  const H = oy + nRows * s + PAD;

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

  // Area names at their centres; a name that would overlap one already
  // written moves down a line, so names never sit on top of each other.
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const names = o.labels
    .filter((l) => l.row >= rMin && l.row <= rMax + 1 && l.col >= cMin && l.col <= cMax + 1)
    .map((l) => {
      const w = Math.ceil(l.name.length * FONT * 0.56);
      const cx = Math.round(ox + (l.col - cMin) * s);
      const x = Math.min(VIEW_W - PAD - Math.ceil(w / 2), Math.max(PAD + Math.ceil(w / 2), cx));
      let y = Math.round(oy + (rMax + 1 - l.row) * s + FONT * 0.35);
      for (let tries = 0; tries < 6; tries++) {
        const box = { x0: x - w / 2, x1: x + w / 2, y0: y - FONT, y1: y + 4 };
        if (!placed.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) break;
        y += FONT + 2;
      }
      y = Math.min(H - 2, y);
      placed.push({ x0: x - w / 2, x1: x + w / 2, y0: y - FONT, y1: y + 4 });
      return (
        `<text x="${x}" y="${y}" font-size="${FONT}" text-anchor="middle" fill="${INK}" font-weight="700" ` +
        `stroke="#fff" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${esc(l.name)}</text>`
      );
    })
    .join("");

  return (
    `<svg class="chart" viewBox="0 0 ${VIEW_W} ${H}" role="img" aria-label="${esc(o.title)}" xmlns="http://www.w3.org/2000/svg">` +
    squares +
    names +
    "</svg>" +
    `<ul class="chartlegend"><li>${swatch(true)}Sighted in this period</li><li>${swatch(false)}Not looked at yet (within 500 m of an area's centre)</li></ul>`
  );
}
