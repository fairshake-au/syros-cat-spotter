import type { NewCatToCheck } from "../matcherHealth";
import { NEW_CATS_DAYS } from "../matcherHealth";
import { shownName, syrNumber } from "../teamCatView";
import { escapeHtml as esc } from "./escape";
import { backLink, HOME_PATH } from "./backLink";
import { renderPage } from "./layout";

// New cats to check (SYC-531). Cats a spotter named after the look-alike
// check failed for their photo: the likeliest duplicates. Server-drawn, no
// scripts. Fixed words and the cat's own name only; the spot's photo comes
// from the team photo route.

const when = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Athens" }) +
  ", " +
  d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });

function card(c: NewCatToCheck): string {
  const name = shownName({ name: c.name, namePending: c.namePending });
  const photo = c.photoUrl
    ? `<a href="${esc(c.photoUrl)}"><img class="hthumb" src="${esc(c.photoUrl)}" alt="${esc(`Photo of ${name}`)}" loading="lazy" width="96" height="96"></a>`
    : '<span class="hthumb nothumb">No photo</span>';
  return (
    `<article class="report likely" id="c-${c.catId}">` +
    `<div class="head"><a href="/api/team/cats/${c.catId}"><strong>${esc(name)}</strong></a> <span class="syr">${esc(syrNumber(c.catId))}</span></div>` +
    `<p class="meta">Named as a new cat on ${esc(when(c.at))}, after the photo check failed.</p>` +
    photo +
    `<p><a class="hlink" href="/api/team/cats/${c.catId}">Open the cat's page to compare</a></p></article>`
  );
}

export function renderNewCatsPage(cats: NewCatToCheck[], personName: string): string {
  const intro =
    `<p>When the photo check fails, a spotter can still choose <strong>It's a new cat</strong>. These cats were named that way in the last ${NEW_CATS_DAYS} days. ` +
    "Each could already be in the catalogue. Open the cat and compare it with the cats nearby.</p>" +
    '<p class="hint">Joining two cats together comes with the duplicate review (SYC-59). Until then, this list shows them and links to each cat.</p>';
  const body =
    cats.length === 0
      ? '<p class="empty">Nothing to check. No new cat was named after a failed photo check in the last ' + NEW_CATS_DAYS + " days.</p>"
      : `<h2>${cats.length === 1 ? "1 cat" : `${cats.length} cats`} to check</h2>` + cats.map(card).join("");
  return renderPage({
    title: "New cats to check",
    active: "newcats",
    personName,
    beforeTitle: backLink(HOME_PATH, "Home"),
    body: (cats.length === 0 ? "" : intro) + body,
  });
}
