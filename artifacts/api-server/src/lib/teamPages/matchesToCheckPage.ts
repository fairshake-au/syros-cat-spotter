import type { MatchToCheck } from "../matchesToCheck";
import { syrNumber } from "../teamCatView";
import { escapeHtml as esc } from "./escape";
import { backLink, HOME_PATH } from "./backLink";
import { renderPage } from "./layout";

// Matches to check (SYC-795, launch measures spec §4.6). Suggestions spotters
// took, oldest first, for Samuel to answer "Looks right" or "Different cat".
// Server-drawn, no scripts. Each row shows the spotter's photo beside the
// chosen cat's main photo, the cat, the area and day, and which suggestion it
// was. It names no spotter and no device, and gives no position.

export const MATCHES_PATH = "/api/team/matches-to-check";

const ORDINAL: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd" };

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Athens" });

/** The move screen with this sighting ticked, coming from this list (so the report counts it as checked). */
export const differentCatHref = (m: Pick<MatchToCheck, "catId" | "sightingId">): string =>
  `/api/team/sightings/move?cat=${m.catId}&s=${m.sightingId}&source=match_check`;

const photo = (url: string | null, alt: string) =>
  url
    ? `<a href="${esc(url)}"><img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" width="160" height="160"></a>`
    : '<span class="nophoto">No photo</span>';

function row(m: MatchToCheck): string {
  const name = m.catName;
  return (
    `<article class="report matchrow" id="m-${m.sightingId}">` +
    '<div class="matchphotos">' +
    `<figure>${photo(m.sightingPhotoUrl, "The spotter's photo")}<figcaption>Spotter's photo</figcaption></figure>` +
    `<figure>${photo(m.catPhotoUrl, `Main photo of ${name}`)}<figcaption>${esc(name)}'s main photo</figcaption></figure>` +
    "</div>" +
    `<p class="head"><a class="catlink" href="/api/team/cats/${m.catId}"><strong>${esc(name)}</strong></a> <span class="syr">${esc(syrNumber(m.catId))}</span></p>` +
    `<p class="meta">${esc(m.area)} · ${esc(day(m.spottedAt))}</p>` +
    `<p class="meta">${esc(ORDINAL[m.rank] ?? `${m.rank}th`)} suggestion</p>` +
    '<div class="dupactions">' +
    `<form method="post" action="${MATCHES_PATH}/${m.sightingId}/looks-right">` +
    `<button type="submit">Looks right<span class="sr"> ${esc(name)}</span></button></form>` +
    `<a class="go tap" href="${esc(differentCatHref(m))}">Different cat<span class="sr"> ${esc(name)}</span></a>` +
    "</div></article>"
  );
}

export function renderMatchesToCheckPage(matches: MatchToCheck[], personName: string): string {
  const intro =
    "<p>Suggestions spotters took since launch that nobody has checked. Look at the two photos. " +
    "<strong>Looks right</strong> takes the row off this list. <strong>Different cat</strong> opens the move screen with this sighting ticked. " +
    "The oldest come first, and the order is fixed, so skipping a row leaves it at the top.</p>";
  const body =
    matches.length === 0
      ? '<p class="empty">Nothing to check. No suggestion a spotter took is waiting for a check.</p>'
      : `<h2>${matches.length === 1 ? "1 match" : `${matches.length} matches`} to check</h2>` + matches.map(row).join("");
  return renderPage({
    title: "Matches to check",
    active: "matchcheck",
    personName,
    beforeTitle: backLink(HOME_PATH, "Home"),
    body: intro + body,
  });
}
