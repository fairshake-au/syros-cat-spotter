import type { DerivedCatStatus } from "../catHelpers";
import type { Confidence, LifeStatusValue } from "../resolve";
import type {
  TeamCatSearchResult,
  TeamCatView,
  TeamResolved,
  TeamStatement,
} from "../teamCatView";
import { QUERY_MAX } from "../teamCatView";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";

// The team's "Cats" screens (SYC-43 part 2 plan, PR 3): finding a cat, and
// the team's page for one cat. Read-only. Server-drawn, no scripts. Every
// value goes through escapeHtml; the data comes only from lib/teamCatView.ts.

const LIFE: Record<LifeStatusValue, string> = {
  street: "Lives on the street",
  homed: "Has a home",
  in_care: "In care",
  deceased: "Has died",
};

const CONFIDENCE: Record<Confidence, string> = {
  confirmed: "confirmed",
  likely: "likely",
  reported: "reported",
  unknown: "not known",
};

/** Dates on Syros: the team reads them in Greek time. */
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Athens",
  });

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Athens",
  });

const time = (iso: string, text = when(iso)) =>
  `<time datetime="${esc(iso)}">${esc(text)}</time>`;

const place = (lat: number, lng: number) => {
  // Exact: the stored numbers as they are, never rounded.
  const here = `${lat}, ${lng}`;
  // A plain link: leaving the dashboard sends nothing until it is tapped.
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
  return `${esc(here)} &middot; <a href="${esc(map)}" rel="noopener noreferrer">Open map</a>`;
};

const row = (label: string, value: string) =>
  `<dt>${esc(label)}</dt><dd>${value}</dd>`;

/** The sterilised line in the public's words. */
function sterilisedText(s: { value: boolean | null; confidence: Confidence }): string {
  if (s.value === null || s.confidence === "unknown") return "Not known yet";
  if (s.value) {
    if (s.confidence === "likely") return "Probably sterilised";
    if (s.confidence === "reported") return "Reported sterilised";
    return "Sterilised";
  }
  return s.confidence === "reported" ? "Reported not sterilised" : "Not sterilised";
}

function publicStatusText(s: DerivedCatStatus): string {
  const life = LIFE[s.lifeStatus];
  const seen = s.notSeenSince ? ` · Not seen since ${day(s.notSeenSince)}` : "";
  return `${life} · ${sterilisedText(s.sterilised)}${seen}`;
}

// ── Finding a cat ──────────────────────────────────────────────────────────

const catHref = (id: number) => `/api/team/cats/${id}`;

function resultCard(c: TeamCatSearchResult): string {
  const thumb = c.thumbnailUrl
    ? `<img class="thumb" src="${esc(c.thumbnailUrl)}" alt="" loading="lazy">`
    : '<span class="thumb nothumb">No photo</span>';
  return (
    `<li><a class="catrow" href="${esc(catHref(c.id))}">${thumb}` +
    `<span><strong>${esc(c.name)}</strong> <span class="syr">${esc(c.syr)}</span>` +
    `<span class="status">${esc(publicStatusText(c.status))}</span></span></a></li>`
  );
}

export function renderCatSearchPage(
  query: string,
  results: TeamCatSearchResult[],
  personName: string,
): string {
  const form =
    '<form class="search" method="get" action="/api/team/cats" role="search">' +
    '<label class="label" for="q">Name or SYR number</label>' +
    `<div class="searchrow"><input id="q" name="q" type="search" value="${esc(query)}" maxlength="${QUERY_MAX}" autocomplete="off" autocapitalize="none" spellcheck="false">` +
    '<button type="submit">Find</button></div></form>';
  let body: string;
  if (query.trim() === "") {
    body = '<p class="empty">Type a name, or a number like SYR-0012.</p>';
  } else if (results.length === 0) {
    body = `<p class="empty">No cat matches “${esc(query)}” by name or SYR number.</p>`;
  } else {
    const more =
      results.length >= 30
        ? '<p class="empty">Showing the first 30. Type more of the name to narrow it.</p>'
        : "";
    body = `<ul class="cats">${results.map(resultCard).join("")}</ul>${more}`;
  }
  return renderPage({ title: "Cats", active: "cats", personName, body: form + body });
}

// ── The team's cat page ────────────────────────────────────────────────────

const statementLink = (id: number) => `<a href="#s-${id}">#${id}</a>`;
const statementLinks = (ids: number[]) =>
  ids.length ? ids.map(statementLink).join(", ") : "none";

function recordBlock<T>(
  label: string,
  r: TeamResolved<T>,
  valueText: string,
  extra: string,
): string {
  return (
    `<h3>${esc(label)}</h3><dl>` +
    row("Records say", `${esc(valueText)} <span class="tag">${esc(CONFIDENCE[r.confidence])}</span>`) +
    row("As of", time(r.asOf, day(r.asOf))) +
    row("Based on", statementLinks(r.supportingStatementIds)) +
    (r.conflictingStatementIds.length
      ? row("Disagrees", `<span class="bad">${statementLinks(r.conflictingStatementIds)}</span>`)
      : "") +
    extra +
    "</dl>"
  );
}

