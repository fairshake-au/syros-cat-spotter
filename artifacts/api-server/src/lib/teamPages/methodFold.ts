import { escapeHtml } from "./escape";

/** A line that carries its own markup (an id attribute, say). The caller escapes whatever it puts in. */
export type FoldHtml = { html: string };

/**
 * The shared "How this is worked out" fold (SYC-619 spec §3). Rules about how
 * something is counted, and what it leaves out, go here at the end of a page.
 * Team pages are English, so the summary has no catalogue key. Returns "" when
 * there is nothing to say. A string is escaped and wrapped in a hint
 * paragraph; an `{ html }` item is inserted exactly as given.
 */
export const methodFold = (lines: readonly (string | FoldHtml)[]): string =>
  lines.length === 0
    ? ""
    : `<details class="method"><summary>How this is worked out</summary>${lines
        .map((l) => (typeof l === "string" ? `<p class="hint">${escapeHtml(l)}</p>` : l.html))
        .join("")}</details>`;
