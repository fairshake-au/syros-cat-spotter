import { currentAreas } from "../areas/namedAreas";
import { FIND_MAX_CATS, FIND_SHORTLIST_K, isWholeIsland, type Band, type FindFilters, type FindResult } from "../findFromPhoto";
import { filtersToQuery } from "../teamCatFilters";
import { COLOUR_FILTERS, type CatListItem } from "../teamCatList";
import { teamPhotoUrl } from "../teamCatView";
import type { TieMode } from "./catPages";
import { escapeHtml as esc } from "./escape";
import { assetUrl } from "../teamAssets";
import { backLink } from "./backLink";
import { renderPage } from "./layout";
import { lastSeenWords } from "./lastSeen";
import { markBadge } from "./marks";
import { timeAgo } from "./queuePage";
import { tr, type StringKey } from "./strings";

// Find from a photo (SYC-396 PR 2.5; spec §5.2, §13). Two plain forms, with
// no script, so the page keeps the strict security header:
//   1. "Where to look": a GET form with the area, colony and colours. It
//      only ever puts an area key, a colony NUMBER and colour codes in the
//      address, and says how many cats that leaves.
//   2. "Your photo": a POST form (multipart) carrying the same three as
//      hidden fields, shown once there are 1 to 30 cats to compare.
// The photo is never put in a GET form: a file field in a GET form would put
// the file's name in the address. The results are the POST's own answer, so
// no address ever holds a result, a photo or a position.

export const FIND_PATH = "/api/team/cats/find";

/** §5.2's plain warning, shown with every result. */
export const LESS_SURE =
  "This is less sure than the app's matching, because it compares more cats at once and has no exact position. Check the photos yourself.";
/** Decision 17: the shared limiter's day, so "overnight", not "at midnight". */
export const PERSON_CAP_WORDS = "You've used today's 20 searches. They reset overnight.";
export const TEAM_CAP_WORDS = "The team has used today's 100 searches.";
export const MATCHING_DOWN_WORDS =
  "Matching isn't working right now. Try again in a few minutes, or browse this area's cats.";
/** SYC-527 piece 1: no place chosen searches the whole island. */
export const ANYWHERE_OPTION = "Anywhere on the island";
/** The empty area option when a colony is chosen, so it doesn't contradict the colony. */
export const ANY_AREA_OPTION = "Any area";
export const WHERE_HINT =
  "Anywhere on the island compares every cat. If you know where the photo was taken, choosing the area is surer.";
/** Spec §9.1: over 30 cats the island search shortlists, so it no longer "compares every cat". */
export const WHERE_HINT_SHORT = "If you know where the photo was taken, choosing the area is surer.";
/**
 * SYC-527 piece 3, spec §9.4: the looks-like index can't run. Shown for the
 * island and for a large area alike; no search is used up.
 */
export const INDEX_DOWN_WORDS =
  "Searching the whole island isn't working right now. Choose an area or a colony to search without it.";
/**
 * Spec §9.3: shown instead of LESS_SURE when the shortlist was used. `n` is how
 * many cats were really compared: fewer than the shortlist size when only
 * that many had a fingerprint in time.
 */
export const lessSureShortlist = (n: number = FIND_SHORTLIST_K) =>
  `This is less sure than the app's matching. It first picked the ${n} cats whose photos look most like yours. A cat photographed in different light, from another angle or somewhere else can be missed. Check the photos yourself, and if you know where the photo was taken, try choosing the area.`;
export const LESS_SURE_SHORTLIST = lessSureShortlist();
/** Spec §9.2: the words before a search that will use the shortlist. */
export const SHORTLIST_EXPLAINER = `The app picks the ${FIND_SHORTLIST_K} whose photos look most like yours, then compares those closely. This can take up to a minute.`;
/** Spec §9.3: the results line when the shortlist was used. `n`: how many were really compared. */
export const shortlistResultsLine = (of: number, n: number = FIND_SHORTLIST_K) =>
  `Compared closely with the ${n} of ${of} cats whose photos look most like yours`;
/** Spec §9.3: nothing scored Possible or better. The browse link follows "or". */
export const noCloseMatchShortlist = (n: number = FIND_SHORTLIST_K) =>
  `No close match among the ${n} cats whose photos look most like yours. Try choosing an area, or`;
export const NO_CLOSE_MATCH_SHORTLIST = noCloseMatchShortlist();
/** Spec §7: cats whose photo had no fingerprint when the time ran out. */
export const leftOutWords = (n: number) =>
  `${n === 1 ? "1 newer cat wasn't" : `${n} newer cats weren't`} included this time. Choose an area to include them.`;
