import type { HomeData, MonthFigures, Section } from "../dashboard/home";
import { euroText } from "../euros";
import type { QueueDraft, QueueReport } from "../welfareQueue";
import type { TeamCat } from "../teamCatList";
import { placeLabel } from "../areas/placeLabel";
import { teamPhotoUrl } from "../teamCatView";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { markBar } from "./marks";
import { lastSeenWords, notSeenWords } from "./lastSeen";
import { timeAgo } from "./queuePage";

// Home: what needs us today (SYC-396 spec §4; plan PR 2.1, Task 2.1.2).
// Server-drawn, no scripts. It reads top to bottom by urgency, and a section
// shows only when it has something in it. Every value goes through escapeHtml.
//
// Home never shows response times, "open for", rankings, or who did what
// (D6): it names no team member at all. home.test pins the words.

/**
 * Features on the way (Samuel, 18 Oct 2026: "Home shows upcoming features").
 * Named, never linked. **The PR that builds each route removes its entry**:
 * team.walk.test.ts fails while a route listed here is in its TABLE. When the
 * list is empty, the line disappears.
 */
export const COMING_SOON: readonly { label: string; route: string }[] = [
  { label: "trapping plans", route: "GET /api/team/colonies/:id/plan" },
  { label: "the impact report", route: "GET /api/team/insights/impact" },
];

export const UNAVAILABLE = "This figure isn't available right now.";
export const NOTHING_NEEDS_YOU = "Nothing needs you right now.";
const NOTE_WORDS = 80;

const QUEUE = "/api/team";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const unavailable = `<p class="empty">${esc(UNAVAILABLE)}</p>`;

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** The first words of a note, on whole characters: a family emoji or a flag is one, never cut in half. */
export function firstWords(note: string | null): string {
  if (!note) return "";
  const chars = [...graphemes.segment(note.trim().replace(/\s+/g, " "))].map((s) => s.segment);
  return chars.length <= NOTE_WORDS ? chars.join("") : `${chars.slice(0, NOTE_WORDS).join("").trimEnd()}…`;
}

function reportLine(r: QueueReport, now: Date): string {
  const photo = r.photo.url
    ? `<img class="hthumb" src="${esc(r.photo.url)}" alt="The reporter's photo" loading="lazy" width="56" height="56">`
    : '<span class="hthumb nothumb">No photo</span>';
  const urgent = r.severity === "urgent" ? '<span class="tag urgent">Urgent</span> ' : "";
  const note = firstWords(r.note);
  return (
    `<li><a class="hrow" href="${QUEUE}#r-${esc(encodeURIComponent(r.id))}">${photo}<span class="htext">` +
    `<span class="hwhere">${urgent}<strong>${esc(placeLabel(r))}</strong> · <time datetime="${esc(r.at)}">${esc(timeAgo(r.at, now))}</time></span>` +
    (note ? `<span class="hnote">${esc(note)}</span>` : "") +
    "</span></a></li>"
  );
}

function draftLine(d: QueueDraft, now: Date): string {
  const kind = d.severity === "urgent" ? "Urgent" : "Needs attention";
  return (
    // One span inside the flex link, so the words stay one line of text.
    `<li><a class="hlink" href="${QUEUE}#d-${esc(encodeURIComponent(d.id))}"><span>${esc(kind)}, ${esc(placeLabel(d))} · ` +
    `<time datetime="${esc(d.startedAt)}">started ${esc(timeAgo(d.startedAt, now))}</time></span></a></li>`
  );
}

/** A count that links to its list: "Ear clips to check (3)". */
const countLink = (href: string, words: string, n: number) =>
  `<a class="hlink" href="${esc(href)}">${esc(words)} (${n})</a>`;

