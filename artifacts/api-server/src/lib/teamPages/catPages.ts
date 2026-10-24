import type { DerivedCatStatus } from "../catHelpers";
import { keptLine, type KeptFields } from "./signedOutPage";
import type { Confidence, LifeStatusValue } from "../resolve";
import type {
  TeamCatView,
  TeamPhoto,
  TeamStatement,
} from "../teamCatView";
import {
  groupHistory,
  HISTORY_SHOWN,
  historyCounts,
  historyShown,
  isRoutine,
  renderHistory,
  runWords,
  visitDidWords,
  wrongFormNeeds,
  type HistoryShow,
} from "./catHistory";
export { groupHistory, HISTORY_SHOWN, isRoutine, runWords, visitDidWords };
import type { Capability } from "../capabilities";
import type { VisitLine } from "../vetVisits";
import type { QueueReport } from "../welfareQueue";
import type { IssueReport } from "../issues/queue";
import { reasonLabel } from "../issues/alertEmail";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { timeAgo } from "./queuePage";
import { rowMenu } from "./rowMenu";
import { renderAppearanceSection } from "./appearancePage";
import { byWhom, coatPhraseOf, renderCatFacts, statementHref, statusLine, type Shown } from "./catFacts";

export type { Shown };
import { fitView, mergeSameSpot, renderMap, type MapMarker } from "./map";
import { BANDS, pointOnView } from "../mapTiles/geometry";
import { LIFE, renderCatActions, summaryAndActions } from "./catActions";
export { LIFE };
import { placeLabel } from "../areas/placeLabel";

// The team's "Cats" screens (SYC-43 part 2 plan, PR 3): finding a cat, and
// the team's page for one cat. Read-only. Server-drawn, no scripts. Every
// value goes through escapeHtml; the data comes only from lib/teamCatView.ts.

// The app's own English words (artifacts/cat-spotter/lib/i18n.ts), so the
// team reads the public line exactly as a spotter does.
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

/**
 * The public sterilised line, word for word as the app shows it
 * (catStatusLines.ts's sterilisedLineKey): only confirmed and likely say
 * anything; everything else, "reported" included, is "Sterilised: not known yet".
 */
function publicSterilisedText(s: { value: boolean | null; confidence: Confidence }): string {
  if (s.confidence === "confirmed")
    return s.value ? "Sterilised — confirmed by Syros Cats" : "Not sterilised — Syros Cats' records";
  if (s.confidence === "likely") return "Probably sterilised — a clipped ear tip has been seen";
  return "Sterilised: not known yet";
}

function publicStatusText(s: DerivedCatStatus): string {
  const life = LIFE[s.lifeStatus];
  const seen = s.notSeenSince ? ` · Not seen since ${day(s.notSeenSince)}` : "";
  return `${life} · ${publicSterilisedText(s.sterilised)}${seen}`;
}

// ── Finding a cat ──────────────────────────────────────────────────────────

const catHref = (id: number) => `/api/team/cats/${id}`;

/**
 * The Cats page when it is choosing a cat for a welfare report (PR 5): each
 * card carries a plain "This is the cat" form posting to the tie route.
 * `report` is null when the id in the link matches no sent report.
 */
export interface TieMode {
  publicId: string;
  report: QueueReport | null;
  /** May this person tie? Without it the results are only for looking. */
  canTie: boolean;
}

// ── The team's cat page ────────────────────────────────────────────────────


/**
 * The 30-day flag (spec §2.2, §7.2): a cat a guardian marked homed or
 * deceased recently stays visible to the team, so it can't quietly leave a
 * round.
 */
function guardianMarkNotice(v: TeamCatView, byId: Map<number, TeamStatement>, shown: Shown): string {
  const m = v.recentGuardianMark;
  if (!m) return "";
  const s = byId.get(m.statementId);
  const what = m.status === "homed" ? "homed" : "as no longer with us";
  return (
    `<p class="notice" role="note">Recently marked ${what} by the cat guardian` +
    (s ? `, ${esc(s.author.label)}` : "") +
    ` (${time(m.at, day(m.at))}). <a href="${statementHref(m.statementId, shown)}">See the change</a></p>`
  );
}