/** Matching down with no place: there is no area's cats to browse, so browse the cats. */
export const MATCHING_DOWN_ISLAND_WORDS = "Matching isn't working right now. Try again in a few minutes, or browse the cats.";
/** An area or colony that was given but isn't recognised: refused, never read as the island. */
export const STALE_PLACE_WORDS =
  "That area or colony isn't on the list any more. Choose another, or choose Anywhere on the island.";
export const TOO_BIG_WORDS = "That photo is too big. Choose one under 10 MB.";

const BAND_WORD: Record<Band, string> = {
  very_likely: "Very likely",
  possible: "Possible",
  unlikely: "Unlikely",
};

const COLOUR_WORD = (c: string) => (c === "not_sure" ? "Not sure" : tr(undefined, `coat.${c}` as StringKey));

const cats = (n: number) => (n === 1 ? "1 cat" : `${n} cats`);

/** The Cats grid with these filters: "browse them as a grid". */
export function gridAddress(f: FindFilters): string {
  const qs = filtersToQuery({ area: f.area, colony: f.colony, colours: f.colours });
  return qs ? `/api/team/cats?${qs}` : "/api/team/cats";
}

/** This page's address with these filters (and the report being tied). */
export function findAddress(f: FindFilters, tie?: string): string {
  const parts = [filtersToQuery({ area: f.area, colony: f.colony, colours: f.colours })];
  if (tie) parts.push(`tie=${encodeURIComponent(tie)}`);
  const qs = parts.filter(Boolean).join("&");
  return qs ? `${FIND_PATH}?${qs}` : FIND_PATH;
}

/** Where the narrowing stands, as the form's count line says it. */
export type Narrowing = { kind: "none" } | { kind: "ok"; count: number; island: boolean };

export function narrowingOf(count: number, island: boolean): Narrowing {
  if (count === 0) return { kind: "none" };
  return { kind: "ok", count, island };
}

interface Common {
  personName: string;
  filters: FindFilters;
  colonies: { id: number; name: string }[];
  tie?: TieMode;
  now: Date;
}

export interface FindFormOptions extends Common {
  narrowing: Narrowing;
  /** A cap already reached: the form says so before a photo is chosen. */
  capped?: "person" | "team";
  /** A problem with the last try, drawn next to its field. */
  problem?: { field: "place" | "photo"; words: string };
  /**
   * Load find-photo.js (it locks the button once the search starts, SYC-522).
   * Only for the form the GET route sends with the script header; the forms
   * the POST sends back after a problem carry the strict header, no script.
   */
  scripted?: boolean;
}

function placeName(f: FindFilters, colonies: Common["colonies"]): string {
  const area = f.area !== undefined ? currentAreas().find((a) => a.key === f.area)?.name : undefined;
  const colony = f.colony !== undefined ? colonies.find((c) => c.id === f.colony)?.name : undefined;
  return [area, colony].filter((x): x is string => Boolean(x)).join(", ") || (isWholeIsland(f) ? "the island" : "here");
}

/** Step 1: where to look. A GET form: an area key, a colony number and colour codes only. */
function whereForm(o: FindFormOptions): string {
  const f = o.filters;
  const sel = (on: boolean) => (on ? " selected" : "");
  const areas =
    `<option value=""${sel(isWholeIsland(f) && o.problem?.field !== "place")}>${esc(f.colony !== undefined ? ANY_AREA_OPTION : ANYWHERE_OPTION)}</option>` +
    currentAreas()
      .map((a) => `<option value="${esc(a.key)}"${sel(f.area === a.key)}>${esc(a.name)}</option>`)
      .join("");
  const colonies =
    '<option value="">Any colony</option>' +
    o.colonies.map((c) => `<option value="${c.id}"${sel(f.colony === c.id)}>${esc(c.name)}</option>`).join("");
  const colours = COLOUR_FILTERS.map(
    (c) =>
      `<label class="choicechip"><input type="checkbox" name="colours" value="${esc(c)}"${f.colours?.includes(c) ? " checked" : ""}> ${esc(COLOUR_WORD(c))}</label>`,
  ).join("");
  const placeProblem =
    o.problem?.field === "place" ? `<p class="warn" id="place-error">${esc(o.problem.words)}</p>` : "";
  const described = o.problem?.field === "place" ? ' aria-describedby="place-error" aria-invalid="true"' : "";
  return (
    `<form class="findwhere" method="get" action="${FIND_PATH}">` +
    (o.tie ? `<input type="hidden" name="tie" value="${esc(o.tie.publicId)}">` : "") +
    "<h2>1. Where to look</h2>" +
    `<p class="hint">${esc(isWholeIsland(f) && o.problem?.field !== "place" ? (o.narrowing.kind === "ok" && o.narrowing.count > FIND_MAX_CATS ? WHERE_HINT_SHORT : WHERE_HINT) : "Choose an area or a colony. Colours narrow it further.")}</p>` +
    placeProblem +
    '<fieldset><legend>Where</legend>' +
    `<label class="flabel" for="find-area">Area</label><select class="text" id="find-area" name="area"${described}>${areas}</select>` +
    `<label class="flabel" for="find-colony">Colony</label><select class="text" id="find-colony" name="colony"${described}>${colonies}</select>` +
    "</fieldset>" +
    `<fieldset><legend>Colours (if you can tell)</legend><div class="choices">${colours}</div></fieldset>` +
    '<button type="submit" class="secondary">Count the cats</button>' +
    "</form>"
  );
}

