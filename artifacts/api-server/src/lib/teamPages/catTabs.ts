import { escapeHtml as esc } from "./escape";

// The cat page's tabs (SYC-655 spec §3, §3.1): a row of plain links and one
// panel per tab, shown one at a time by CSS alone (no script). Pure: the
// panels arrive already drawn.

export interface CatPanel {
  /** `history`, `photos`, `map`, `coat` or `reports`: the panel is `#tab-<id>`. */
  id: string;
  /** What the tab says, count included: "History (18)". */
  tab: string;
  /** The panel's own heading, plain text (escaped here). */
  heading: string;
  /** The panel's content, already drawn. */
  html: string;
}

/** The tabs, in the order they are drawn. History is open when nothing else is targeted. */
export const CAT_TAB_IDS = ["history", "photos", "map", "coat", "reports"] as const;

export function renderCatTabs(panels: CatPanel[]): string {
  return (
    '<nav class="cattabs" aria-label="Sections of this cat\'s page">' +
    panels.map((p) => `<a href="#tab-${p.id}">${esc(p.tab)}</a>`).join("") +
    "</nav>" +
    '<div class="catpanels">' +
    panels
      .map(
        (p) =>
          `<section class="catpanel" id="tab-${p.id}" aria-labelledby="h-${p.id}">` +
          `<h2 id="h-${p.id}">${esc(p.heading)}</h2>` +
          p.html +
          "</section>",
      )
      .join("") +
    "</div>"
  );
}

/** A panel is open when it, or something inside it, is the page's target. */
const open = (id: string) => `#tab-${id}:target,#tab-${id} :target`;
const NONE_OPEN = ":not(:has(.catpanel:target,.catpanel :target))";

/**
 * The tabs' CSS (spec §3.1, review A6). Everything that hides a panel sits
 * inside @supports selector(:has(a)), so a browser without :has() hides
 * nothing and shows every panel, one under another.
 */
export const CAT_TABS_CSS = `.cattabs{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;background:#f6f4ef;border-bottom:1px solid #d9d5ca;margin:24px -12px 0;padding:8px 12px;display:flex;gap:8px;overflow-x:auto;white-space:nowrap}
.cattabs a{display:inline-flex;align-items:center;flex:none;min-height:44px;padding:0 16px;border-radius:999px;background:#fff;border:1px solid #d9d5ca;text-decoration:none;font-weight:600;font-size:15px;color:#1d1d1b}
.catpanel>h2:first-child{margin-top:20px}
#history,#photos,#appearance,#issue-strip,#map,#vet-visits,.catpanel,[id^="s-"],[id^="sg-"],[id^="p-"],[id^="vv-"],[id^="a-"]{scroll-margin-top:72px}
@supports selector(:has(a)){
.catpanel{display:none}
.catpanel:target,.catpanel:has(:target){display:block}
main${NONE_OPEN} #tab-history{display:block}
main:has(${open("history")}) a[href="#tab-history"],main${NONE_OPEN} a[href="#tab-history"]{background:#0b4553;border-color:#0b4553;color:#fff}
main:has(${open("history")}) a[href="#tab-history"]::after,main${NONE_OPEN} a[href="#tab-history"]::after{content:"" / ", open"}
${CAT_TAB_IDS.filter((id) => id !== "history")
  .map(
    (id) =>
      `main:has(${open(id)}) a[href="#tab-${id}"]{background:#0b4553;border-color:#0b4553;color:#fff}\n` +
      `main:has(${open(id)}) a[href="#tab-${id}"]::after{content:"" / ", open"}`,
  )
  .join("\n")}
}`;