/**
 * "{name} has died" (SYC-513, spec §6): at the top of the summary when the
 * cat's status is "No longer with us" and nothing disagrees. A cat guardian's
 * mark in the last 30 days has its own notice instead, so the page never says
 * the same thing twice.
 */
function deathNotice(v: TeamCatView, byId: Map<number, TeamStatement>, shown: Shown): string {
  const life = v.records.lifeStatus;
  if (life.value !== "deceased" || life.conflictingStatementIds.length > 0) return "";
  if (v.recentGuardianMark?.status === "deceased") return "";
  const id = life.supportingStatementIds[0];
  const s = id === undefined ? undefined : byId.get(id);
  if (!s) return "";
  const happened = day(s.observedAt) !== day(s.createdAt) ? `, about ${time(s.observedAt, day(s.observedAt))}` : "";
  return (
    `<p class="notice" role="note"><strong>${esc(v.cat.name)} has died</strong>${happened}. ` +
    `Recorded by ${esc(byWhom(s))} on ${time(s.createdAt, day(s.createdAt))}.` +
    (s.reason ? ` How we know: ${esc(s.reason.trim().replace(/[.!?]+$/, ""))}.` : "") +
    ` If this is a mistake, use <strong>Mark wrong</strong> on it in the history. ` +
    `<a href="${statementHref(s.id, shown)}">Go to it</a></p>`
  );
}

/** What the page says after a correction, by the `done` the form sent back. */
const DONE: Record<string, string> = {
  life: "Saved. Where the cat lives is added to the history below.",
  sterilised: "Saved. The sterilisation is added to the history below.",
  wrong: "Saved. The correction is in the history below, with the change it replaces.",
  renamed: "Saved. The new name is in the history below.",
  unchanged: "That is already the cat's name. Nothing was changed.",
  already: "Someone already corrected this. Here's what replaced it.",
  ownerRemoved: "Saved. The owner is removed and the cat's new status is in the history below. Nobody was told.",
  ownerRemovedKept: "Saved. The owner is removed. The cat is still recorded as no longer with us. Nobody was told.",
  ownerGone: "This cat has no owner now, so there was nothing to remove. Nothing was changed.",
  lifeOwnerKept: "Saved. This cat still has an owner. Ask the team if the owner should be removed.",
  colony: "Saved. The colony is added to the history below.",
  colonyOut: "Saved. The cat is out of its colony. This is added to the history below.",
  colonyAlready: "The cat was already there, so nothing was changed.",
  visit: "Saved. The vet visit is below, and what it recorded is in the history.",
  visitWrong: "Saved. The vet visit and everything it recorded are marked wrong.",
  visitAlready: "This visit was already undone. Nothing was changed.",
  visitReason: "Say why the visit is wrong, in up to 500 characters. Nothing was changed.",
  died: "Saved. The cat is recorded as no longer with us.",
  note: "Saved. The note is in the history below.",
  diedAlready: "This cat is already recorded as no longer with us. Nothing was changed.",
};

/** The messages that sit at the top of the page, not in "Update this cat". */
const TOP_DONE = new Set(["died", "diedAlready"]);

/** The messages that sit at the top of History, where the vet visits are. */
const VISIT_DONE = new Set(["visit", "visitWrong", "visitAlready", "visitReason"]);

/** What the page says beside a photo after Hide or Restore (PR 6). */
const PHOTO_DONE: Record<string, string> = {
  hidden: "Hidden. The public no longer sees this photo. Use the ⋯ menu on it to show it again.",
  restored: "Restored. The public sees this photo again.",
  already_hidden: "Someone already hid this photo a moment ago. Nothing was changed.",
  already_public: "Someone already restored this photo a moment ago. Nothing was changed.",
};

