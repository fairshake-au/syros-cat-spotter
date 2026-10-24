import { escapeHtml } from "./escape";

declare const foldLineBrand: unique symbol;

/**
 * A fold line that needs an id attribute. Only `foldLine` makes one, and it
 * escapes both the id and the text, so a caller can't slip raw markup in.
 */
export type FoldLine = { readonly html: string; readonly [foldLineBrand]: true };

export const foldLine = (id: string, text: string): FoldLine =>
  ({ html: `<p class="hint" id="${escapeHtml(id)}">${escapeHtml(text)}</p>` }) as FoldLine;

/**
 * The shared "How this is worked out" fold (SYC-619 spec §3). Rules about how
 * something is counted, and what it leaves out, go here at the end of a page.
 * Team pages are English, so the summary has no catalogue key. Returns "" when
 * there is nothing to say. A string is escaped and wrapped in a hint
 * paragraph; a `FoldLine` (from `foldLine`) is already escaped and is inserted
 * as it is.
 */
export const methodFold = (lines: readonly (string | FoldLine)[]): string =>
  lines.length === 0
    ? ""
    : `<details class="method"><summary>How this is worked out</summary>${lines
        .map((l) => (typeof l === "string" ? `<p class="hint">${escapeHtml(l)}</p>` : l.html))
        .join("")}</details>`;