function statementItem(s: TeamStatement, byId: Map<number, TeamStatement>): string {
  const replaced = s.replacedBy.length > 0;
  const said = replaced ? `<del>${esc(s.said)}</del>` : esc(s.said);
  const differs = Math.abs(Date.parse(s.observedAt) - Date.parse(s.createdAt)) > 60_000;
  const meta =
    `${esc(s.author.label)} · ${time(s.createdAt)}` +
    (differs ? ` · about ${time(s.observedAt)}` : "");
  const replacements = s.replacedBy
    .map((id) => byId.get(id))
    .filter((r): r is TeamStatement => r !== undefined)
    .map(
      (r) =>
        `<p class="replacement">Replaced by ${statementLink(r.id)}: ${esc(r.said)}` +
        (r.reason ? `. Why: ${esc(r.reason)}` : "") +
        ` <span class="meta">(${esc(r.author.label)}, ${time(r.createdAt)})</span></p>`,
    )
    .join("");
  return (
    `<li class="statement${replaced ? " replaced" : ""}" id="s-${s.id}">` +
    `<p class="said"><span class="sid">#${s.id}</span> ${said}</p>` +
    `<p class="meta">${meta}</p>` +
    (s.reason ? `<p class="why">Why: ${esc(s.reason)}</p>` : "") +
    (s.replaces != null ? `<p class="meta">Corrects ${statementLink(s.replaces)}</p>` : "") +
    (s.photoUrl ? `<p class="meta"><a href="${esc(s.photoUrl)}">Photo</a></p>` : "") +
    replacements +
    "</li>"
  );
}

export function renderCatPage(v: TeamCatView, personName: string): string {
  const { cat, records } = v;
  const main = cat.mainPhotoUrl
    ? `<img class="photo" src="${esc(cat.mainPhotoUrl)}" alt="Main photo of ${esc(cat.name)}">`
    : '<div class="nophoto">No photo</div>';

  const overview =
    `<p class="syrline"><span class="syr">${esc(cat.syr)}</span></p>` +
    main +
    (cat.description ? `<p>${esc(cat.description)}</p>` : "") +
    "<h2>What the public sees</h2>" +
    `<p class="public">${esc(publicStatusText(v.publicStatus))}</p>` +
    "<h2>What the records say</h2>" +
    '<p class="hint">Team only. How the answer above was worked out.</p>' +
    recordBlock(
      "Life",
      records.lifeStatus,
      records.lifeStatus.value ? LIFE[records.lifeStatus.value] : "Not known",
      (records.lifeStatus.notSeenSince
        ? row("Not seen since", time(records.lifeStatus.notSeenSince, day(records.lifeStatus.notSeenSince)))
        : "") +
        (records.lifeStatus.presumedDeceased
          ? row("Note", "Not seen for so long it may have died. The public is never told this.")
          : ""),
    ) +
    recordBlock(
      "Sterilised",
      records.sterilised,
      sterilisedText(records.sterilised),
      row("Clipped ear seen", esc(String(records.sterilised.clippedTipSightings))),
    ) +
    "<h2>First recorded</h2><dl>" +
    row("Where", place(cat.lat, cat.lng)) +
    row("When", time(cat.createdAt)) +
    "</dl>";

  const sightings =
    `<h2>Sightings (${v.sightings.length})</h2>` +
    (v.sightings.length === 0
      ? '<p class="empty">No sightings yet.</p>'
      : '<ul class="sightings">' +
        v.sightings
          .map(
            (s) =>
              "<li>" +
              (s.photoUrl
                ? `<a href="${esc(s.photoUrl)}"><img class="thumb" src="${esc(s.photoUrl)}" alt="" loading="lazy"></a>`
                : '<span class="thumb nothumb">No photo</span>') +
              `<span>${time(s.at)}<br>${place(s.lat, s.lng)}</span></li>`,
          )
          .join("") +
        "</ul>");

  const photos =
    `<h2>Photos (${v.photos.length})</h2>` +
    (v.photos.length === 0
      ? '<p class="empty">No photos.</p>'
      : '<div class="gallery">' +
        v.photos
          .map(
            (p) =>
              `<a href="${esc(p.url)}"><img src="${esc(p.url)}" alt="" loading="lazy"></a>`,
          )
          .join("") +
        "</div>");

  const byId = new Map(v.history.map((s) => [s.id, s]));
  const history =
    `<h2>What has been said (${v.history.length})</h2>` +
    '<p class="hint">Newest first. Nothing is ever deleted: a statement that was corrected stays, struck through, with what replaced it.</p>' +
    (v.history.length === 0
      ? '<p class="empty">Nothing has been said about this cat yet.</p>'
      : `<ol class="history">${v.history.map((s) => statementItem(s, byId)).join("")}</ol>`);

  return renderPage({
    title: cat.name,
    active: "cats",
    personName,
    body:
      '<p class="back"><a href="/api/team/cats">Find another cat</a></p>' +
      overview +
      sightings +
      photos +
      history,
  });
}

export function renderNoSuchCat(personName: string): string {
  return renderPage({
    title: "No such cat",
    active: "cats",
    personName,
    body: '<p>There is no cat with that number.</p><p><a href="/api/team/cats">Find a cat</a></p>',
  });
}