export interface CatPageOptions {
  /** May the signed-in person do this? Decides which forms are shown. */
  may?: (capability: Capability) => boolean;
  /** What was just done, from the redirect after a form (a fixed key). */
  done?: string;
  /** The history row the page lands on after a correction. */
  at?: number;
  /** The photo the page lands on after Hide or Restore (its publicId). */
  photo?: string;
  /** Every colony, for the "Colony" list. Only asked for if the person may assign. */
  colonies?: { id: number; name: string }[];
  /** ?open=coat: the Coat and markings fold opens (from "Update this cat"). */
  openCoat?: boolean;
  /** ?history=all: show every row, not just the newest HISTORY_SHOWN. */
  allHistory?: boolean;
  /** ?show=: which of History's rows to show (spec §3.5). Left out: all of them. */
  show?: HistoryShow;
  /**
   * Can the viewer see the whole island (`isIslandWide`)? Only then do
   * positions get an "Open map" link (D9). Left out means no link.
   */
  island?: boolean;
  /** "Now", for "3 days ago" and the history's dates; tests pin it. */
  now?: Date;
  /**
   * The Cats grid or Map address the person came from, filters and all
   * (SYC-522), from `cameFromCats`. Left out: "Find another cat" to the plain list.
   */
  back?: string;
  /**
   * The cat's standing vet visits, newest first (SYC-396 PR 3.1a). Without
   * `view_vet_costs` the caller leaves the cost and who paid out of each.
   */
  visits?: VisitLine[];
  /**
   * SYC-44 PR 7.1 (spec §5.3): this cat's "Report an issue" reports, from
   * issueStripFor, which answers null for anyone without `view_welfare_queue`.
   * Null or left out: no strip at all, not even its heading.
   */
  issues?: { reports: IssueReport[]; total: number } | null;
  /**
   * A form filled in again after signing in (SYC-516 C3): its key
   * (`name:<cat>`, `life:<cat>`, `sterilised:<cat>`, `wrong:<statement>`)
   * and what was typed.
   */
  kept?: { formKey: string; fields: KeptFields };
}

/** The form keys renderCatPage can fill in again for this cat (SYC-516 C3). */
export function catPageFormKeys(
  v: TeamCatView,
  may: (c: Capability) => boolean,
): (formKey: string) => boolean {
  // Only the forms this page actually draws for this viewer (the same checks
  // as correctionForms and wrongForm), so a row is never used up unseen.
  const own = new Set<string>();
  if (may("rename_cat")) own.add(`name:${v.cat.id}`);
  if (may("add_team_note")) own.add(`note:${v.cat.id}`);
  if (may("set_life_status")) own.add(`life:${v.cat.id}`);
  if (may("set_sterilisation")) own.add(`sterilised:${v.cat.id}`);
  // A statement whose "Mark wrong" is in the history list (colour and
  // markings have theirs in the Appearance section).
  for (const s of v.history) {
    const needs = wrongFormNeeds(s);
    if (needs !== null && may(needs)) own.add(`wrong:${s.id}`);
  }
  return (k) => own.has(k);
}

const ISSUE_STATE: Record<IssueReport["state"], string> = {
  new: "New",
  looking: "Looking at it",
  done: "Done",
  nothing_needed: "Nothing needed",
};

/**
 * "Reports about this cat" (spec §5.3): the cat's issue reports, newest
 * first, each linking to its row in the Queue. Team only, and drawn only when
 * there are some. The reporter is never named: there is nothing to name.
 */
type IssueStrip = { reports: IssueReport[]; total: number; open?: number };

/**
 * The amber box above the facts (spec §3.1): "1 open report: Looks injured ·
 * 2 days ago", linking to the newest open one in the Queue. Open means the
 * Queue's own open states, `new` and `looking`; `done` and `nothing_needed`
 * are closed. Nothing when none is open (the Reports section still lists the
 * closed ones). `open` counts them all; `reports` holds only the newest 50.
 */
function openReportsBox(strip: IssueStrip | null | undefined, now: Date): string {
  if (!strip) return "";
  const open = strip.reports.filter((i) => i.state === "new" || i.state === "looking");
  const newest = open[0];
  if (!newest) return "";
  const n = Math.max(strip.open ?? 0, open.length);
  const id = esc(encodeURIComponent(newest.id));
  return (
    '<aside class="openreports" aria-label="Open reports">' +
    `<a href="/api/team?open=${id}#r-${id}">${n === 1 ? "1 open report" : `${n} open reports`}: ${esc(reasonLabel(newest.reason))} · ` +
    `${esc(timeAgo(newest.at, now))}</a></aside>`
  );
}

