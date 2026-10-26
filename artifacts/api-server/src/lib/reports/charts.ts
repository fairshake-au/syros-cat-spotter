import type { Split } from "../dashboard/countedCats";
import { wholePct } from "../dashboard/colonyFigures";
import type { SterilisedMark } from "../teamCatList";
import { escapeHtml as esc } from "../teamPages/escape";
import { MARK_COLOUR, markBar } from "../teamPages/marks";
import { dayWords } from "./range";
import { INK, VIEW_W } from "./chartCss";

export { CHART_CSS, VIEW_W } from "./chartCss";

// The reports' charts (SYC-396 PR 3.3a; plan Decision 12, spec §12.3): SVG
// pictures drawn by the server, with no chart script. Every function returns
// trusted HTML built only from fixed text, numbers, the fixed colours and
// escapeHtml.
//
// The rules they keep:
// - one scale per chart, never two;
// - 2px lines, labelled at their ends; faint, solid grid lines; a small gap
//   between bar segments;
// - a <title> on every mark (the hover), holding its exact value and date;
// - role="img" and an aria-label saying the chart's title;
// - never colour alone: every line is named at its end and drawn with its own
//   point shape, and every bar part is in the legend, so a chart still reads
//   in black and white;
// - no text below 12px: a chart is drawn VIEW_W units wide and shown at most
//   VIEW_W px (CHART_CSS), and on a 390px phone it is CHART_MIN_PX wide, so a
//   font of FONT units is never under 12px.

/** A chart's width on a 390px phone: 390, less main's 12px padding and the card's 13px, each side. */
export const CHART_MIN_PX = 340;
/** The one text size, in viewBox units: 12px at CHART_MIN_PX. */
export const FONT = Math.ceil((12 * VIEW_W) / CHART_MIN_PX);

/** A total that isn't a status (§12.2): neutral ink at 55%. */
const NEUTRAL_OPACITY = 0.55;
const GRID = "rgba(27,42,56,.14)";

/** Round a number to 0.1 of a unit: enough for a picture, and no long decimals in the page. */
const r1 = (v: number) => Math.round(v * 10) / 10;

/** A round top for the scale, and its grid lines: steps of 1, 2 or 5 times a power of ten. */
export function niceScale(max: number): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const rough = max / 5;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((s) => s * pow).find((s) => s >= rough)!;
  const whole = Math.max(1, Math.round(step));
  const top = Math.ceil(max / whole) * whole;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += whole) ticks.push(v);
  return { top, ticks };
}

const text = (x: number, y: number, words: string, anchor: "start" | "middle" | "end" = "start", extra = "") =>
  `<text x="${r1(x)}" y="${r1(y)}" font-size="${FONT}" text-anchor="${anchor}" fill="${INK}"${extra}>${esc(words)}</text>`;

const open = (h: number, title: string) =>
  `<svg class="chart" viewBox="0 0 ${VIEW_W} ${h}" role="img" aria-label="${esc(title)}" xmlns="http://www.w3.org/2000/svg">`;

