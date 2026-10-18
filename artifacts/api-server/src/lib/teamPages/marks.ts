import type { Split } from "../dashboard/countedCats";
import type { SterilisedMark } from "../teamCatList";
import { escapeHtml as esc } from "./escape";

// The four sterilisation marks (SYC-396 spec §12.2). They mean sterilisation
// status and nothing else, and are always a shape AND a word, never colour
// alone. Shared by the cats grid now, and later by the map and the reports.
//
// "Checked in person" is not shown: nothing records it yet (SYC-400).

export const MARK_WORD: Record<SterilisedMark, string> = {
  sterilised: "Sterilised",
  probably: "Probably",
  not_sterilised: "Not sterilised",
  not_known: "Not known",
};

/** The spec's colours for each mark (§12.2). */
export const MARK_COLOUR: Record<SterilisedMark, string> = {
  sterilised: "#0a4d59",
  probably: "#2f7884",
  not_known: "#6a949b",
  not_sterilised: "#a6540a",
};

// 16px shapes: a filled circle, a half-filled circle, an empty ring, and a ring
// with a slash. They take their colour from the mark's class.
const SHAPE: Record<SterilisedMark, string> = {
  sterilised: '<circle cx="8" cy="8" r="6" fill="currentColor" stroke="currentColor" stroke-width="2"/>',
  probably:
    '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M8 2a6 6 0 0 0 0 12z" fill="currentColor"/>',
  not_known: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"/>',
  not_sterilised:
    '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M3.8 12.2L12.2 3.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

const icon = (m: SterilisedMark) =>
  `<svg class="mark-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${SHAPE[m]}</svg>`;

/** Trusted HTML: a small shape and the word. Built only from the fixed text above. */
export function markBadge(m: SterilisedMark): string {
  return `<span class="mark mark-${m}">${icon(m)}<span class="mark-word">${MARK_WORD[m]}</span></span>`;
}

/**
 * Trusted HTML: the shape beside a sentence that already says the state in
 * words (the cat page's facts row, SYC-396 PR 1.4). The sentence goes through
 * escapeHtml before it reaches here.
 */
export function markWithWords(m: SterilisedMark, escapedWords: string): string {
  return `<span class="mark mark-${m}">${icon(m)}<span class="mark-text">${escapedWords}</span></span>`;
}

/** The marks in the order a legend, or a cluster's ring, lists them. */
export const MARK_ORDER: readonly SterilisedMark[] = ["sterilised", "probably", "not_known", "not_sterilised"];

/** A cluster's ring, split by mark, as a conic-gradient from the fixed colours and counts only. */
export function clusterRing(split: Partial<Record<SterilisedMark, number>>): string {
  const total = MARK_ORDER.reduce((n, m) => n + Math.max(0, Math.floor(split[m] ?? 0)), 0);
  if (total === 0) return `conic-gradient(${MARK_COLOUR.not_known} 0 100%)`;
  let at = 0;
  const stops = MARK_ORDER.flatMap((m) => {
    const n = Math.max(0, Math.floor(split[m] ?? 0));
    if (n === 0) return [];
    const from = at;
    at += (n / total) * 100;
    // Whole hundredths of a per cent (no toFixed: positions.source.test.ts keeps that for positions).
    const pct = (v: number) => `${Math.round(v * 100) / 100}%`;
    return [`${MARK_COLOUR[m]} ${pct(from)} ${pct(at)}`];
  });
  return `conic-gradient(${stops.join(",")})`;
}

/**
 * Whole hundredths of a per cent for each count, summing to exactly 100%
 * (largest remainder), so the bar never falls short or overflows by rounding.
 */
function hundredths(counts: readonly number[], total: number): number[] {
  const exact = counts.map((n) => (n / total) * 10_000);
  const out = exact.map(Math.floor);
  let left = 10_000 - out.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of byRemainder) {
    if (left <= 0) break;
    out[i]! += 1;
    left -= 1;
  }
  return out;
}

/**
 * Trusted HTML: the four-part sterilisation bar (SYC-396 PR 2.0; spec §4,
 * §12.2). One bar of up to four segments in MARK_ORDER, each as wide as its
 * share, then a legend line giving every non-zero part its shape, number and
 * word, so it is never colour alone. Built only from the fixed words, the
 * fixed colours and the counts; `label` is escaped.
 */