function issueStrip(strip: IssueStrip | null | undefined): string {
  if (!strip || strip.total === 0) return "";
  const items = strip.reports
    .map(
      (i) =>
        "<li>" +
        // ?open=: the Queue opens this row even when it's a folded, closed
        // one (review of 7.1, finding 6; SYC-519), with no notice.
        `<a href="/api/team?open=${esc(encodeURIComponent(i.id))}#r-${esc(encodeURIComponent(i.id))}">${esc(reasonLabel(i.reason))}</a> ` +
        `<span class="tag state">${esc(ISSUE_STATE[i.state])}</span>` +
        (i.photo?.hidden ? ' <span class="tag hiddennow">Photo hidden</span>' : "") +
        ` <span class="meta">${time(i.at)}</span>` +
        (i.others > 0 ? ` <span class="meta">· ${esc(i.others === 1 ? "1 other open report like it" : `${i.others} other open reports like it`)}</span>` : "") +
        "</li>",
    )
    .join("");
  return (
    `<section id="issue-strip" class="issues"><h2>Reports (${strip.total})</h2>` +
    '<p class="hint">Problems the public reported with this cat\'s photos, name or page. Team only.</p>' +
    `<ul class="hplain">${items}</ul>` +
    (strip.total > strip.reports.length
      ? `<p class="empty">Showing the newest ${strip.reports.length} of ${strip.total}.</p>`
      : "") +
    "</section>"
  );
}

/** "3 Oct", or "3 Oct 2025" when it isn't this year. */
const dayMonth = (iso: string, now: Date) => {
  const opt = { timeZone: "Europe/Athens" } as const;
  const year = (d: Date) => d.toLocaleDateString("en-GB", { year: "numeric", ...opt });
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(year(new Date(iso)) === year(now) ? {} : { year: "numeric" }),
    ...opt,
  });
};

/**
 * One photo in the gallery (spec §3.6). The one whose source is "main" is "Main photo", the others
 * carry their date; each has a ⋯ menu with Open full size and Hide from the
 * public (or Show to the public again): one tap in the menu, no "are you
 * sure?". Staff see hidden photos too, dimmed and labelled with who hid them.
 * `landed`: the page came back from Hide or Restore on this photo, so its menu
 * is open and its notice sits inside the figure.
 */
function galleryItem(
  p: TeamPhoto,
  i: number,
  total: number,
  catId: number,
  may: (c: Capability) => boolean,
  notice: string,
  landed: boolean,
  now: Date,
): string {
  const action = p.hidden ? "restore" : "hide";
  const allowed = may(p.hidden ? "restore_photo" : "hide_photo");
  // SYC-415: a spot's face or body photo says so, in its caption and for a
  // screen reader. The first photo and the main photo carry no label.
  const roleWords = p.role === "face" ? "Face photo" : p.role === "body" ? "Whole body photo" : null;
  const roleSr = roleWords ? `${roleWords.toLowerCase()}, ` : "";
  const whichSr = `${roleSr}photo ${i + 1} of ${total}`;
  const form = allowed
    ? `<form method="post" action="/api/team/photos/${encodeURIComponent(p.publicId)}/${action}">` +
      `<input type="hidden" name="cat" value="${catId}">` +
      `<button type="submit" class="${p.hidden ? "restore" : "hide risky"}">${p.hidden ? "Show to the public again" : "Hide from the public"}` +
      // Which photo, for a screen reader: every button says the same words.
      `<span class="sr"> (${whichSr})</span></button></form>`
    : "";
  const full = `<a class="tap" href="${esc(p.url)}">Open full size<span class="sr"> (${whichSr})</span></a>`;
  const menu = rowMenu("⋯", whichSr, [full, form], { dots: true, open: landed });
  const caption = p.hidden
    ? `<span class="hiddenby">Hidden · ${esc(p.hidden.by)}, <time datetime="${esc(p.hidden.at)}">${esc(dayMonth(p.hidden.at, now))}</time></span>`
    : p.source === "main"
      ? "Main photo"
      : p.at
        ? `<time datetime="${esc(p.at)}">${esc(dayMonth(p.at, now))}</time>`
        : "Photo";
  const why = p.hidden?.reason ? `<p class="hiddenby"><span class="why">${esc(p.hidden.reason)}</span></p>` : "";
  return (
    `<figure id="p-${esc(p.publicId)}"${p.hidden ? ' class="ishidden"' : ""}>` +
    `<a href="${esc(p.url)}"><img src="${esc(p.url)}" alt="${esc(`Photo ${i + 1} of ${total}${p.hidden ? ", hidden from the public" : ""}`)}" loading="lazy"></a>` +
    `<figcaption><span class="capt">${caption}</span>${menu}</figcaption>` +
    (roleWords ? `<p class="role">${roleWords}</p>` : "") +
    why +
    notice +
    "</figure>"
  );
}

