import { escapeHtml } from "./escape";

/**
 * The shared "How this is worked out" fold (SYC-619 spec §3). Rules about how
 * something is counted, and what it leaves out, go here at the end of a page.
 * Team pages are English, so the summary has no catalogue key. Returns "" when
 * there is nothing to say.
 */
export const methodFold = (lines: readonly string[]): string =>
  lines.length === 0
    ? ""
    : `<details class="method"><summary>How this is worked out</summary>${lines
        .map((l) => `<p class="hint">${escapeHtml(l)}</p>`)
        .join("")}</details>`;