function needsSection(s: HomeData["needs"], now: Date): string {
  if (!s.ok) return `<section id="needs"><h2>Needs us now</h2>${unavailable}</section>`;
  const n = s.value;
  const parts: string[] = [];
  if (n.reports.length > 0) {
    parts.push(`<ul class="hlist">${n.reports.map((r) => reportLine(r, now)).join("")}</ul>`);
    parts.push(`<p><a class="hlink" href="${QUEUE}">See all ${n.reportsTotal} in the Queue</a></p>`);
  }
  if (n.unchecked > 0) {
    parts.push(`<p><a class="hlink" href="${QUEUE}#unchecked">${esc(plural(n.unchecked, "report", "reports"))} waiting for a check</a></p>`);
  }
  if (n.drafts.length > 0) {
    parts.push(
      `<h3>Started but not sent (${n.draftsTotal})</h3>` +
        `<ul class="hplain">${n.drafts.map((d) => draftLine(d, now)).join("")}</ul>`,
    );
  }
  if (n.issuesOpen > 0) parts.push(`<p>${countLink(`${QUEUE}#issues`, "Problems reported with photos or names", n.issuesOpen)}</p>`);
  // Nothing writes awaiting_team yet (plan Decision 2): hidden until something does.
  if (n.awaitingMatch > 0) parts.push(`<p>${countLink("/api/team/cats", "Sightings waiting for a match", n.awaitingMatch)}</p>`);
  return parts.length ? `<section id="needs"><h2>Needs us now</h2>${parts.join("")}</section>` : "";
}

const thumbs = (photos: readonly string[], what: string) =>
  photos.length
    ? `<span class="hstrip">${photos.map((p) => `<img src="${esc(p)}" alt="${esc(what)}" loading="lazy" width="56" height="56">`).join("")}</span>`
    : "";

function toCheckSection(s: HomeData["toCheck"]): string {
  if (!s.ok) return `<section id="tocheck"><h2>Cats to check</h2>${unavailable}</section>`;
  const { earClips, colour } = s.value;
  const lists = [
    earClips.count > 0
      ? `<li>${countLink("/api/team/likely", "Ear clips to check", earClips.count)}${thumbs(earClips.photos, "A photo of a clipped ear to check")}</li>`
      : "",
    colour.count > 0
      ? `<li>${countLink("/api/team/colour-check", "Colour check", colour.count)}${thumbs(colour.photos, "A cat whose colours need a second look")}</li>`
      : "",
  ].join("");
  return lists ? `<section id="tocheck"><h2>Cats to check</h2><ul class="hplain">${lists}</ul></section>` : "";
}

function quietCard(c: TeamCat, colonyNames: Record<number, string>, now: Date): string {
  const photo = c.photoPublicId
    ? `<img class="cardimg" src="${esc(`${teamPhotoUrl(c.photoPublicId)}/small`)}" alt="${esc(`Photo of ${c.name}`)}" loading="lazy" width="180" height="180">`
    : '<span class="cardimg nothumb">No photo</span>';
  const colony = c.colonyId === null ? "No colony" : (colonyNames[c.colonyId] ?? "Another colony");
  const seen = lastSeenWords(c.lastSeenAt, now);
  return (
    '<li class="catcard">' +
    `<a class="catcardlink" href="/api/team/cats/${c.id}">${photo}` +
    `<span class="cardname"><strong>${esc(c.name)}</strong></span>` +
    `<span class="cardfact">${esc(colony)}</span>` +
    `<span class="cardfact">${esc(seen)} · ${esc(c.place)}</span>` +
    "</a></li>"
  );
}

function notSeenSection(s: HomeData["notSeenLately"], now: Date): string {
  if (!s.ok) return `<section id="notseen"><h2>Not seen lately</h2>${unavailable}</section>`;
  const { cats, total, colonyNames } = s.value;
  if (total === 0) return "";
  const more = total - cats.length;
  return (
    '<section id="notseen"><h2>Not seen lately</h2>' +
    // A prompt to ask, never a claim that a cat has died (§4.3).
    `<p class="hint">Street cats not seen for ${notSeenWords()}. Worth asking their cat guardian whether they've been around.</p>` +
    `<ul class="catgrid">${cats.map((c) => quietCard(c, colonyNames, now)).join("")}</ul>` +
    (more > 0 ? `<p><a class="hlink" href="/api/team/cats?lives=street&amp;lastSeen=quiet">and ${more} more</a></p>` : "") +
    "</section>"
  );
}

/** "18 Oct 2026, 16:40", on Syros. */
function asOf(at: Date): string {
  const day = at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Athens" });
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
  return `${day}, ${time}`;
}

function headlineSection(s: HomeData["headline"]): string {
  if (!s.ok) return `<section id="headline"><h2>Street cats on Syros</h2>${unavailable}</section>`;
  const h = s.value;
  const also =
    h.homed + h.inCare > 0
      ? `<p class="hint">Also ${esc(plural(h.homed, "cat", "cats"))} with homes and ${h.inCare} in care.</p>`
      : "";
  return (
    '<section id="headline"><h2 class="sr">Street cats on Syros</h2>' +
    `<p class="hbig"><strong>${h.street}</strong> ${h.street === 1 ? "street cat" : "street cats"} known on Syros</p>` +
    markBar(h.split) +
    `<p class="hint">As of ${esc(asOf(h.at))}</p>` +
    also +
    // The report behind the headline (§4.4; SYC-396 PR 3.3a). Home is island-only, as the report is.
    '<p><a class="hlink" href="/api/team/insights/progress">See Sterilisation progress</a></p>' +
    "</section>"
  );
}

const figure = (words: string, now: number | string, last: number | string) =>
  `<li><span class="hfig">${now}</span> <span>${esc(words)}</span> <span class="hint">(last month ${last})</span></li>`;

function monthSection(s: Section<{ now: MonthFigures; last: MonthFigures }>, costs: boolean): string {
  if (!s.ok) return `<section id="month"><h2>This month</h2>${unavailable}</section>`;
  const { now, last } = s.value;
  return (
    '<section id="month"><h2>This month</h2><ul class="hfigs">' +
    figure("Sightings", now.sightings, last.sightings) +
    figure("New cats recorded", now.newCats, last.newCats) +
    figure("Sterilisations done", now.sterilisations, last.sterilisations) +
    // Money is the team's only (§8.4): `view_vet_costs`.
    (costs ? figure("Vet spend", euroText(now.vetSpendEur), euroText(last.vetSpendEur)) : "") +
    "</ul></section>"
  );
}

/** The team's named areas, to correct the list (SYC-396 PR 2.4). Home is island-only, so no other check. */
export const AREAS_LINE = '<p id="areas-link"><a class="hlink" href="/api/team/areas">Areas: the place names used in labels and filters</a></p>';

/** One quiet line, no links. Gone once every feature on it has arrived. */
export function comingSoonLine(list: readonly { label: string }[] = COMING_SOON): string {
  if (list.length === 0) return "";
  return `<p class="hsoon" id="soon">Coming soon: ${list.map((f) => esc(f.label)).join(" · ")}</p>`;
}

const isEmpty = (d: HomeData) =>
  d.needs.ok &&
  d.toCheck.ok &&
  d.notSeenLately.ok &&
  needsSection(d.needs, d.at) === "" &&
  toCheckSection(d.toCheck) === "" &&
  d.notSeenLately.value.total === 0;

export function renderHomePage(d: HomeData, o: { personName: string; now: Date; costs?: boolean }): string {
  const body =
    (isEmpty(d) ? `<p class="empty" id="nothing">${esc(NOTHING_NEEDS_YOU)}</p>` : "") +
    needsSection(d.needs, o.now) +
    toCheckSection(d.toCheck) +
    notSeenSection(d.notSeenLately, o.now) +
    headlineSection(d.headline) +
    monthSection(d.month, o.costs === true) +
    AREAS_LINE +
    comingSoonLine();
  return renderPage({ title: "Home", active: "home", personName: o.personName, body });
}