// ── The small map of the cat's sightings (spec §7.1) ────────────────────────

/** How many sightings the small map numbers: the newest, so it stays readable. */
export const MAP_SIGHTINGS = 30;

/**
 * The cat's sightings on the same composed map picture as the rest of the
 * dashboard, numbered in time order (1 is the oldest shown), one marker per
 * spot, linking to the newest sighting there. No script; no position in any address.
 */
function sightingsMap(v: TeamCatView, island: boolean, hrefOf: (sightingId: number) => string): string {
  if (v.sightings.length === 0) return "";
  const shown = v.sightings.slice(0, MAP_SIGHTINGS).reverse();
  const markers: MapMarker[] = mergeSameSpot(
    shown.map((s, i) => ({
      lat: s.lat,
      lng: s.lng,
      n: i + 1,
      look: "seen",
      label: `Sighting ${i + 1}, ${when(s.at)}`,
      // Its row in History, the run line holding it, or the full list (historyShown).
      href: hrefOf(s.id),
    })),
  );
  const more = v.sightings.length > shown.length;
  const view = fitView(shown);
  let map: string;
  try {
    map = renderMap({ mode: "view", view, markers, controls: false });
  } catch (e) {
    // Only a picture that can't be signed (no session key) is shown as "not
    // available", with the rest of the page (spec §13). Anything else is a bug.
    if (!(e instanceof Error && e.message.includes("TEAM_SESSION_KEYS"))) throw e;
    return '<p class="hint catmap">The map isn\'t available right now. The sightings are listed below.</p>';
  }
  // Sightings too far apart for one picture are said, never silently dropped.
  const onMap = shown.filter((s) => pointOnView(view, BANDS[0].size, s) !== null).length;
  // The caption (spec §3.3): where the cat was last seen, in the same words as
  // the Last seen fact, and how many of the sightings the map shows.
  const place = esc(placeLabel(v.sightings[0]!));
  const caption = more ? `${place} · Newest ${shown.length} of ${v.sightings.length}` : place;
  return (
    '<div class="catmap">' +
    map +
    // The island Map, opened on this cat's numbered trail (PR 1.5), only for
    // someone who may see the whole island (D9). Only the cat's number is in
    // the address: never a position or a name.
    `<p class="mapcap"><span>${caption}</span>${
      island ? `<a class="tap" href="/api/team/cats?view=map&amp;focus=${v.cat.id}">Open the map</a>` : ""
    }</p>` +
    (onMap < shown.length
      ? `<p class="hint">${shown.length - onMap} ${shown.length - onMap === 1 ? "is" : "are"} too far from the others to fit on this map; see History below.</p>`
      : "") +
    "</div>"
  );
}