function countLine(n: Narrowing, f: FindFilters, colonies: Common["colonies"]): string {
  if (n.kind === "none") {
    return `<p class="count" role="status">No cats to compare ${isWholeIsland(f) ? "on the island" : `in ${esc(placeName(f, colonies))}`}.</p>`;
  }
  if (n.count > FIND_MAX_CATS) {
    // Spec §9.2: more than 30 uses the shortlist.
    const where = n.island ? "on the island" : `in ${esc(placeName(f, colonies))}`;
    return `<p class="count" role="status">${n.count} cats ${where}.</p><p class="hint">${esc(SHORTLIST_EXPLAINER)}</p>`;
  }
  return `<p class="count" role="status">${cats(n.count)} to compare${n.island ? " across the island" : ""}</p>`;
}

const hiddenFilters = (f: FindFilters, tie?: TieMode) =>
  (f.area !== undefined ? `<input type="hidden" name="area" value="${esc(f.area)}">` : "") +
  (f.colony !== undefined ? `<input type="hidden" name="colony" value="${f.colony}">` : "") +
  (f.colours ?? []).map((c) => `<input type="hidden" name="colours" value="${esc(c)}">`).join("") +
  (tie ? `<input type="hidden" name="tie" value="${esc(tie.publicId)}">` : "");

/** Step 2: the photo. Once there is a cat to compare and no cap is reached. */
function photoForm(o: FindFormOptions): string {
  const capWords = o.capped === "person" ? PERSON_CAP_WORDS : o.capped === "team" ? TEAM_CAP_WORDS : null;
  let inside: string;
  if (capWords) {
    inside = `<p class="notice" role="status">${esc(capWords)}</p>`;
  } else if (o.problem?.field === "place") {
    inside = '<p class="hint">Choose where to look first, then choose the photo here.</p>';
  } else if (o.narrowing.kind !== "ok") {
    inside = '<p class="hint">Once there are cats to compare, choose the photo here.</p>';
  } else {
    const photoProblem =
      o.problem?.field === "photo" ? `<p class="warn" id="photo-error">${esc(o.problem.words)}</p>` : "";
    inside =
      `<form class="findphoto" method="post" action="${FIND_PATH}" enctype="multipart/form-data">` +
      hiddenFilters(o.filters, o.tie) +
      '<label class="flabel" for="find-photo">Choose or take a photo</label>' +
      photoProblem +
      `<input class="filein" id="find-photo" name="photo" type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp"` +
      (photoProblem ? ' aria-describedby="photo-error" aria-invalid="true"' : "") +
      ">" +
      '<p class="hint">A JPEG, PNG, HEIC or WebP photo under 10 MB. Its location and other hidden details are removed before it is sent to the AI service the app already uses for matching. The photo isn\'t kept.</p>' +
      `<button type="submit" class="primary">${o.narrowing.count > FIND_MAX_CATS ? "Compare" : `Compare with ${cats(o.narrowing.count)}`}</button>` +
      // Shown by find-photo.js when the search starts; with no script it stays hidden.
      '<p class="hint" id="find-progress" role="status" hidden>Comparing your photo. This can take up to half a minute. Please keep this page open and don\'t tap again.</p>' +
      "</form>";
  }
  return `<section class="findstep"><h2>2. Your photo</h2>${inside}</section>`;
}

