import { COAT_COLOURS, COAT_PATTERNS, type CoatColour, type CoatPattern } from "../appearance";
import { escapeHtml as esc } from "./escape";
import { tr } from "./strings";
import { coatWordsFor } from "./teamCoatWords";

// The drawn cat (coat-colours-and-pattern.md §3, SYC-398 PR B): one simple
// sitting cat, drawn on the server as static inline SVG. Team pages have no
// scripts (DECISIONS Part 2k), so it is drawn once, after a Correct is saved,
// never redrawn as boxes are ticked. A first pass for Samuel's eye (Decision
// 5A): simple shapes, the colours as fills, stripes and patches as overlays.
//
// - the first colour (in display order, White last) fills the cat;
// - each further colour is a patch;
// - White fills the chest and paws;
// - Stripes lays stripes over the coloured areas (White stays clear);
// - Patches enlarges the patches, White among them.
//
// Only codes from the vocabulary reach the SVG: anything else is dropped, so
// nothing raw can be drawn or written into the page.

const FILL: Record<CoatColour, string> = {
  black: "#2b2b2b",
  grey: "#8d929a",
  brown: "#8b5a2b",
  ginger: "#e38b3a",
  white: "#fbfaf6",
};
/** A coat whose colours aren't known: a plain neutral, never a guess. */
const UNKNOWN = "#e4e0d8";
const OUTLINE = "#3b3934";

/** Where the patches sit, in the order further colours take them. */
const SPOTS = [
  { cx: 62, cy: 104, r: 12 },
  { cx: 92, cy: 47, r: 9 },
  { cx: 101, cy: 121, r: 11 },
  { cx: 66, cy: 56, r: 7 },
  { cx: 107, cy: 98, r: 8 },
  { cx: 132, cy: 104, r: 6 },
];

// The silhouette: tail, body, legs, head and ears. Drawn filled, used as the
// clip for every overlay, and drawn again on top as the outline.
const SHAPES =
  '<path d="M112 138 Q150 140 147 102 Q145 84 133 87 Q139 102 136 114 Q131 128 110 127 Z"/>' +
  '<ellipse cx="80" cy="113" rx="40" ry="35"/>' +
  '<rect x="60" y="118" width="14" height="32" rx="7"/>' +
  '<rect x="86" y="118" width="14" height="32" rx="7"/>' +
  '<polygon points="57,46 59,17 78,34"/>' +
  '<polygon points="103,46 101,17 82,34"/>' +
  '<circle cx="80" cy="58" r="26"/>';

// Stripes: curved bands across the head, body and tail.
const STRIPES =
  '<path d="M66 40 Q70 46 68 52"/><path d="M80 34 L80 46"/><path d="M94 40 Q90 46 92 52"/>' +
  '<path d="M54 64 Q60 66 64 64"/><path d="M106 64 Q100 66 96 64"/>' +
  '<path d="M44 100 Q52 104 50 112"/><path d="M42 116 Q50 120 50 128"/>' +
  '<path d="M116 100 Q108 104 110 112"/><path d="M118 116 Q110 120 110 128"/>' +
  '<path d="M60 84 Q80 92 100 84"/><path d="M58 132 L74 132"/><path d="M86 132 L102 132"/>' +
  '<path d="M140 92 L148 96"/><path d="M137 106 L147 110"/><path d="M128 124 L136 132"/>';

// White's own places: the chest and the paws.
const WHITE_PARTS =
  '<ellipse cx="80" cy="100" rx="15" ry="22"/>' +
  '<ellipse cx="67" cy="146" rx="9" ry="6"/><ellipse cx="93" cy="146" rx="9" ry="6"/>';

const FACE =
  '<ellipse cx="70" cy="56" rx="4" ry="5" fill="#c8d65a" stroke="#2b2b2b" stroke-width="1"/>' +
  '<ellipse cx="90" cy="56" rx="4" ry="5" fill="#c8d65a" stroke="#2b2b2b" stroke-width="1"/>' +
  '<ellipse cx="70" cy="56" rx="1.4" ry="3.5" fill="#1d1d1d"/>' +
  '<ellipse cx="90" cy="56" rx="1.4" ry="3.5" fill="#1d1d1d"/>' +
  '<polygon points="76,66 84,66 80,71" fill="#d98a94" stroke="#2b2b2b" stroke-width="1"/>';