export function markBar(split: Split, opts: { label?: string } = {}): string {
  // Whole, finite, non-negative counts only: anything else counts as none.
  const count = (v: number | undefined) => (Number.isFinite(v) ? Math.max(0, Math.floor(v!)) : 0);
  const parts = MARK_ORDER.map((m) => ({ m, n: count(split[m]) })).filter((p) => p.n > 0);
  const total = parts.reduce((t, p) => t + p.n, 0);
  const words = total === 0 ? "No street cats yet" : parts.map((p) => `${p.n} ${MARK_WORD[p.m]}`).join(", ");
  const aria = esc(opts.label ? `${opts.label}: ${words}` : words);
  if (total === 0) {
    return (
      `<div class="markbar"><div class="markbar-track markbar-empty" role="img" aria-label="${aria}"></div>` +
      `<p class="markbar-legend">No street cats yet</p></div>`
    );
  }
  const widths = hundredths(parts.map((p) => p.n), total);
  const segs = parts
    .map((p, i) => `<span class="markbar-seg mark-${p.m}" style="flex:0 1 ${widths[i]! / 100}%;background:${MARK_COLOUR[p.m]}"></span>`)
    .join("");
  // The legend repeats the bar's label in sight, so screen readers hear it once.
  const legend = parts
    .map((p) => `<span class="mark mark-${p.m}">${icon(p.m)}<span class="mark-word">${p.n} ${MARK_WORD[p.m]}</span></span>`)
    .join('<span class="markbar-sep"> · </span>');
  return (
    `<div class="markbar"><div class="markbar-track" role="img" aria-label="${aria}">${segs}</div>` +
    `<p class="markbar-legend" aria-hidden="true">${legend}</p></div>`
  );
}

/**
 * The island map's dots (SYC-396 PR 1.5; spec §12.2, §12.4), for the
 * draggable map's markers and the button map's pins alike. A dot is the
 * badge's shape and shade at 16px, with a 2px light ring and a 1px dark
 * outline so it shows on land and sea, inside a 44px tap target. A cluster
 * is a white disc with its count, inside a ring split by mark. Feeding sites
 * are squares in dark ink, never circles and never teal: filled when public,
 * outlined when private, dashed grey when retired.
 */
const RING = "box-shadow:0 0 0 2px #fff,0 0 0 3px #1d1d1b";
export const MAP_MARK_CSS =
  ".catdot{display:block;box-sizing:border-box;width:16px;height:16px;border-radius:50%;border:2px solid;background:#fff;" + RING + "}" +
  `.catdot.mark-sterilised{border-color:${MARK_COLOUR.sterilised};background:${MARK_COLOUR.sterilised}}` +
  `.catdot.mark-probably{border-color:${MARK_COLOUR.probably};background:linear-gradient(90deg,${MARK_COLOUR.probably} 50%,#fff 50%)}` +
  `.catdot.mark-not_known{border-color:${MARK_COLOUR.not_known}}` +
  `.catdot.mark-not_sterilised{border-color:${MARK_COLOUR.not_sterilised};background:linear-gradient(135deg,#fff 42%,${MARK_COLOUR.not_sterilised} 42%,${MARK_COLOUR.not_sterilised} 58%,#fff 58%)}` +
  ".catcluster{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:36px;height:36px;border-radius:50%;padding:5px;" + RING + "}" +
  ".catcluster>span{display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;background:#fff;color:#1d1d1b;font:700 13px/1 system-ui,sans-serif}" +
  ".sitesq{display:block;box-sizing:border-box;width:14px;height:14px;border:2px solid #1d1d1b;background:#1d1d1b;box-shadow:0 0 0 2px #fff}" +
  ".sitesq.site-private{background:#fff}" +
  ".sitesq.site-retired{border:2px dashed #6b685f;background:#e8e4d8}";

/** The styles for the badges; included in the page shell's stylesheet. */
export const MARK_CSS =
  ".mark{display:inline-flex;align-items:center;gap:5px;font-size:14px;font-weight:700;color:#1d1d1b}" +
  ".mark-icon{flex:none}" +
  (Object.keys(MARK_COLOUR) as SterilisedMark[])
    .map((m) => `.mark-${m} .mark-icon{color:${MARK_COLOUR[m]}}`)
    .join("") +
  // The four-part bar: 2px gaps, rounded ends; an empty outline when there are no street cats.
  ".markbar{margin:8px 0}" +
  ".markbar-track{display:flex;gap:2px;height:16px;border-radius:8px;overflow:hidden}" +
  ".markbar-seg{display:block;min-width:2px}" +
  ".markbar-empty{border:2px solid rgba(29,29,27,.55);box-sizing:border-box}" +
  ".markbar-legend{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;margin:6px 0 0;font-size:14px;color:#1d1d1b}" +
  ".markbar-sep{color:rgba(29,29,27,.55)}";