function tieIntro(tie: TieMode | undefined, now: Date): string {
  if (!tie?.report) return "";
  const r = tie.report;
  const sev = r.severity === "urgent" ? "Urgent" : "Needs attention";
  return (
    `<p class="hint">For the report: ${esc(sev)}${r.isLitter ? ", kittens" : ""}, sent ${esc(timeAgo(r.at, now))}. ` +
    (r.cat ? `Now tied to ${esc(r.cat.name)}. ` : "") +
    "Nothing is sent to anyone.</p>"
  );
}

/** Back to the report it was reached from, or else to the Cats grid. */
function backFrom(tie: TieMode | undefined, f: FindFilters): string {
  if (tie) return backLink(`/api/team?open=${encodeURIComponent(tie.publicId)}#r-${encodeURIComponent(tie.publicId)}`, "The report");
  return backLink(gridAddress(f), "Cats");
}

/** A report that can't be found: nothing to tie, so nothing else is offered. */
function noSuchReport(personName: string): string {
  return renderPage({
    title: "Find from a photo",
    active: "queue",
    personName,
    body:
      '<p class="notice" role="status">That report couldn\'t be found.</p>' +
      '<p><a class="tap" href="/api/team">Back to the queue</a></p>',
  });
}

export function renderFindForm(o: FindFormOptions): string {
  if (o.tie && !o.tie.report) return noSuchReport(o.personName);
  return renderPage({
    title: "Find from a photo",
    active: o.tie ? "queue" : "cats",
    personName: o.personName,
    beforeTitle: backFrom(o.tie, o.filters),
    script: o.scripted ? assetUrl("find-photo.js") : undefined,
    body:
      // On a phone the field is well below the fold: say it at the top too.
      (o.problem
        ? `<p class="notice" role="alert">${esc(o.problem.words)} <a href="${o.problem.field === "place" ? "#find-area" : "#find-photo"}">Go to it</a></p>`
        : "") +
      tieIntro(o.tie, o.now) +
      '<p class="hint">Compare a photo, for example one a resident sent, with the cats of the whole island, one area or one colony. You decide which cat it is; the page only says how close each one looks.</p>' +
      whereForm(o) +
      (o.problem?.field === "place" ? "" : countLine(o.narrowing, o.filters, o.colonies)) +
      photoForm(o),
  });
}

// ── The results ─────────────────────────────────────────────────────────────

export interface FindResultsOptions extends Common {
  count: number;
  compared: number;
  /** `{ of: N }` when the shortlist was used (spec §9.3). */
  shortlist?: { of: number } | null;
  /** Newer cats without a fingerprint when the time ran out (spec §7). */
  leftOut?: number;
  results: FindResult[];
  /** The cards' facts for each cat compared, by id. */
  cards: Map<number, CatListItem>;
  /**
   * The team's own photo (SYC-491): base64 JPEG, 640px, already stripped of
   * EXIF and GPS. Drawn as a `data:` picture in this answer only; the route
   * sends this page with the header that allows exactly that.
   */
  preview?: string | null;
}

/** The team's photo, kept in view beside the matches. Only base64 text reaches the page. */
function yourPhoto(preview: string | null | undefined): string {
  if (!preview || !/^[A-Za-z0-9+/]+={0,2}$/.test(preview)) {
    return '<p class="hint">Your photo couldn\'t be shown here. Compare these with the photo on your phone.</p>';
  }
  return (
    '<figure class="yourphoto">' +
    `<img src="data:image/jpeg;base64,${preview}" alt="Your photo" width="320" height="320">` +
    "<figcaption>Your photo. It isn't kept.</figcaption></figure>"
  );
}

function tieAction(catId: number, tie: TieMode): string {
  const report = tie.report;
  if (!report) return "";
  if (report.cat?.id === catId) return '<p class="hint">This report is already tied to this cat.</p>';
  if (!tie.canTie) return "";
  return (
    `<form method="post" action="/api/team/reports/${esc(encodeURIComponent(tie.publicId))}/cat">` +
    `<input type="hidden" name="catId" value="${catId}">` +
    `<input type="hidden" name="expectedCatId" value="${report.cat ? report.cat.id : ""}">` +
    '<button type="submit" class="tiebtn">This is the cat</button></form>'
  );
}

