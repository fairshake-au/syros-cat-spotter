import type { SterilisedMark } from "../teamCatList";

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

/** Trusted HTML: a small shape and the word. Built only from the fixed text above. */
export function markBadge(m: SterilisedMark): string {
  return (
    `<span class="mark mark-${m}">` +
    `<svg class="mark-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${SHAPE[m]}</svg>` +
    `<span class="mark-word">${MARK_WORD[m]}</span></span>`
  );
}

/** The styles for the badges; included in the page shell's stylesheet. */
export const MARK_CSS =
  ".mark{display:inline-flex;align-items:center;gap:5px;font-size:14px;font-weight:700;color:#1d1d1b}" +
  ".mark-icon{flex:none}" +
  (Object.keys(MARK_COLOUR) as SterilisedMark[])
    .map((m) => `.mark-${m} .mark-icon{color:${MARK_COLOUR[m]}}`)
    .join("");
