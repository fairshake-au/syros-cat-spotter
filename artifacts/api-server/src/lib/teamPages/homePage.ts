import type { HomeData, HomeNeeds, HomeToCheck, MonthFigures, Section, TrapNext } from "../dashboard/home";
import type { MatcherStatus } from "../matcherHealth";
import type { Headline } from "../dashboard/countedCats";
import type { TrapColony } from "../dashboard/trapNext";
import { wholePct } from "../dashboard/colonyFigures";
import { euroText } from "../euros";
import type { QueueReport } from "../welfareQueue";
import { placeLabel } from "../areas/placeLabel";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { WORDS_PATH, pageIntro } from "./help";
import { markBar } from "./marks";
import { flagChip } from "./colonyPages";
import { wordsIn } from "./words";
import { timeAgo } from "./queuePage";
import { firstWords } from "./noteWords";

// Home: Today, Where to trap next, How we're doing (SYC-603; spec §4, D12).
// Server-drawn, no scripts. The three parts are in reading order in the page;
// from 1000px CSS alone puts Today beside the other two.
//
// A figure that couldn't be worked out says so in its own place, and is never
// shown as a zero: "Nothing waiting right now" needs every Today read to have
// worked (§4.4).
//
// Home never shows response times, "open for", rankings of people, or who did
// what (D6): it names no team member at all. team.home.test pins the words.

export const UNAVAILABLE = "This figure isn't available right now.";
export const NOTHING_WAITING = "Nothing waiting right now.";

const QUEUE = "/api/team";
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const unavailable = `<p class="empty">${esc(UNAVAILABLE)}</p>`;

// ---- Today (§4.1) ----

function reportLine(r: QueueReport, now: Date): string {
  const photo = r.photo.url
    ? `<img class="hthumb" src="${esc(r.photo.url)}" alt="The reporter's photo" loading="lazy" width="56" height="56">`
    : '<span class="hthumb nothumb">No photo</span>';
  // A word as well as the red band: never colour alone (§12.5).
  const tags =
    (r.severity === "urgent" ? '<span class="tag urgent">Urgent</span> ' : "") +
    (r.isLitter ? '<span class="tag kittens">Kittens</span> ' : "");
  const note = firstWords(r.note);
  return (
    `<li><a class="hrow${r.severity === "urgent" ? " urgent" : ""}" href="${QUEUE}?open=${esc(encodeURIComponent(r.id))}#r-${esc(encodeURIComponent(r.id))}">${photo}<span class="htext">` +
    `<span class="hwhere">${tags}<strong>${esc(placeLabel(r))}</strong> · <time datetime="${esc(r.at)}">${esc(timeAgo(r.at, now))}</time></span>` +
    (note ? `<span class="hnote">${esc(note)}</span>` : "") +
    "</span></a></li>"
  );
}

/** A count tile: the number and its words read as one link ("4 ear clips to check"). Only above zero. */
const tile = (href: string, n: number, one: string, many: string, gloss = "") =>
  n > 0
    ? `<li><a class="htile" href="${esc(href)}"><span class="hn">${n}</span> <span>${esc(plural(n, one, many))}</span></a>` +
      (gloss ? `<span class="hint">${esc(gloss)}</span>` : "") +
      "</li>"
    : "";

/** A count tile for a figure of its own: the tile, nothing, or the "isn't available" line where it would sit. */
const countTile = (s: Section<number>, href: string, one: string, many: string, gloss = ""): { html: string; n: number } =>
  s.ok
    ? { html: tile(href, s.value, one, many, gloss), n: s.value }
    : { html: `<li class="hwide">${unavailable}</li>`, n: 0 };

/**
 * SYC-532: shown while the look-alike check is failing (5 or more in 15
 * minutes). Fixed words and two numbers; no photo, cat, person or position.
 * Only a figure that couldn't be read hides it, so it errs towards telling.
 */
export function matcherBanner(s: Section<MatcherStatus>): string {
  if (!s.ok || !s.value.failing) return "";
  const { failed, windowMinutes } = s.value;
  return (
    '<p class="notice down" id="matcher-down" role="status"><strong>The look-alike check is failing.</strong> ' +
    `${esc(`${failed} photo checks failed in the last ${windowMinutes} minutes. Spotters are being told we couldn't check their photo, and some may name a cat that is already known.`)} ` +
    '<a class="hlink" href="/api/team/new-cats-to-check">See new cats to check</a></p>'
  );
}