function resultCard(r: FindResult, o: FindResultsOptions): string {
  const c = o.cards.get(r.catId);
  const name = c?.name ?? "A cat";
  const colony =
    c?.colonyId == null ? "No colony" : (o.colonies.find((x) => x.id === c.colonyId)?.name ?? "Colony");
  const seen = c ? `${lastSeenWords(c.lastSeenAt, o.now)} · ${c.place}` : "";
  return (
    '<li class="findcard">' +
    `<img class="findimg" src="${esc(`${teamPhotoUrl(r.photoPublicId)}/medium`)}" alt="${esc(`Photo of ${name}, the one compared`)}" width="320" height="320" loading="lazy">` +
    '<div class="findfacts">' +
    `<p class="findband ${r.band}"><strong>${esc(BAND_WORD[r.band])}</strong></p>` +
    `<p class="cardname"><a href="/api/team/cats/${r.catId}"><strong>${esc(name)}</strong></a>${c ? ` <span class="syr">${esc(c.syr)}</span>` : ""}</p>` +
    (c ? `<p class="cardfact">${markBadge(c.mark)}</p>` : "") +
    `<p class="cardfact">${esc(colony)}</p>` +
    (seen ? `<p class="cardfact">${esc(seen)}</p>` : "") +
    (r.reasoning ? `<p class="cardfact why">What the matching noticed: ${esc(r.reasoning)}</p>` : "") +
    (o.tie ? tieAction(r.catId, o.tie) : "") +
    "</div></li>"
  );
}

export function renderFindResults(o: FindResultsOptions): string {
  if (o.tie && !o.tie.report) return noSuchReport(o.personName);
  const close = o.results.filter((r) => r.band !== "unlikely");
  const unlikely = o.results.filter((r) => r.band === "unlikely");
  const list = (rs: FindResult[]) => `<ul class="findlist">${rs.map((r) => resultCard(r, o)).join("")}</ul>`;
  const again = `<a class="tap" href="${esc(findAddress(o.filters, o.tie?.publicId))}">Try another photo</a>`;
  const grid = `<a class="tap" href="${esc(gridAddress(o.filters))}">Browse these cats as a grid</a>`;
  const shortlisted = o.shortlist != null;
  const noMatch = shortlisted
    ? `<p class="notice" role="status">${esc(noCloseMatchShortlist(o.compared))} <a class="tap" href="${esc(gridAddress(o.filters))}">browse the cats</a>.</p>`
    : `<p class="notice" role="status">No close match among these ${cats(o.compared)}.</p><p>${grid}</p>`;
  const matches =
    (close.length ? list(close) : noMatch) +
    (unlikely.length
      ? `<details class="unlikely"><summary>Show unlikely matches (${unlikely.length})</summary>${list(unlikely)}</details>`
      : "") +
    `<p class="findagain">${again}${close.length ? ` ${grid}` : ""}</p>`;
  const body =
    tieIntro(o.tie, o.now) +
    (o.shortlist
      ? `<p class="count" role="status">${esc(shortlistResultsLine(o.shortlist.of, o.compared))}</p>`
      : `<p class="count" role="status">Compared with ${cats(o.compared)} ${isWholeIsland(o.filters) ? "across the island" : `in ${esc(placeName(o.filters, o.colonies))}`}</p>`) +
    (o.leftOut ? `<p class="notice" role="status">${esc(leftOutWords(o.leftOut))}</p>` : "") +
    `<p class="notice">${esc(o.shortlist ? lessSureShortlist(o.compared) : LESS_SURE)}</p>` +
    `<div class="findcompare"><div class="findmine">${yourPhoto(o.preview)}</div><div class="findmatches">${matches}</div></div>`;
  return renderPage({
    title: "Find from a photo",
    active: o.tie ? "queue" : "cats",
    personName: o.personName,
    beforeTitle: backFrom(o.tie, o.filters),
    body,
    mainClass: "wide",
  });
}

/** One plain sentence and the ways on: matching down, not a cat. */
export function renderFindProblem(o: Common & { words: string; gridLink: boolean }): string {
  if (o.tie && !o.tie.report) return noSuchReport(o.personName);
  return renderPage({
    title: "Find from a photo",
    active: o.tie ? "queue" : "cats",
    personName: o.personName,
    beforeTitle: backFrom(o.tie, o.filters),
    body:
      `<p class="notice" role="status">${esc(o.words)}</p>` +
      '<p class="findagain">' +
      `<a class="tap" href="${esc(findAddress(o.filters, o.tie?.publicId))}">Try again</a>` +
      (o.gridLink
        ? ` <a class="tap" href="${esc(gridAddress(o.filters))}">${isWholeIsland(o.filters) ? "Browse the cats" : "Browse this area's cats"}</a>`
        : "") +
      "</p>",
  });
}
