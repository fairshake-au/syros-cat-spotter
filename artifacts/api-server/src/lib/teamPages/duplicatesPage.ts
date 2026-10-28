import type { CardCat, DuplicateCard } from "../duplicateCards";
import { escapeHtml as esc } from "./escape";
import { backLink, HOME_PATH } from "./backLink";
import { renderPage } from "./layout";
import { mergeHref } from "./mergeLinks";

// Possible duplicates (which-cat-is-which.md §3.3; SYC-59 PR 5.1).
// Server-drawn, no scripts. A row shows the two cats side by side, why the
// pair is here in plain words, and three buttons. Every value goes through
// escapeHtml; photos come only from the team photo route; a spotter is a
// nickname or "a spotter", never a device.

export const DUPLICATES_PATH = "/api/team/duplicates";
export const DUPLICATES_DECIDE = "/api/team/duplicates/decide";

const DONE: Record<string, string> = {
  different: "Saved. The pair is off the list. It only comes back with new evidence.",
  not_sure: "Saved. The pair stays on the list with your note.",
};

const catHref = (id: number) => `/api/team/cats/${id}`;

function catColumn(c: CardCat): string {
  const photos =
    (c.mainPhotoUrl ? `<img class="main" src="${esc(c.mainPhotoUrl)}" alt="${esc(`Main photo of ${c.name}`)}" loading="lazy" width="96" height="96">` : "") +
    c.recentPhotoUrls.map((u) => `<img src="${esc(u)}" alt="${esc(`A recent photo of ${c.name}`)}" loading="lazy" width="72" height="72">`).join("");
  return (
    '<section class="dupcat">' +
    `<h3><a class="catlink" href="${esc(catHref(c.id))}">${esc(c.name)}</a> <span class="syr">${esc(c.syr)}</span></h3>` +
    (photos ? `<div class="photos">${photos}</div>` : '<p class="empty">No photos.</p>') +
    `<p class="meta">${esc(c.coat ?? "Colour not known")} · ${esc(c.colony ?? "No colony")}</p>` +
    "</section>"
  );
}

function card(c: DuplicateCard): string {
  const level = c.level === "likely" ? '<span class="tag urgent">Likely</span>' : '<span class="tag attention">Possible</span>';
  const names = `${c.cats[0].name} and ${c.cats[1].name}`;
  const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
  const pairFields = hidden("a", String(c.low)) + hidden("b", String(c.high));
  return (
    `<article class="report${c.level === "likely" ? " likely" : ""}" id="p-${c.low}-${c.high}">` +
    `<div class="head">${level}${c.reopened ? ' <span class="tag state">Back with new evidence</span>' : ""}${c.notSure ? ' <span class="tag state">Not sure yet</span>' : ""}</div>` +
    `<div class="dupcols">${catColumn(c.cats[0])}${catColumn(c.cats[1])}</div>` +
    (c.apart ? `<p class="meta">Usually seen ${esc(c.apart)}.</p>` : "") +
    `<ul class="dupwhy">${c.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` +
    (c.reporters.length > 0
      ? '<ul class="dupwho">' +
        c.reporters.map((r) => `<li>${esc(r.who)}: ${esc(r.says)}${r.newPhone ? ' <span class="tag unchecked">new phone</span>' : ""}</li>`).join("") +
        "</ul>"
      : "") +
    (c.notSure?.note ? `<p class="notice">Team note: ${esc(c.notSure.note)}</p>` : "") +
    '<div class="dupactions">' +
    `<a class="go tap" href="${esc(mergeHref({ a: c.low, b: c.high }))}">Same cat, merge…<span class="sr"> ${esc(names)}</span></a>` +
    `<form method="post" action="${DUPLICATES_DECIDE}">${pairFields}${hidden("decision", "different")}` +
    `<button type="submit">Different cats<span class="sr"> ${esc(names)}</span></button></form>` +
    `<form method="post" action="${DUPLICATES_DECIDE}">${pairFields}${hidden("decision", "not_sure")}` +
    `<label class="sr" for="n-${c.low}-${c.high}">What would settle it for ${esc(names)}</label>` +
    `<input class="text" id="n-${c.low}-${c.high}" name="note" maxlength="500" autocomplete="off" placeholder="What would settle it?" value="${esc(c.notSure?.note ?? "")}">` +
    `<button type="submit">Not sure yet<span class="sr"> ${esc(names)}</span></button></form>` +
    "</div></article>"
  );
}

export function renderDuplicatesPage(
  cards: DuplicateCard[],
  total: number,
  o: { personName: string; done?: string; problem?: string },
): string {
  const intro =
    "<p>Pairs of cats that may be one cat. Nothing here changes a cat until you merge them. " +
    "<strong>Likely</strong> pairs are at the top, then the newest. Rows nobody decides fade from this list after 60 days.</p>";
  const notice = o.problem
    ? `<p class="notice" role="alert">${esc(o.problem)}</p>`
    : o.done && DONE[o.done]
      ? `<p class="notice" role="status">${esc(DONE[o.done]!)}</p>`
      : "";
  const body =
    cards.length === 0
      ? '<p class="empty">Nothing to look at. No pair of cats is waiting to be decided.</p>'
      : `<h2>${total === 1 ? "1 pair" : `${total} pairs`} to look at</h2>` +
        cards.map(card).join("") +
        (total > cards.length ? `<p class="hint">Showing the first ${cards.length}. Decide some and the rest will follow.</p>` : "");
  return renderPage({
    title: "Possible duplicates",
    active: "duplicates",
    personName: o.personName,
    beforeTitle: backLink(HOME_PATH, "Home"),
    body: intro + notice + body,
  });
}
