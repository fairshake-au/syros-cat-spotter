import type { Capability } from "../capabilities";
import type { ColonyHistoryEntry, ColonyRow, ColonyView } from "../teamColonies";
import { COLONY_NAME_MAX, COLONY_NOTES_MAX, GUARDIAN_NAME_MAX } from "../teamColonies";
import type { CatToAdd } from "../colonyCats";
import { ADD_SEARCH_LIMIT } from "../colonyCats";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { formatDate, pageLanguage } from "./strings";
import { wordsIn, type WordKey, type Words } from "./words";

// The team's Colonies screens (SYC-209 PR 2.1; spec §2.6, §2.7, §8).
// Server-drawn, no scripts. Every value a person typed (a colony's name, a
// guardian's name, notes) goes through escapeHtml; the fixed words come from
// words.ts and go through it too.
//
// **A cat guardian (PR 4.1; spec §7.3).** The same pages, drawn from data
// already filtered to her colonies (lib/teamColonies.ts, lib/colonyCats.ts),
// in her language, with her own menu. Another colony is never named: a cat
// that moved away "moved to another colony", and an "Add cats" result in a
// colony that isn't hers is "In another colony", with no link. Her cats are
// not linked to the team's cat page (it is island-only; her own cat page is
// the roles plan's PR 2.1). The actions (create, edit, add a site, add or
// take out cats) are the team's until PR 4.2.

/** Who a page is drawn for: the team (English) or a cat guardian. */
export interface ColonyViewer {
  /** A cat guardian's own language; omitted (English) for the team. */
  lang?: string;
  /** False for a cat guardian. Default true. */
  island?: boolean;
}

const navFor = (v: ColonyViewer) => (v.island === false ? "guardian" : undefined);

const colonyHref = (id: number) => `/api/team/colonies/${id}`;

/** Dates on Syros: the team reads them in Greek time. */
export const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Athens",
  });

/** A date in the page's language: the team's short English date, or a guardian's own (once live). */
export const dayIn = (lang: string | undefined, iso: string) =>
  pageLanguage(lang) === "en" ? day(iso) : formatDate(lang, new Date(iso));

const DONE: Record<string, WordKey> = {
  created: "done.created",
  saved: "done.saved",
  unchanged: "done.unchanged",
  added: "done.added",
  nothingNew: "done.nothingNew",
  takenOut: "done.takenOut",
  notThere: "done.notThere",
};

/** A fixed sentence for `?done=<key>`; any other key shows nothing. */
function banner({ w }: Words, done: string | undefined): string {
  const key = done !== undefined && Object.hasOwn(DONE, done) ? DONE[done] : undefined;
  return key ? `<p class="notice" role="status">${w(key)}</p>` : "";
}

/** The note under every notes box (spec §7.4). */
const notesHint = ({ w }: Words) => `<p class="hint">${w("notes.hint")}</p>`;

// ── The list ───────────────────────────────────────────────────────────────

function colonyCard({ w }: Words, c: ColonyRow): string {
  const guardian = c.guardianName
    ? `${w("colonies.guardian")}: ${esc(c.guardianName)}`
    : w("colonies.noGuardian");
  const formerly = c.matchedOldName
    ? `<span class="status">${w("colonies.formerly")}: ${esc(c.matchedOldName)}</span>`
    : "";
  return (
    `<li><a class="catrow" href="${esc(colonyHref(c.id))}"><span>` +
    `<strong>${esc(c.name)}</strong>` +
    `<span class="status">${guardian}</span>` +
    formerly +
    `<span class="status">${esc(String(c.siteCount))} ${w("colonies.sites").toLowerCase()} · ` +
    `${esc(String(c.catCount))} ${w("colonies.cats").toLowerCase()}</span>` +
    `</span></a></li>`
  );
}

function createForm(W: Words): string {
  const { w } = W;
  return (
    `<div class="fixes"><details><summary>${w("create.open")}</summary>` +
    `<form method="post" action="/api/team/colonies">` +
    `<label class="label" for="new-name">${w("create.name")}</label>` +
    `<p class="hint">${w("create.nameHint")}</p>` +
    `<input class="text" id="new-name" name="name" type="text" required maxlength="${COLONY_NAME_MAX}" autocomplete="off">` +
    `<label class="label" for="new-guardian">${w("create.guardian")}</label>` +
    `<input class="text" id="new-guardian" name="guardianName" type="text" maxlength="${GUARDIAN_NAME_MAX}" autocomplete="off">` +
    `<label class="label" for="new-notes">${w("create.notes")}</label>` +
    `<textarea id="new-notes" name="notes" maxlength="${COLONY_NOTES_MAX}"></textarea>` +
    notesHint(W) +
    `<button type="submit">${w("create.button")}</button>` +
    `</form></details></div>`
  );
}

