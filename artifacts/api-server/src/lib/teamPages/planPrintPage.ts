import type { PlanCat, TrappingPlan } from "../dashboard/trappingPlan";
import { teamPhotoUrl } from "../teamCatView";
import { escapeHtml as esc } from "./escape";
import { lastSeenWords } from "./lastSeen";
import { MARK_WORD } from "./marks";
import { coatIsUnknown, coatWordsFor } from "./teamCoatWords";
import { estimateLine } from "./colonyPages";
import { wordsIn } from "./words";

// A colony's printable trapping plan (SYC-396 PR 2.3; SYC-621; spec §9.2
// item 4). One clean page for the round: photos, names, colours and place
// labels. Team only (`print_trapping_plan`): a cat guardian's offline view is
// SYC-54's. It has no menu, no map, no position as numbers, no "Open map" and
// no feeding site's internal name: a place is `usualPlace`, which is built
// from a site's PUBLIC label or the area only. Black and white must still
// read: the mark is a word, never a colour alone.

/** "24 Oct 2026", in Syros time. */
const printedOn = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Athens" });

const CSS = `
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:#1d1d1b}
body{font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px;max-width:900px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}
.sub{margin:0 0 12px;font-size:14px}
.screen{margin:0 0 16px;display:flex;gap:16px;flex-wrap:wrap;align-items:center}
.screen a,.screen button{font:inherit;min-height:44px;display:inline-flex;align-items:center}
.screen button{padding:0 16px;border:1px solid #1d1d1b;border-radius:8px;background:#fff;cursor:pointer}
ol.plan{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px}
ol.plan li{display:flex;gap:10px;align-items:flex-start;border:1px solid #8a877e;border-radius:6px;padding:8px;break-inside:avoid;page-break-inside:avoid}
ol.plan img,.nophoto{width:84px;height:84px;object-fit:cover;border-radius:4px;flex:none;background:#eeece6}
.nophoto{display:flex;align-items:center;justify-content:center;font-size:12px;text-align:center}
.cat strong{font-size:16px}
.cat span{display:block;font-size:13px}
.tick{width:22px;height:22px;border:2px solid #1d1d1b;border-radius:3px;flex:none;margin-left:auto}
.empty{font-size:15px}
footer{margin-top:16px;padding-top:8px;border-top:1px solid #8a877e;font-size:12px}
@page{margin:12mm}
@media print{
  body{padding:0;max-width:none;font-size:12px}
  .screen{display:none}
  ol.plan{grid-template-columns:repeat(2,1fr);gap:6px}
  ol.plan img,.nophoto{width:64px;height:64px}
  .cat strong{font-size:13px}
  .cat span{font-size:12px}
  a{color:inherit;text-decoration:none}
}`;

function catCard(c: PlanCat, now: Date): string {
  const coat = { colours: c.coat, pattern: c.pattern };
  const photo = c.photoPublicId
    ? `<img src="${esc(teamPhotoUrl(c.photoPublicId))}" alt="">`
    : `<span class="nophoto">No photo</span>`;
  return (
    `<li>${photo}<span class="cat"><strong>${esc(c.name)}</strong> ${esc(c.syr)}` +
    `<span>${esc(MARK_WORD[c.mark])}</span>` +
    (coatIsUnknown(coat) ? "" : `<span>${esc(coatWordsFor(undefined, coat))}</span>`) +
    `<span>Usually seen: ${esc(c.usualPlace)}</span>` +
    `<span>${esc(lastSeenWords(c.lastSeenAt, now))}</span>` +
    (c.earClipSeen ? `<span>Ear clip seen</span>` : "") +
    `</span><span class="tick" aria-hidden="true"></span></li>`
  );
}

/** The whole page, a document of its own. The team's plan only (PlanCat, never GuardianPlanCat). */
export function renderPlanPrintPage(colony: { id: number; name: string }, plan: TrappingPlan, now: Date = new Date()): string {
  const W = wordsIn("en");
  const toDo = plan.toDo as PlanCat[];
  const title = `Trapping plan: ${colony.name}`;
  const list =
    toDo.length === 0
      ? `<p class="empty">${plan.done.length > 0 ? "Every street cat here is sterilised." : "No street cats yet."}</p>`
      : `<ol class="plan">${toDo.map((c) => catCard(c, now)).join("")}</ol>`;
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex">` +
    `<title>${esc(title)}</title><style>${CSS}</style></head><body>` +
    `<div class="screen"><a href="/api/team/colonies/${colony.id}">← ${esc(colony.name)}</a>` +
    `<span>Use your browser's Print to print this page.</span></div>` +
    `<h1>${esc(title)}</h1>` +
    `<p class="sub">To do: ${toDo.length} · already sterilised: ${plan.done.length}` +
    (plan.estimate && plan.estimate.cats > 0 ? ` · ${estimateLine(W, plan.estimate)}` : "") +
    `</p>` +
    list +
    `<footer>Syros Cats · printed ${esc(printedOn(now))} · for the team only</footer>` +
    `</body></html>`
  );
}
