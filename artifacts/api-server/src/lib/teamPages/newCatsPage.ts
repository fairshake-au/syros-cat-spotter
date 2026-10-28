import type { NewCatToCheck } from "../matcherHealth";
import { NEW_CATS_DAYS } from "../matcherHealth";
import type { NearbyCat } from "../newCatsNearby";
import { shownName, syrNumber } from "../teamCatView";
import { escapeHtml as esc } from "./escape";
import { backLink, HOME_PATH } from "./backLink";
import { renderPage } from "./layout";
import { mergeHref } from "./mergeLinks";

// New cats to check (SYC-531). Cats a spotter named after the look-alike
// check failed for their photo: the likeliest duplicates. Server-drawn, no
// scripts. Fixed words and the cat's own name only; the spot's photo comes
// from the team photo route. SYC-59 PR 5.1: each cat shows the nearby cats'
// photos beside it, "Same as…" (opens the merge screen with this cat filled
// in) and "Checked, it's new" (so the list can empty).

const when = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Athens" }) +
  ", " +
  d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });

function nearbyRow(nearby: readonly NearbyCat[]): string {
  if (nearby.length === 0) return '<p class="meta">No cats within 1.5 km.</p>';
  return (
    '<h3>Cats nearby</h3><div class="nearby">' +
    nearby
      .map(
        (n) =>
          `<figure><a href="/api/team/cats/${n.id}">` +
          (n.photoUrl
            ? `<img src="${esc(n.photoUrl)}" alt="${esc(`Photo of ${n.name}`)}" loading="lazy" width="88" height="88">`
            : '<span class="hthumb nothumb">No photo</span>') +
          `</a><figcaption>${esc(n.name)} · ${esc(n.apart)}</figcaption></figure>`,
      )
      .join("") +
    "</div>"
  );
}

function card(c: NewCatToCheck, nearby: readonly NearbyCat[]): string {
  const name = shownName({ name: c.name, namePending: c.namePending });
  const photo = c.photoUrl
    ? `<a href="${esc(c.photoUrl)}"><img class="hthumb" src="${esc(c.photoUrl)}" alt="${esc(`Photo of ${name}`)}" loading="lazy" width="96" height="96"></a>`
    : '<span class="hthumb nothumb">No photo</span>';
  return (
    `<article class="report likely" id="c-${c.catId}">` +
    `<div class="head"><a href="/api/team/cats/${c.catId}"><strong>${esc(name)}</strong></a> <span class="syr">${esc(syrNumber(c.catId))}</span></div>` +
    `<p class="meta">Named as a new cat on ${esc(when(c.at))}, after the photo check failed.</p>` +
    photo +
    nearbyRow(nearby) +
    '<div class="dupactions">' +
    `<a class="go tap" href="${esc(mergeHref({ a: c.catId }))}">Same as…<span class="sr"> ${esc(name)}</span></a>` +
    `<form method="post" action="/api/team/new-cats-to-check/${c.catId}/checked">` +
    `<button type="submit">Checked, it's new<span class="sr"> ${esc(name)}</span></button></form>` +
    `<a class="hlink" href="/api/team/cats/${c.catId}">Open the cat's page</a></div></article>`
  );
}

export function renderNewCatsPage(cats: NewCatToCheck[], personName: string, nearby: ReadonlyMap<number, NearbyCat[]> = new Map()): string {
  const intro =
    `<p>When the photo check fails, a spotter can still choose <strong>It's a new cat</strong>. These cats were named that way in the last ${NEW_CATS_DAYS} days. ` +
    "Each could already be in the catalogue. Compare it with the cats nearby. If it is one of them, choose <strong>Same as…</strong>. " +
    "If it really is new, choose <strong>Checked, it's new</strong> and it leaves this list.</p>";
  const body =
    cats.length === 0
      ? '<p class="empty">Nothing to check. No new cat was named after a failed photo check in the last ' + NEW_CATS_DAYS + " days.</p>"
      : `<h2>${cats.length === 1 ? "1 cat" : `${cats.length} cats`} to check</h2>` + cats.map((c) => card(c, nearby.get(c.catId) ?? [])).join("");
  return renderPage({
    title: "New cats to check",
    active: "newcats",
    personName,
    beforeTitle: backLink(HOME_PATH, "Home"),
    body: (cats.length === 0 ? "" : intro) + body,
  });
}