export function renderColoniesPage(opts: ColonyViewer & {
  query: string;
  /** A search that cannot match anything, shown as a search with no results. */
  searched?: boolean;
  colonies: ColonyRow[];
  personName: string;
  done?: string;
  canCreate: boolean;
}): string {
  const W = wordsIn(opts.lang);
  const { t, w } = W;
  const searching = opts.query.trim() !== "" || opts.searched === true;
  const list =
    opts.colonies.length > 0
      ? `<ul class="cats">${opts.colonies.map((c) => colonyCard(W, c)).join("")}</ul>`
      : `<p class="empty">${w(searching ? "colonies.noMatch" : "colonies.empty")}</p>`;
  return renderPage({
    title: t("colonies.title"),
    active: "colonies",
    nav: navFor(opts),
    lang: opts.lang,
    personName: opts.personName,
    body:
      banner(W, opts.done) +
      `<form class="search" method="get" action="/api/team/colonies" role="search">` +
      `<label class="label" for="colony-q">${w("colonies.searchLabel")}</label>` +
      `<div class="searchrow"><input id="colony-q" name="q" type="search" value="${esc(opts.query)}" maxlength="200" autocomplete="off">` +
      `<button type="submit">${w("colonies.searchButton")}</button></div></form>` +
      (searching ? `<p><a class="tap" href="/api/team/colonies">${w("colonies.showAll")}</a></p>` : "") +
      list +
      (opts.canCreate ? createForm(W) : ""),
  });
}

// ── One colony ─────────────────────────────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

const quoted = ({ t }: Words, v: string | null) =>
  v === null || v === "" ? esc(t("history.nobody")) : `“${esc(v)}”`;

function centreText({ t }: Words, v: unknown): string {
  const c = v as { lat?: unknown; lng?: unknown } | null | undefined;
  return c && typeof c.lat === "number" && typeof c.lng === "number"
    ? esc(`${c.lat}, ${c.lng}`)
    : esc(t("colony.noCentre"));
}

/** What a history row says, as trusted HTML built from fixed words and esc. */
function describe(W: Words, e: ColonyHistoryEntry, island: boolean): string {
  const { w } = W;
  const quoted_ = (v: string | null) => quoted(W, v);
  const centre = (v: unknown) => centreText(W, v);
  if (e.redacted) return w("history.removed");
  const b = e.before ?? {};
  const a = e.after ?? {};
  switch (e.kind) {
    case "colony_created":
      return `${w("history.created")}: ${quoted_(str(a["name"]))}`;
    case "colony_renamed":
      return `${w("history.renamed")}: ${quoted_(str(b["name"]))} → ${quoted_(str(a["name"]))}`;
    case "guardian_changed":
      return `${w("history.guardian")}: ${quoted_(str(b["guardianName"]))} → ${quoted_(str(a["guardianName"]))}`;
    case "colony_notes_changed":
      return w("history.notes");
    case "colony_centre_changed":
      return `${w("history.centre")}: ${centre(b["centre"])} → ${centre(a["centre"])}`;
    case "cat_added":
    case "cat_taken_out":
    case "cat_moved_out": {
      const word =
        e.kind === "cat_added"
          ? "history.catAdded"
          : e.kind === "cat_taken_out"
            ? "history.catTakenOut"
            : "history.catMovedOut";
      const catId = typeof a["catId"] === "number" ? a["catId"] : null;
      const name = str(a["catName"]) ?? "";
      const to = str(a["movedTo"]);
      return (
        `${w(word)}: ` +
        // The team's cat page is island-only: a guardian gets the name as text.
        (catId !== null && island ? `<a href="/api/team/cats/${catId}">${esc(name)}</a>` : esc(name)) +
        ` <span class="syr">${esc(str(a["catSyr"]) ?? "")}</span>` +
        (e.kind === "cat_moved_out" && to
          ? ` → ${quoted_(to)}`
          : e.kind === "cat_moved_out" && !island
            ? ` → ${w("colony.another")}`
            : "")
      );
    }
    default:
      return esc(e.kind.replace(/_/g, " "));
  }
}