interface Plot {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The horizontal grid lines and their numbers, on the one scale. */
function grid(p: Plot, scale: { top: number; ticks: number[] }): string {
  return scale.ticks
    .map((t) => {
      const y = p.bottom - (t / scale.top) * (p.bottom - p.top);
      return (
        `<line x1="${p.left}" x2="${p.right}" y1="${r1(y)}" y2="${r1(y)}" stroke="${GRID}" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
        text(p.left - 8, y + FONT * 0.35, String(t), "end")
      );
    })
    .join("");
}

export interface LineSeries {
  label: string;
  points: { at: Date; value: number }[];
  /** A sterilisation status (§12.2): its colour. */
  mark?: SterilisedMark;
  /** A total that isn't a status: neutral ink at 55%. */
  neutral?: true;
}

/**
 * Lines over time on one scale, each named at its end with its last value.
 * A status line gets filled points in its mark's colour; a neutral total gets
 * open points in grey ink, so the two differ in shape as well as colour.
 */
export function lineChart(o: { series: LineSeries[]; title: string }): string {
  const H = 320;
  const p: Plot = { left: FONT * 2.6, right: VIEW_W - 12, top: FONT * 2.2, bottom: H - FONT * 2 };
  const all = o.series.flatMap((s) => s.points);
  const scale = niceScale(Math.max(0, ...all.map((pt) => pt.value)));
  const times = all.map((pt) => pt.at.getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const x = (at: Date) => (t1 === t0 ? (p.left + p.right) / 2 : p.left + ((at.getTime() - t0) / (t1 - t0)) * (p.right - p.left));
  const y = (v: number) => p.bottom - (v / scale.top) * (p.bottom - p.top);

  // Ends, highest first: the highest is named above its end, the others below.
  const ends = o.series
    .map((s, i) => ({ s, i, last: s.points[s.points.length - 1] }))
    .filter((e) => e.last !== undefined)
    .sort((a, b) => b.last!.value - a.last!.value);

  const lines = o.series
    .map((s) => {
      if (s.points.length === 0) return "";
      const colour = s.mark ? MARK_COLOUR[s.mark] : INK;
      const opacity = s.mark ? "" : ` stroke-opacity="${NEUTRAL_OPACITY}"`;
      const d = s.points.map((pt, i) => `${i === 0 ? "M" : "L"}${r1(x(pt.at))} ${r1(y(pt.value))}`).join(" ");
      const path = `<path d="${d}" fill="none" stroke="${colour}" stroke-width="2" vector-effect="non-scaling-stroke"${opacity} stroke-linejoin="round"/>`;
      const dots = s.points
        .map((pt) => {
          const fill = s.mark ? colour : "#fff";
          return (
            `<circle cx="${r1(x(pt.at))}" cy="${r1(y(pt.value))}" r="4" fill="${fill}" stroke="${colour}"${opacity} stroke-width="2" vector-effect="non-scaling-stroke">` +
            `<title>${esc(`${s.label}: ${pt.value} on ${dayWords(pt.at)}`)}</title></circle>`
          );
        })
        .join("");
      return path + dots;
    })
    .join("");

  // Each end is named just above itself, unless that would crowd the name
  // above it, then just below; the lines rise from the left, so above-left
  // of an end is clear of its own line.
  let lastY = -Infinity;
  const labels = ends
    .map((e) => {
      const lx = x(e.last!.at);
      const ly = y(e.last!.value);
      const above = Math.max(FONT, ly - 12);
      const ty = above - lastY >= FONT + 6 ? above : Math.min(p.bottom - 6, Math.max(ly + FONT + 8, lastY + FONT + 6));
      lastY = ty;
      // A halo in the card's white, so a label reads clearly where it crosses a line.
      return text(lx, ty, `${e.s.label}: ${e.last!.value}`, "end", ' font-weight="700" stroke="#fff" stroke-width="6" stroke-linejoin="round" paint-order="stroke"');
    })
    .join("");

  const xLabels =
    all.length === 0
      ? ""
      : t1 === t0
        ? text((p.left + p.right) / 2, H - 6, dayWords(new Date(t0)), "middle")
        : text(p.left, H - 6, dayWords(new Date(t0)), "start") + text(p.right, H - 6, dayWords(new Date(t1)), "end");

  return open(H, o.title) + grid(p, scale) + lines + labels + xLabels + "</svg>";
}

export interface BarPart {
  key: string;
  label: string;
  value: number;
  colour: string;
  /** A non-colour cue drawn over the colour (white hatching or dots), so a black-and-white print still tells parts apart. */
  pattern?: "solid" | "hatch" | "dots";
}

/**
 * The white patterns drawn over a coloured part, once per chart. Their ids
 * are page-wide (the legend's swatches use them too), so a page holds at most
 * one patterned bar chart; a second one would repeat the ids harmlessly but
 * invalidly.
 */
const PATTERN_DEFS =
  "<defs>" +
  '<pattern id="pat-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.4" height="6" fill="#fff"/></pattern>' +
  '<pattern id="pat-dots" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.3" fill="#fff"/></pattern>' +
  "</defs>";

/** A part's pattern over its colour: nothing for a plain or solid part. */
const patternOver = (part: BarPart, x: number, y: number, w: number, h: number, title: string) =>
  part.pattern === "hatch" || part.pattern === "dots"
    ? `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="2" fill="url(#pat-${part.pattern})">${title}</rect>`
    : "";

/** A legend swatch: the part's colour and pattern, drawn (so it prints, unlike a CSS background). */
const legendSwatch = (part: BarPart) =>
  `<svg class="swatch" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><rect width="14" height="14" rx="3" fill="${esc(part.colour)}"/>` +
  patternOver(part, 0, 0, 14, 14, "") +
  "</svg>";

/**
 * Bars over time (counts per week or month), each split into parts stacked in
 * the order given, with a small gap between parts. The legend lists the parts
 * in that order, bottom of the bar first, so a part is never named by colour
 * alone.
 */
export function barChart(o: { bars: { at: Date; parts: BarPart[] }[]; title: string }): string {
  const H = 300;
  const p: Plot = { left: FONT * 2.6, right: VIEW_W - 12, top: FONT, bottom: H - FONT * 2 };
  const totals = o.bars.map((b) => b.parts.reduce((t, part) => t + Math.max(0, part.value), 0));
  const scale = niceScale(Math.max(0, ...totals));
  const n = Math.max(1, o.bars.length);
  const slot = (p.right - p.left) / n;
  const w = Math.max(2, slot * 0.7);
  const unit = (p.bottom - p.top) / scale.top;
  const GAP = 2;

  const bars = o.bars
    .map((b, i) => {
      const bx = p.left + i * slot + (slot - w) / 2;
      let base = p.bottom;
      return b.parts
        .filter((part) => part.value > 0)
        .map((part) => {
          const h = Math.max(1, part.value * unit - GAP);
          const top = base - h;
          base = top - GAP;
          const title = `<title>${esc(`${part.label}: ${part.value}, from ${dayWords(b.at)}`)}</title>`;
          return (
            `<rect x="${r1(bx)}" y="${r1(top)}" width="${r1(w)}" height="${r1(h)}" rx="2" fill="${esc(part.colour)}">${title}</rect>` +
            patternOver(part, bx, top, w, h, title)
          );
        })
        .join("");
    })
    .join("");

  const first = o.bars[0];
  const last = o.bars[o.bars.length - 1];
  const xLabels =
    first === undefined
      ? ""
      : first === last
        ? text((p.left + p.right) / 2, H - 6, dayWords(first.at), "middle")
        : text(p.left, H - 6, dayWords(first.at), "start") + text(p.right, H - 6, dayWords(last!.at), "end");

  const keys = new Map<string, BarPart>();
  for (const b of o.bars) for (const part of b.parts) if (!keys.has(part.key)) keys.set(part.key, part);
  const legend =
    keys.size === 0
      ? ""
      : `<ul class="chartlegend">${[...keys.values()]
          .map((k) => `<li>${legendSwatch(k)}${esc(k.label)}</li>`)
          .join("")}</ul>`;

  const defs = o.bars.some((b) => b.parts.some((part) => part.pattern === "hatch" || part.pattern === "dots")) ? PATTERN_DEFS : "";
  return open(H, o.title) + defs + grid(p, scale) + bars + xLabels + "</svg>" + legend;
}

/**
 * Comparing rows (colonies) as a sorted list of bars (§12.3), in the order
 * given: each row its name, its street cats and "% confirmed sterilised",
 * and the four-part bar with its words.
 */
export function sortedBars(o: { rows: { label: string; split: Split; href?: string }[]; title: string }): string {
  const items = o.rows
    .map((r) => {
      const street = r.split.sterilised + r.split.probably + r.split.not_sterilised + r.split.not_known;
      const name = r.href ? `<a href="${esc(r.href)}">${esc(r.label)}</a>` : esc(r.label);
      const pct = street === 0 ? "" : ` · ${wholePct(r.split.sterilised, street)}% confirmed sterilised`;
      return (
        `<li><span class="sbname">${name}</span> <span class="hint">${street} ${street === 1 ? "street cat" : "street cats"}${pct}</span>` +
        markBar(r.split, { label: r.label }) +
        "</li>"
      );
    })
    .join("");
  return `<ol class="sbars" aria-label="${esc(o.title)}">${items}</ol>`;
}

export interface TableColumn {
  key: string;
  label: string;
  /** The spreadsheet header, when it must stay as it was; the page uses `label`. */
  csvLabel?: string;
  numeric?: true;
}

/** One table's rows, as a table report or a chart's table shows them. */
export interface TableSpec {
  caption: string;
  columns: readonly TableColumn[];
  rows: readonly Record<string, string | number>[];
  /** Trusted HTML for a header cell, e.g. a sort link (built from fixed text and escapeHtml). */
  headers?: Record<string, string>;
  /** aria-sort for the column the rows are sorted by. */
  sorted?: { key: string; dir: "asc" | "desc" };
}

/** A table on its own (a report that is only a table). Every cell is escaped. */
export function tableHtml(o: TableSpec): string {
  const cls = (c: TableColumn) => (c.numeric ? ' class="num"' : "");
  const aria = (c: TableColumn) =>
    o.sorted?.key === c.key ? ` aria-sort="${o.sorted.dir === "asc" ? "ascending" : "descending"}"` : "";
  const head = o.columns.map((c) => `<th scope="col"${cls(c)}${aria(c)}>${o.headers?.[c.key] ?? esc(c.label)}</th>`).join("");
  const body = o.rows
    .map((r) => `<tr>${o.columns.map((c) => `<td${cls(c)} data-label="${esc(c.label)}">${esc(String(r[c.key] ?? ""))}</td>`).join("")}</tr>`)
    .join("");
  return (
    `<div class="tablewrap"><table class="rtable"><caption>${esc(o.caption)}</caption>` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
  );
}

/** A chart's exact numbers, folded inside "Show as table" (§9.3). Every cell is escaped. */
export function tableFor(o: TableSpec): string {
  return `<details class="astable"><summary>Show as table</summary>${tableHtml(o)}</details>`;
}