export interface DrawnCoat {
  colours: readonly string[] | null;
  pattern: string | null;
}

/** The coat's parts, kept to the vocabulary, colours in display order. */
function known(coat: DrawnCoat): { colours: CoatColour[]; pattern: CoatPattern | null } {
  const said = new Set(coat.colours ?? []);
  const colours = COAT_COLOURS.filter((c) => said.has(c));
  const pattern = (COAT_PATTERNS as readonly string[]).includes(coat.pattern ?? "")
    ? (coat.pattern as CoatPattern)
    : null;
  return { colours, pattern };
}

/**
 * The caption under the drawing, and its label: the team's phrase in
 * English ("Ginger tabby", "Tabby, colours not known"; SYC-443 §15.4), §2's
 * words in Greek and French, each unknown part said out loud.
 */
export function drawnCaption(lang: string | undefined, coat: DrawnCoat): string {
  return coatWordsFor(lang, coat);
}

/** The drawn cat as an inline SVG. `id` keeps its clip path unique on a page. */
export function coatSvg(lang: string | undefined, coat: DrawnCoat, id: string): string {
  const { colours, pattern } = known(coat);
  const clip = `cc-${id.replace(/[^a-z0-9-]/gi, "")}`;
  const nonWhite = colours.filter((c) => c !== "white");
  const hasWhite = colours.includes("white");
  const base: CoatColour | null = nonWhite.length ? nonWhite[0]! : hasWhite ? "white" : null;
  const baseFill = base ? FILL[base] : UNKNOWN;
  // Further colours take the spots in turn; with Patches, White joins them.
  const patchColours: CoatColour[] = [...nonWhite.slice(1), ...(pattern === "patches" && hasWhite && base !== "white" ? (["white"] as const) : [])];
  const grow = pattern === "patches" ? 1.7 : 1;
  const patches = patchColours.length
    ? SPOTS.map((s, i) => {
        const c = patchColours[i % patchColours.length]!;
        return `<circle cx="${s.cx}" cy="${s.cy}" r="${Math.round(s.r * grow * 10) / 10}" fill="${FILL[c]}"/>`;
      }).join("")
    : "";
  const stripes =
    pattern === "stripes"
      ? `<g fill="none" stroke="${base === "black" ? "#ffffff" : "#000000"}" stroke-opacity="${base === "black" ? "0.3" : "0.34"}" stroke-width="4" stroke-linecap="round">${STRIPES}</g>`
      : "";
  const white = hasWhite && base !== "white" ? `<g fill="${FILL.white}">${WHITE_PARTS}</g>` : "";
  const caption = drawnCaption(lang, coat);
  return (
    `<svg class="drawncat" viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="${esc(caption)}" xmlns="http://www.w3.org/2000/svg">` +
    `<title>${esc(caption)}</title>` +
    `<defs><clipPath id="${clip}">${SHAPES}</clipPath></defs>` +
    `<g fill="${baseFill}">${SHAPES}</g>` +
    `<g clip-path="url(#${clip})">${patches}${stripes}${white}</g>` +
    `<g fill="none" stroke="${OUTLINE}" stroke-width="2" stroke-linejoin="round"${base ? "" : ' stroke-dasharray="5 4"'}>${SHAPES}</g>` +
    FACE +
    "</svg>"
  );
}

/** The drawing with its caption, as the page shows it after a Correct is saved. */
export function drawnCoatFigure(lang: string | undefined, coat: DrawnCoat, id: string): string {
  return (
    '<figure class="drawn" style="margin:8px 0 12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
    `<span style="display:inline-block;background:#f4f1ea;border:1px solid #d6d1c4;border-radius:12px;padding:6px;line-height:0">${coatSvg(lang, coat, id)}</span>` +
    `<figcaption><span class="label">${esc(tr(lang, "appearance.drawnTitle"))}</span><br>` +
    `<strong>${esc(drawnCaption(lang, coat))}</strong></figcaption></figure>`
  );
}

/** A small round swatch beside a colour's checkbox (spec §3: checkboxes with swatches). */
export function colourSwatch(colour: string): string {
  if (!(COAT_COLOURS as readonly string[]).includes(colour)) return "";
  return (
    '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">' +
    `<circle cx="10" cy="10" r="8.5" fill="${FILL[colour as CoatColour]}" stroke="${OUTLINE}" stroke-width="1.5"/></svg>`
  );
}