/** Up to three more photos under the main one, then an "All N" tile to Photos (spec §3.1). */
function photoStrip(v: TeamCatView): string {
  const others = v.photos.filter((p) => p.url !== v.cat.mainPhotoUrl);
  if (others.length === 0) return "";
  return (
    '<ul class="photostrip" aria-label="Other photos">' +
    others
      .slice(0, 3)
      .map(
        (p, i) =>
          `<li${p.hidden ? ' class="hidden"' : ""}><a href="#p-${esc(p.publicId)}"><img src="${esc(`${p.url}/small`)}" alt="${esc(`Other photo ${i + 1}${p.hidden ? ", hidden from the public" : ""}`)}" loading="lazy" width="56" height="56"></a>${p.hidden ? '<span class="hiddentag">Hidden</span>' : ""}</li>`,
      )
      .join("") +
    `<li><a class="more" href="#photos">All ${v.photos.length}</a></li>` +
    "</ul>"
  );
}


/**
 * Where "back" goes from a cat page: the Cats grid or Map the person just
 * left, with its filters (SYC-522). Takes the Referer header (the dashboard
 * sends `Referrer-Policy: same-origin`) but keeps only its path and query,
 * and only when the path is exactly the Cats page, so no other site can
 * make the link point anywhere else. Anything else: undefined.
 */
export function cameFromCats(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  let u: URL;
  try {
    u = new URL(referer);
  } catch {
    return undefined;
  }
  if (u.pathname !== "/api/team/cats") return undefined;
  const q = new URLSearchParams(u.search);
  // A page of results or a report being tied is not a place to return to.
  q.delete("page");
  q.delete("tie");
  const qs = q.toString();
  return `/api/team/cats${qs ? `?${qs}` : ""}`;
}

function backToCats(back: string | undefined): string {
  if (!back) return '<p class="back"><a href="/api/team/cats">&larr; Find another cat</a></p>';
  const words = new URLSearchParams(back.split("?")[1] ?? "").get("view") === "map" ? "Back to the map" : "Back to the cats";
  return `<p class="back"><a href="${esc(back)}">&larr; ${words}</a></p>`;
}

/**
 * Only people who may add a team note see team notes (spec §3.2 item 3): the
 * Health note and the history rows go from a view drawn for anyone else. The
 * page is for island-wide team members today, and every one of them holds
 * add_team_note, so this is the second lock, not the first.
 */
export const withoutTeamNotes = (v: TeamCatView): TeamCatView =>
  v.history.some((h) => h.kind === "team_note") ? { ...v, history: v.history.filter((h) => h.kind !== "team_note") } : v;