function historyList(W: Words, history: ColonyHistoryEntry[], island: boolean): string {
  const { w } = W;
  if (history.length === 0) return `<p class="empty">${w("colony.noHistory")}</p>`;
  return (
    `<ol class="history">` +
    history
      .map(
        (e) =>
          `<li class="statement"><p>${describe(W, e, island)}</p>` +
          `<p class="meta">${w("history.by")} ${esc(e.by)} · <time datetime="${esc(e.at)}">${esc(dayIn(W.lang, e.at))}</time></p></li>`,
      )
      .join("") +
    `</ol>`
  );
}

function catList(
  { w }: Words,
  cats: ColonyView["cats"],
  colonyId: number,
  mayTakeOut: boolean,
  island: boolean,
): string {
  if (cats.length === 0) return `<p class="empty">${w("colony.noCats")}</p>`;
  return (
    `<ul class="cats">` +
    cats
      .map((c) => {
        const thumb = c.photoUrl
          ? `<img class="thumb" src="${esc(c.photoUrl)}" alt="" loading="lazy">`
          : `<span class="thumb nothumb">${w("colony.noPhoto")}</span>`;
        return (
          (island
            ? `<li><a class="catrow" href="/api/team/cats/${c.id}">${thumb}` +
              `<span><strong>${esc(c.name)}</strong> <span class="syr">${esc(c.syr)}</span></span></a>`
            : `<li><span class="catrow">${thumb}` +
              `<span><strong>${esc(c.name)}</strong> <span class="syr">${esc(c.syr)}</span></span></span>`) +
          (mayTakeOut
            ? `<form class="takeout" method="post" action="/api/team/cats/${c.id}/colony">` +
              `<input type="hidden" name="colonyId" value="none">` +
              `<input type="hidden" name="from" value="${colonyId}">` +
              `<button type="submit" class="risky">${w("colony.takeOut")}</button></form>`
            : "") +
          `</li>`
        );
      })
      .join("") +
    `</ul>`
  );
}

function editForm(W: Words, v: ColonyView, may: (c: Capability) => boolean): string {
  const { w } = W;
  const rename = may("rename_colony")
    ? `<label class="label" for="edit-name">${w("colony.rename")}</label>` +
      `<input class="text" id="edit-name" name="name" type="text" required maxlength="${COLONY_NAME_MAX}" value="${esc(v.name)}" autocomplete="off">`
    : "";
  return (
    `<div class="fixes"><details><summary>${w("colony.editTitle")}</summary>` +
    `<form method="post" action="${esc(colonyHref(v.id))}">` +
    rename +
    `<label class="label" for="edit-guardian">${w("create.guardian")}</label>` +
    `<input class="text" id="edit-guardian" name="guardianName" type="text" maxlength="${GUARDIAN_NAME_MAX}" value="${esc(v.guardianName ?? "")}" autocomplete="off">` +
    `<label class="label" for="edit-notes">${w("create.notes")}</label>` +
    `<textarea id="edit-notes" name="notes" maxlength="${COLONY_NOTES_MAX}">${esc(v.notes ?? "")}</textarea>` +
    notesHint(W) +
    `<label class="label" for="edit-lat">${w("colony.centreLat")}</label>` +
    `<input class="text" id="edit-lat" name="lat" type="text" inputmode="decimal" value="${v.lat !== null ? esc(String(v.lat)) : ""}" autocomplete="off">` +
    `<label class="label" for="edit-lng">${w("colony.centreLng")}</label>` +
    `<input class="text" id="edit-lng" name="lng" type="text" inputmode="decimal" value="${v.lng !== null ? esc(String(v.lng)) : ""}" autocomplete="off">` +
    `<p class="hint">${w("colony.centreHint")}</p>` +
    `<button type="submit">${w("colony.save")}</button>` +
    `</form></details></div>`
  );
}

