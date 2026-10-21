import type { Split } from "../dashboard/countedCats";
import { wholePct } from "../dashboard/colonyFigures";
import type { SterilisedMark } from "../teamCatList";
import { escapeHtml as esc } from "../teamPages/escape";
import { MARK_COLOUR, markBar } from "../teamPages/marks";
import { dayWords } from "./range";

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

/** The width every chart is drawn at, in viewBox units. */
export const VIEW_W = 560;
/** A chart's width on a 390px phone: 390, less main's 12px padding and the card's 13px, each side. */
export const CHART_MIN_PX = 340;
/** The one text size, in viewBox units: 12px at CHART_MIN_PX. */
export const FONT = Math.ceil((12 * VIEW_W) / CHART_MIN_PX);

const INK = "#1d1d1b";
/** A total that isn't a status (§12.2): neutral ink at 55%. */
const NEUTRAL_OPACITY = 0.55;
const GRID = "rgba(29,29,27,.14)";

/** Styles for the charts; included in the page shell's stylesheet. */
export const CHART_CSS =
  ".chart{display:block;width:100%;max-width:" + VIEW_W + "px;height:auto;margin:8px 0}" +
  ".chartbox{background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:8px 13px;margin:12px 0}" +
  ".chartlegend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:4px 0 0;padding:0;list-style:none;font-size:14px}" +
  ".chartlegend li{display:inline-flex;align-items:center;gap:6px}" +
  ".swatch{display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid " + INK + "}" +
  "details.astable{margin:6px 0 12px}" +
  "details.astable>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:700;color:#0b4553}" +
  ".tablewrap{overflow-x:auto}" +
  "table.rtable{border-collapse:collapse;width:100%;font-size:14px;background:#fff}" +
  "table.rtable caption{text-align:left;font-weight:700;padding:4px 0}" +
  "table.rtable th,table.rtable td{border-bottom:1px solid #d9d5ca;padding:6px 8px;text-align:left;vertical-align:top}" +
  "table.rtable .num{text-align:right;font-variant-numeric:tabular-nums}" +
  "ol.sbars{list-style:none;margin:8px 0;padding:0}" +
  "ol.sbars>li{background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:8px 12px;margin:0 0 8px}" +
  ".sbname{font-weight:700}";

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

  const labels = ends
    .map((e, rank) => {
      const lx = x(e.last!.at);
      const ly = y(e.last!.value);
      const above = rank === 0;
      const ty = above ? Math.max(FONT, ly - 12) : Math.min(p.bottom - 6, ly + FONT + 8);
      return text(lx, ty, `${e.s.label}: ${e.last!.value}`, "end", ' font-weight="700"');
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
}

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
          return (
            `<rect x="${r1(bx)}" y="${r1(top)}" width="${r1(w)}" height="${r1(h)}" rx="2" fill="${esc(part.colour)}">` +
            `<title>${esc(`${part.label}: ${part.value}, from ${dayWords(b.at)}`)}</title></rect>`
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
          .map((k) => `<li><span class="swatch" style="background:${esc(k.colour)}"></span>${esc(k.label)}</li>`)
          .join("")}</ul>`;

  return open(H, o.title) + grid(p, scale) + bars + xLabels + "</svg>" + legend;
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
  numeric?: true;
}

/**
 * A chart's exact numbers, or a report's whole table, folded inside "Show as
 * table" (§9.3). Every cell is escaped.
 */
export function tableFor(o: {
  caption: string;
  columns: readonly TableColumn[];
  rows: readonly Record<string, string | number>[];
  /** Trusted HTML for each header cell, e.g. a sort link (built from fixed text and escapeHtml). */
  headers?: Record<string, string>;
  /** Show it open, not folded (a report that is only a table). */
  open?: true;
}): string {
  const cls = (c: TableColumn) => (c.numeric ? ' class="num"' : "");
  const head = o.columns.map((c) => `<th scope="col"${cls(c)}>${o.headers?.[c.key] ?? esc(c.label)}</th>`).join("");
  const body = o.rows
    .map((r) => `<tr>${o.columns.map((c) => `<td${cls(c)}>${esc(String(r[c.key] ?? ""))}</td>`).join("")}</tr>`)
    .join("");
  const table =
    `<div class="tablewrap"><table class="rtable"><caption>${esc(o.caption)}</caption>` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  return `<details class="astable"${o.open ? " open" : ""}><summary>Show as table</summary>${table}</details>`;
}
