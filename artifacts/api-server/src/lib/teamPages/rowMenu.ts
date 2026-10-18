import { escapeHtml as esc } from "./escape";

// A small menu on one row of a list (SYC-396 spec §7.3, plan Task 1.4.2): the
// actions that used to sit as buttons on every row ("Make a feeding site
// here", "Show on the map", "Take out of this colony") fold into one "More"
// per row. A plain <details>, so it works with no script and from a keyboard.

/**
 * Trusted HTML. `label` is the visible word ("More"); `forWhat` tells a
 * screen reader which row it belongs to. `items` are trusted HTML already.
 * No items, no menu.
 */
export function rowMenu(label: string, forWhat: string, items: readonly string[]): string {
  const shown = items.filter((i) => i !== "");
  if (shown.length === 0) return "";
  return (
    `<details class="rowmenu"><summary>${esc(label)}<span class="sr"> (${esc(forWhat)})</span></summary>` +
    `<div class="rowmenuitems">${shown.join("")}</div></details>`
  );
}
