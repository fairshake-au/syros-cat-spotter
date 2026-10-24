import type { HomeData, HomeNeeds, HomeToCheck, MonthFigures, Section, TrapNext } from "../dashboard/home";
import type { Headline } from "../dashboard/countedCats";
import type { TrapColony } from "../dashboard/trapNext";
import { wholePct } from "../dashboard/colonyFigures";
import { euroText } from "../euros";
import type { QueueReport } from "../welfareQueue";
import { placeLabel } from "../areas/placeLabel";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
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
const tile = (href: string, n: number, one: string, many: string) =>
  n > 0
    ? `<li><a class="htile" href="${esc(href)}"><span class="hn">${n}</span> <span>${esc(plural(n, one, many))}</span></a></li>`
    : "";

function todaySection(needs: Section<HomeNeeds>, toCheck: Section<HomeToCheck>, now: Date): string {
  const parts: string[] = [];
  const tiles: string[] = [];
  let waiting = 0;

  if (!needs.ok) {
    parts.push(unavailable);
  } else {
    const n = needs.value;
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
    tiles.push(
      tile(QUEUE, n.otherOpen, more ? "more report" : "open report", more ? "more reports" : "open reports"),
      tile(`${QUEUE}#issues`, n.issuesOpen, "problem with a photo or name", "problems with photos or names"),
      // Nothing writes awaiting_team yet (plan Decision 2): the tile stays hidden until something does.
      tile("/api/team/cats", n.awaitingMatch, "sighting to match", "sightings to match"),
    );
    waiting += n.linesTotal + n.unchecked + n.otherOpen + n.issuesOpen + n.awaitingMatch;
  }

  if (!toCheck.ok) {
    tiles.push(`<li class="hwide">${unavailable}</li>`);
  } else {
    const c = toCheck.value;
    tiles.push(
      tile("/api/team/likely", c.earClips, "ear clip to check", "ear clips to check"),
      tile("/api/team/colour-check", c.colour, "cat for the colour check", "cats for the colour check"),
    );
    waiting += c.earClips + c.colour;
  }

  const tileList = tiles.join("");
  if (tileList) parts.push(`<ul class="htiles">${tileList}</ul>`);
  if (needs.ok && toCheck.ok && waiting === 0) parts.push(`<p class="empty" id="nothing">${esc(NOTHING_WAITING)}</p>`);
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
    parts.push("<p class=\"empty\">Every colony's street cats are sterilised.</p>");
  } else {
    parts.push(`<ul class="trap">${t.colonies.map((c) => trapRow(c, t.priceEur)).join("")}</ul>`);
    parts.push(
      `<p class="hint">${esc(`To do: street cats not sterilised, not known, or probably sterilised. At the standard price of ${euroText(t.priceEur)} a cat.`)}</p>`,
    );
  }
  if (t.noColony > 0) {
    const words =
      t.noColony === 1
        ? "Plus 1 street cat to do that isn't in a colony."
        : `Plus ${t.noColony} street cats to do that aren't in a colony.`;
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

/** The team's named areas, to correct the list (SYC-396 PR 2.4). Home is island-only, so no other check. */
export const AREAS_LINE = '<p id="areas-link"><a class="hlink" href="/api/team/areas">Areas: the place names used in labels and filters</a></p>';

/** The standard sterilisation price and its history (SYC-396 PR 3.1b). Home is island-only, so no other check. */
export const VET_SETTINGS_LINE =
  '<p id="vet-settings-link"><a class="hlink" href="/api/team/vet-settings">Vet settings: the standard sterilisation price</a></p>';

/** The Help feed a cat button and the starter facts (SYC-383). Home is island-only, so no other check. */
export const APP_SWITCHES_LINE =
  '<p id="app-switches-link"><a class="hlink" href="/api/team/app-switches">App switches: the feed button and the starter facts</a></p>';

export function renderHomePage(d: HomeData, o: { personName: string; now: Date; costs?: boolean }): string {
  const body =
    '<div class="hgrid">' +
    todaySection(d.needs, d.toCheck, o.now) +
    `<div class="hside">${trapSection(d.trapNext)}${progressSection(d.headline, d.month, o.costs === true)}</div>` +
    "</div>" +
    AREAS_LINE +
    VET_SETTINGS_LINE +
    APP_SWITCHES_LINE;
  // Wide, as the Cats grid is: two columns from 1000px need more than the 760px reading column.
  return renderPage({ title: "Home", active: "home", personName: o.personName, body, mainClass: "wide" });
}