export function renderCatPage(
  view: TeamCatView,
  personName: string,
  opts: CatPageOptions = {},
): string {
  const may = opts.may ?? (() => false);
  const v = may("add_team_note") ? view : withoutTeamNotes(view);
  const { cat, records } = v;
  const island = opts.island === true;
  const now = opts.now ?? new Date();
  // The message goes where the page lands: beside the statement after a
  // correction, at the top of "Update this cat" after the other forms.
  // Own keys only: ?done=constructor must not reach Object.prototype.
  const notice =
    opts.done && Object.hasOwn(DONE, opts.done)
      ? `<p class="notice" role="status">${esc(DONE[opts.done]!)}</p>`
      : "";
  const atStatement = opts.at !== undefined && v.history.some((h) => h.id === opts.at);
  const topDone = opts.done !== undefined && TOP_DONE.has(opts.done);
  const visitDone = opts.done !== undefined && VISIT_DONE.has(opts.done);
  const formsNotice = atStatement || topDone || visitDone ? "" : notice;
  const byId = new Map(v.history.map((s) => [s.id, s]));
  const visitList = opts.visits ?? [];
  // What History draws, so the links above it land on a row that is there
  // (spec §3.5): "Why we think so", the notices and the map's markers.
  const historyOpts = { show: opts.show ?? "all", all: opts.allHistory === true, at: opts.at, kept: opts.kept } as const;
  const drawn = historyShown(v, visitList, historyOpts);
  const shown = drawn.entries;
  const mainHidden = v.photos.find((p) => p.source === "main")?.hidden ?? null;
  const coat = coatPhraseOf(v);
  const main =
    (cat.mainPhotoUrl
      ? `<img class="photo catmain" src="${esc(cat.mainPhotoUrl)}" alt="${esc(`Photo of ${cat.name}${coat !== null ? `, ${coat}` : ""}`)}">`
      : '<div class="nophoto">No photo</div>') +
    photoStrip(v);
  const hiddenNote = mainHidden
    ? '<p class="hiddenby">The main photo is hidden from the public. They see the newest photo of this cat that isn\'t hidden, or no photo if every one is. See <a href="#photos">All photos</a>.</p>'
    : "";

  // The answer first (spec §7.1): photo, the facts, the small map, and what
  // the public sees in one line.
  const summaryParts = {
    photo: main,
    facts:
      openReportsBox(opts.issues, now) +
      renderCatFacts(v, now, { byId, shown, island }) +
      (cat.description ? `<p class="desc">${esc(cat.description)}</p>` : "") +
      `<p class="publicline">What the public sees: <span class="public">${esc(publicStatusText(v.publicStatus))}</span></p>`,
    map: sightingsMap(v, island, drawn.sightingHref),
  };
  const issueTotal = opts.issues?.total ?? 0;
  const jump =
    '<nav class="jump" aria-label="Sections of this page">' +
    `<a href="#history">History (${historyCounts(v, visitList).all})</a>` +
    `<a href="#photos">Photos (${v.photos.length})</a>` +
    (issueTotal > 0 ? `<a href="#issue-strip">Reports (${issueTotal})</a>` : "") +
    '<a href="#appearance">Coat and markings</a>' +
    "</nav>";

  // After Hide or Restore, the message goes beside that photo (own keys only:
  // ?done=constructor must not reach Object.prototype).
  const photoNotice =
    opts.done && Object.hasOwn(PHOTO_DONE, opts.done)
      ? `<p class="notice" role="status">${esc(PHOTO_DONE[opts.done]!)}</p>`
      : "";
  // The menu opens only when the page really came back from Hide or Restore on a photo we have.
  const landed = photoNotice !== "" && v.photos.some((p) => p.publicId === opts.photo);
  const hiddenCount = v.photos.filter((p) => p.hidden).length;
  const photos =
    `<h2 id="photos">Photos (${v.photos.length})</h2>` +
    (landed ? "" : photoNotice) +
    (hiddenCount > 0
      ? `<p class="hint">${hiddenCount} hidden from the public. The team still sees ${hiddenCount === 1 ? "it" : "them"} here.</p>`
      : "") +
    (v.photos.length === 0
      ? '<p class="empty">No photos.</p>'
      : '<div class="gallery">' +
        v.photos
          .map((p, i) =>
            {
              const here = landed && p.publicId === opts.photo;
              return galleryItem(p, i, v.photos.length, cat.id, may, here ? photoNotice : "", here, now);
            }
          )
          .join("") +
        "</div>");

  // One list instead of three (spec §3.5): sightings, vet visits and changes.
  const history = renderHistory(v, visitList, {
    ...historyOpts,
    // A correction's notice goes in its row; a vet visit's at the top of History.
    notice: atStatement || visitDone ? notice : "",
    may,
    kept: opts.kept,
    now,
    island,
  });

  return renderPage({
    title: cat.name,
    active: "cats",
    personName,
    // Notices sit above the name, never inside a fold (spec 3.1).
    beforeTitle:
      backToCats(opts.back) +
      (topDone ? notice : "") +
      deathNotice(v, byId, shown) +
      guardianMarkNotice(v, byId, shown) +
      hiddenNote,
    afterTitle:
      `<p class="syrline">${esc(cat.syr)} · on our records since ${esc(day(cat.createdAt))}</p>` + statusLine(v, now),
    mainClass: "wide",
    body:
      (opts.kept ? keptLine() : "") +
      summaryAndActions(
        summaryParts,
        renderCatActions(v, may, { notice: formsNotice, colonies: opts.colonies ?? [], kept: opts.kept, done: opts.done }),
      ) +
      jump +
      // Below the summary: History left, the rest in a narrower right column
      // on a wide screen (spec §4). On a phone it is one column, in this order.
      '<div class="catcols"><div class="catmain">' +
      history +
      '</div><div class="catside">' +
      `<section>${photos}</section>` +
      issueStrip(opts.issues) +
      renderAppearanceSection(v, may, opts.done, undefined, { fold: true, open: opts.openCoat === true }) +
      "</div></div>",
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