export function renderColonyPage(
  v: ColonyView,
  personName: string,
  opts: ColonyViewer & { may: (c: Capability) => boolean; done?: string },
): string {
  const W = wordsIn(opts.lang);
  const { w } = W;
  const island = opts.island !== false;
  const sites =
    v.sites.length === 0
      ? `<p class="empty">${w("colony.noSites")}</p>`
      : `<ul class="refs">${v.sites
          .map((s) => `<li><a href="/api/team/sites/${s.id}">${esc(s.name)}</a></li>`)
          .join("")}</ul>`;
  const summary =
    `<dl>` +
    `<dt>${w("colonies.guardian")}</dt><dd>${v.guardianName ? esc(v.guardianName) : w("colonies.noGuardian")}</dd>` +
    `<dt>${w("colonies.sites")}</dt><dd>${esc(String(v.siteCount))}</dd>` +
    `<dt>${w("colonies.cats")}</dt><dd>${esc(String(v.catCount))}</dd>` +
    `<dt>${w("colony.centre")}</dt><dd>${v.lat !== null && v.lng !== null ? esc(`${v.lat}, ${v.lng}`) : w("colony.noCentre")}</dd>` +
    `</dl>`;
  const notes =
    `<h2>${w("colony.notes")}</h2>` +
    (v.notes ? `<p class="note">${esc(v.notes)}</p>` : `<p class="empty">${w("colony.noNotes")}</p>`);
  return renderPage({
    title: v.name,
    active: "colonies",
    nav: navFor(opts),
    lang: opts.lang,
    personName,
    beforeTitle: `<p class="back"><a href="/api/team/colonies">${w("colony.back")}</a></p>`,
    body:
      banner(W, opts.done) +
      summary +
      (opts.may("edit_colony") ? editForm(W, v, opts.may) : "") +
      `<h2>${w("colony.sitesTitle")}</h2>` +
      sites +
      // Opens the add page with this colony chosen. Only the colony's number
      // is in the address, never a position (PR 3.4).
      (opts.may("add_feeding_site")
        ? `<p><a class="tap" href="/api/team/sites/new?colony=${v.id}">${w("colony.addSite")}</a></p>`
        : "") +
      `<h2>${w("colony.catsTitle")}</h2>` +
      catList(W, v.cats, v.id, opts.may("assign_cat_to_colony"), island) +
      (v.cats.length > 0 && opts.may("assign_cat_to_colony")
        ? `<p class="hint">${w("colony.takeOutNote")}</p>`
        : "") +
      (opts.may("assign_cat_to_colony")
        ? `<p><a class="tap cardlink" href="${esc(colonyHref(v.id))}/cats">${w("colony.addCats")}</a></p>`
        : "") +
      notes +
      `<h2>${w("colony.historyTitle")}</h2>` +
      historyList(W, v.history, island),
  });
}

/**
 * "No such colony". A cat guardian gets exactly this, byte for byte, for
 * another colony as for a number that was never a colony (spec §7.3).
 */
export function renderNoSuchColony(personName: string, viewer: ColonyViewer = {}): string {
  const { t, w } = wordsIn(viewer.lang);
  return renderPage({
    title: t("none.title"),
    active: "colonies",
    nav: navFor(viewer),
    lang: viewer.lang,
    personName,
    body: `<p>${w("none.body")}</p><p><a href="/api/team/colonies">${w("problem.backToColonies")}</a></p>`,
  });
}

/**
 * "Already used by [colony]", with a link to it, for someone whose rights
 * cover that colony (the team). Anyone else (a cat guardian; spec §7.3) only
 * reads "That name can't be used.": no link, and no colony named. The route
 * passes `holder` only when the viewer sees it.
 */
export function renderNameTaken(
  personName: string,
  holder: { id: number; name: string } | null,
  back: { href: string; label: string },
  viewer: ColonyViewer = {},
): string {
  const { t, w } = wordsIn(viewer.lang);
  const island = viewer.island !== false;
  return renderPage({
    title: t("taken.title"),
    active: "colonies",
    nav: navFor(viewer),
    lang: viewer.lang,
    personName,
    body:
      (holder
        ? `<p>${w("taken.before")} <a href="${esc(colonyHref(holder.id))}"><strong>${esc(holder.name)}</strong></a>. ${w("taken.after")}</p>`
        : island
          ? `<p>${w("taken.generic")} ${w("taken.after")}</p>`
          : `<p>${w("taken.cantUse")}</p>`) +
      `<p>${w("problem.nothingChanged")}</p>` +
      `<p><a class="tap" href="${esc(back.href)}">${esc(back.label)}</a></p>`,
  });
}

/** A short page saying what was wrong, with a way back. */
export function renderColonyProblem(
  personName: string,
  message: string,
  back: { href: string; label: string },
  viewer: ColonyViewer = {},
): string {
  const { t, w } = wordsIn(viewer.lang);
  return renderPage({
    title: t("problem.title"),
    active: "colonies",
    nav: navFor(viewer),
    lang: viewer.lang,
    personName,
    body:
      `<p>${esc(message)} ${w("problem.nothingChanged")}</p>` +
      `<p><a class="tap" href="${esc(back.href)}">${esc(back.label)}</a></p>`,
  });
}

// ── Adding cats to a colony ────────────────────────────────────────────────