function todaySection(needs: HomeNeeds, toCheck: HomeToCheck, now: Date): string {
  const banner = matcherBanner(needs.matcher);
  const parts: string[] = banner ? [banner] : [];
  const tiles: string[] = [];
  let waiting = 0;
  let allRead = true;

  const reports = needs.reports;
  if (!reports.ok) {
    allRead = false;
    parts.push(unavailable);
  } else {
    const n = reports.value;
    if (n.lines.length > 0) {
      parts.push(`<ul class="hlist">${n.lines.map((r) => reportLine(r, now)).join("")}</ul>`);
      if (n.linesTotal > n.lines.length) {
        parts.push(`<p><a class="hlink" href="${QUEUE}">See all ${n.linesTotal} urgent and kitten reports in the Queue</a></p>`);
      }
    }
    if (n.unchecked > 0) {
      const words = `${n.unchecked} ${plural(n.unchecked, "report", "reports")} arrived while our spam check was down`;
      parts.push(`<p class="notice"><a class="hlink" href="${QUEUE}#unchecked">${esc(words)}</a></p>`); // 44px tap (§12.5)
    }
    const more = n.lines.length > 0;
    tiles.push(tile(QUEUE, n.otherOpen, more ? "more report" : "open report", more ? "more reports" : "open reports", "Reports from the public that nobody has closed yet."));
    waiting += n.linesTotal + n.unchecked + n.otherOpen;
  }

  const figures = [
    countTile(needs.issuesOpen, `${QUEUE}#issues`, "problem with a photo or name", "problems with photos or names", "Problems the public reported with a cat's photo, name or page."),
    // Nothing writes awaiting_team yet (plan Decision 2): the tile stays hidden until something does.
    countTile(needs.awaitingMatch, "/api/team/cats", "sighting to match", "sightings to match", "A spotter's sighting that is waiting for the team to match it to a cat."),
    countTile(toCheck.earClips, "/api/team/likely", "ear clip to check", "ear clips to check", "Cats a spotter thinks have a clipped ear. Look at the photo and confirm."),
    countTile(toCheck.colour, "/api/team/colour-check", "cat for the colour check", "cats for the colour check", "Cats whose recorded colour or markings may not match their photos."),
    countTile(toCheck.newCats, "/api/team/new-cats-to-check", "new cat to check for a duplicate", "new cats to check for duplicates", "New cats added when the look-alike check was down. They may already be in the app."),
  ];
  for (const f of figures) {
    tiles.push(f.html);
    waiting += f.n;
  }
  allRead &&= [needs.issuesOpen, needs.awaitingMatch, toCheck.earClips, toCheck.colour, toCheck.newCats].every((x) => x.ok);

  const tileList = tiles.join("");
  if (tileList) parts.push(`<ul class="htiles">${tileList}</ul>`);
  if (allRead && waiting === 0 && !banner) parts.push(`<p class="empty" id="nothing">${esc(NOTHING_WAITING)}</p>`);
  return `<section id="today"><h2>Today</h2>${parts.join("")}</section>`;
}

// ---- Where to trap next (§4.2) ----

function trapRow(c: TrapColony, priceEur: number): string {
  const kittens = c.kittens ? flagChip(wordsIn("en"), "kittens") : "";
  return (
    '<li class="trow">' +
    `<span class="ttop"><a href="/api/team/colonies/${c.colonyId}"><strong>${esc(c.name)}</strong></a>` +
    `<span class="tcost">${esc(`${c.toDo} to do · up to ${euroText(c.toDo * priceEur)}`)}</span></span>` +
    markBar(c.split, { label: "Street cats" }) +
    `<span class="hint">${esc(`${c.street} ${plural(c.street, "street cat", "street cats")} · ${c.sterilised} sterilised`)}</span>` +
    kittens +
    "</li>"
  );
}