function addCard({ w }: Words, c: CatToAdd, colonyId: number, mayAdd: boolean): string {
  const thumb = c.thumbnailUrl
    ? `<img class="thumb" src="${esc(c.thumbnailUrl)}" alt="" loading="lazy">`
    : `<span class="thumb nothumb">${w("colony.noPhoto")}</span>`;
  const here = c.colony?.id === colonyId;
  // A colony this viewer doesn't see is "another colony": no name, no link (spec §7.3).
  const where = c.elsewhere
    ? w("add.another")
    : c.colony
      ? `${w("add.in")} ${esc(c.colony.name)}`
      : w("add.noColony");
  const text =
    thumb +
    `<span><strong>${esc(c.name)}</strong> <span class="syr">${esc(c.syr)}</span>` +
    `<span class="status">${here ? w("add.already") : where}</span></span>`;
  if (!mayAdd) return `<li><span class="catrow">${text}</span></li>`;
  return (
    `<li><label class="catrow" for="add-${c.id}">` +
    `<input type="checkbox" id="add-${c.id}" name="catIds" value="${c.id}"${here ? " disabled" : ""}>` +
    text +
    `</label></li>`
  );
}

/** "Add cats": a search, then the results as tick boxes in one form. */
export function renderAddCatsPage(opts: ColonyViewer & {
  colony: { id: number; name: string };
  query: string;
  results: CatToAdd[];
  personName: string;
  /**
   * Draw the tick boxes and "Add the ticked cats". Adding is the team's
   * until PR 4.2, so a cat guardian sees the search and its results only.
   * Default: as `island`.
   */
  mayAdd?: boolean;
}): string {
  const W = wordsIn(opts.lang);
  const { t, w } = W;
  const mayAdd = opts.mayAdd ?? opts.island !== false;
  const { colony, query, results } = opts;
  const searching = query.trim() !== "";
  const search =
    `<form class="search" method="get" action="${esc(colonyHref(colony.id))}/cats" role="search">` +
    `<label class="label" for="add-q">${w("add.searchLabel")}</label>` +
    `<div class="searchrow"><input id="add-q" name="q" type="search" value="${esc(query)}" maxlength="100" autocomplete="off" autocapitalize="none" spellcheck="false">` +
    `<button type="submit">${w("add.searchButton")}</button></div></form>`;
  let body: string;
  if (!searching) {
    body = `<p class="empty">${w("add.prompt")}</p>`;
  } else if (results.length === 0) {
    body = `<p class="empty">${w("add.noMatch")}</p>`;
  } else if (!mayAdd) {
    body =
      `<ul class="cats">${results.map((c) => addCard(W, c, colony.id, false)).join("")}</ul>` +
      (results.length >= ADD_SEARCH_LIMIT ? `<p class="empty">${w("add.more")}</p>` : "");
  } else {
    body =
      `<form method="post" action="${esc(colonyHref(colony.id))}/cats">` +
      `<p class="hint">${w("add.hint")}</p>` +
      `<ul class="cats">${results.map((c) => addCard(W, c, colony.id, true)).join("")}</ul>` +
      (results.length >= ADD_SEARCH_LIMIT ? `<p class="empty">${w("add.more")}</p>` : "") +
      `<button type="submit" class="primary">${w("add.button")}</button></form>`;
  }
  return renderPage({
    title: `${t("add.title")} ${colony.name}`,
    active: "colonies",
    nav: navFor(opts),
    lang: opts.lang,
    personName: opts.personName,
    beforeTitle: `<p class="back"><a href="${esc(colonyHref(colony.id))}">${w("add.back")}</a></p>`,
    body: search + body,
  });
}

// ── A cat's colony line, for someone who may not see every colony ──────────

/** What `colonyLineFor` (lib/colonyCats.ts) says about a cat's colony. */
export type ColonyLine =
  | { kind: "none" }
  | { kind: "another" }
  | { kind: "here"; id: number; name: string };

/**
 * A cat's colony line (spec §7.3, "Cat page colony line"): the colony's name
 * with a link if the viewer sees it, "another colony" (no name, no number, no
 * link) if it is one she doesn't, or "Not in a colony". Trusted HTML.
 *
 * Built and tested in SYC-209 PR 4.1. The team's cat page is island-only and
 * is not changed here; the roles plan's PR 2.1 (a guardian's own cat page)
 * draws this line.
 */
export function renderColonyLine(line: ColonyLine, lang?: string): string {
  const { w } = wordsIn(lang);
  switch (line.kind) {
    case "here":
      return `<a href="${esc(colonyHref(line.id))}">${esc(line.name)}</a>`;
    case "another":
      return w("colony.another");
    case "none":
      return w("colony.none");
  }
}