function trapSection(s: Section<TrapNext>): string {
  const head = '<section id="trap"><h2>Where to trap next</h2>';
  if (!s.ok) return `${head}${unavailable}</section>`;
  const t = s.value;
  const parts: string[] = [];
  if (t.colonyCount === 0) {
    parts.push(
      '<p class="empty">No colonies yet. Grouping cats into colonies lets you plan trapping rounds. ' +
        '<a class="hlink" href="/api/team/colonies#create">Create a colony</a></p>',
    );
  } else if (t.colonies.length === 0) {
    // "All sterilised" is only true when some colony has street cats (SYC-620).
    parts.push(
      t.colonyStreet > 0
        ? "<p class=\"empty\">Every colony's street cats are sterilised.</p>"
        : '<p class="empty">No street cats in any colony yet.</p>',
    );
  } else {
    parts.push(
      `<p class="hint">${esc("The colonies with the most street cats still to sterilise come first.")}</p>`,
    );
    parts.push(`<ul class="trap">${t.colonies.map((c) => trapRow(c, t.priceEur)).join("")}</ul>`);
    parts.push(
      `<p class="hint">${esc(`To do: street cats not sterilised, not known, or probably sterilised. At the standard price of ${euroText(t.priceEur)} a cat.`)}</p>`,
    );
  }
  if (t.noColony > 0) {
    // "Plus" only follows something above it: with no colonies, there is nothing to add to.
    const lead = t.colonyCount === 0 ? "" : "Plus ";
    const rest =
      t.noColony === 1
        ? "1 street cat to do that isn't in a colony."
        : `${t.noColony} street cats to do that aren't in a colony.`;
    const words = t.colonyCount === 0 ? rest.charAt(0).toUpperCase() + rest.slice(1) : lead + rest;
    parts.push(`<p class="hint">${words}</p>`); // fixed words and a number only
  }
  if (t.colonyCount > 0) parts.push('<p><a class="hlink" href="/api/team/colonies">See all colonies</a></p>');
  return `${head}${parts.join("")}</section>`;
}

// ---- How we're doing (§4.3) ----

/** "18 Oct 2026, 16:40", on Syros. */
function asOf(at: Date): string {
  const day = at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Athens" });
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
  return `${day}, ${time}`;
}

function monthLine(s: Section<{ now: MonthFigures; last: MonthFigures }>, costs: boolean): string {
  if (!s.ok) return unavailable;
  const { now, last } = s.value;
  const steril = `${now.sterilisations} ${plural(now.sterilisations, "sterilisation", "sterilisations")} this month (${last.sterilisations} last month)`;
  // Money is the team's only (§8.4): `view_vet_costs`.
  const spend = costs ? ` · ${euroText(now.vetSpendEur)} vet spend, paid by Syros Cats or by donations` : "";
  return `<p>${esc(steril + spend)}</p>`;
}

function progressSection(h: Section<Headline>, month: Section<{ now: MonthFigures; last: MonthFigures }>, costs: boolean): string {
  const head = "<section id=\"progress\"><h2>How we're doing</h2>";
  if (!h.ok) return `${head}${unavailable}</section>`;
  const v = h.value;
  if (v.street === 0) return `${head}<p class="empty">No street cats recorded yet</p></section>`;
  const also =
    v.homed + v.inCare > 0
      ? `<p class="hint">Also ${v.homed} ${plural(v.homed, "cat", "cats")} with homes and ${v.inCare} in care.</p>`
      : "";
  return (
    head +
    `<p class="hbig"><strong>${v.street}</strong> ${plural(v.street, "street cat", "street cats")} · ${wholePct(v.split.sterilised, v.street)}% confirmed sterilised</p>` +
    markBar(v.split) +
    monthLine(month, costs) +
    `<p class="hint">As of ${esc(asOf(v.at))}</p>` +
    also +
    // The report behind the headline (§4.3; SYC-396 PR 3.3a). Home is island-only, as the report is.
    '<p><a class="hlink" href="/api/team/insights/progress">See Sterilisation progress</a></p>' +
    "</section>"
  );
}

/** Record vet visits (SYC-677): with the work links, for someone who holds the three capabilities a batch needs. */
const BATCHES_LINE = '<p id="vet-batches-link"><a class="hlink" href="/api/team/vet-batches">Record vet visits</a></p>';

export function renderHomePage(d: HomeData, o: { personName: string; now: Date; costs?: boolean; batches?: boolean }): string {
  const body =
    pageIntro("Your starting point. Today lists what needs a person; tap a number to open that list.") +
    `<p class="hint">New here? <a class="hlink" href="${WORDS_PATH}">Words we use</a> explains the terms on these pages.</p>` +
    '<div class="hgrid">' +
    todaySection(d.needs, d.toCheck, o.now) +
    `<div class="hside">${trapSection(d.trapNext)}${o.batches === true ? BATCHES_LINE : ""}${progressSection(d.headline, d.month, o.costs === true)}</div>` +
    "</div>";
  // Wide, as the Cats grid is: two columns from 1000px need more than the 760px reading column.
  return renderPage({ title: "Home", active: "home", personName: o.personName, body, mainClass: "wide" });
}
