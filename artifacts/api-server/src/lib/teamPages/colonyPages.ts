import type { Capability } from "../capabilities";
import { myCatPath } from "./guardianPages";
import type { ColonyHistoryEntry, ColonyRow, ColonyView } from "../teamColonies";
import { COLONY_NAME_MAX, COLONY_NOTES_MAX, GUARDIAN_NAME_MAX } from "../teamColonies";
import type { CatToAdd } from "../colonyCats";
import { RECENT_GUARDIAN_CHANGES, type RecentGuardianChange } from "../recentGuardianChanges";
import { ADD_SEARCH_LIMIT } from "../colonyCats";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { position } from "./position";
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
// linked to her own cat page (roles plan PR 2.1, SYC-416), never the team's,
// which is island-only. Since PR 4.2 she creates colonies, edits her own (not
// its name), adds sites and puts cats in or takes them out; each action is
// drawn only if can() allows it for this colony.

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

/**
 * "1 cat", "3 cats" (review: the list said "1 cats"). French takes the
 * singular for 0 and 1; English and Greek only for 1.
 */
function counted(
  { t, lang }: Words,
  n: number,
  one: "count.colonySite" | "count.colonyCat",
  many: "count.colonySites" | "count.colonyCats",
): string {
  const single = n === 1 || (pageLanguage(lang) === "fr" && n === 0);
  return t(single ? one : many, { n: String(n) });
}

function colonyCard(W: Words, c: ColonyRow): string {
  const { w } = W;
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
    `<span class="status">${esc(counted(W, c.siteCount, "count.colonySite", "count.colonySites"))} · ` +
    `${esc(counted(W, c.catCount, "count.colonyCat", "count.colonyCats"))}</span>` +
    `</span></a></li>`
  );
}

/**
 * "Create a colony". A cat guardian's form has a name and notes only: she
 * becomes its guardian, under her own name (spec §2.7; SYC-209 PR 4.2).
 */
function createForm(W: Words, island: boolean): string {
  const { w } = W;
  return (
    `<div class="fixes"><details><summary>${w("create.open")}</summary>` +
    `<form method="post" action="/api/team/colonies">` +
    `<label class="label" for="new-name">${w("create.name")}</label>` +
    `<p class="hint">${w("create.nameHint")}</p>` +
    `<input class="text" id="new-name" name="name" type="text" required maxlength="${COLONY_NAME_MAX}" autocomplete="off">` +
    (island
      ? `<label class="label" for="new-guardian">${w("create.guardian")}</label>` +
        `<input class="text" id="new-guardian" name="guardianName" type="text" maxlength="${GUARDIAN_NAME_MAX}" autocomplete="off">`
      : "") +
    `<label class="label" for="new-notes">${w(island ? "create.notes" : "colony.notesOwn")}</label>` +
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
  /**
   * "Recent changes by cat guardians" (SYC-209 PR 4.3): passed only when the
   * viewer holds `view_guardian_changes` (island-only, team-only). Left out,
   * nothing is drawn.
   */
  recentChanges?: RecentGuardianChange[];
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
      (opts.recentChanges ? recentChangesSection(W, opts.recentChanges) : "") +
      `<form class="search" method="get" action="/api/team/colonies" role="search">` +
      `<label class="label" for="colony-q">${w("colonies.searchLabel")}</label>` +
      `<div class="searchrow"><input id="colony-q" name="q" type="search" value="${esc(opts.query)}" maxlength="200" autocomplete="off">` +
      `<button type="submit">${w("colonies.searchButton")}</button></div></form>` +
      (searching ? `<p><a class="tap" href="/api/team/colonies">${w("colonies.showAll")}</a></p>` : "") +
      list +
      (opts.canCreate ? createForm(W, opts.island !== false) : ""),
  });
}

// ── Recent changes by cat guardians (PR 4.3; spec §2.6) ────────────────────

/** What one change says, as trusted HTML: fixed words, every typed name escaped. */
function changeLine({ w }: Words, c: RecentGuardianChange): string {
  const who = c.guardian
    ? c.guardian.left
      ? w("changes.left", { name: c.guardian.name })
      : esc(c.guardian.name)
    : w("changes.someone");
  // Fill the escaped sentence's holes with escaped values, so a name can
  // never be read as a placeholder or as markup.
  const fill = (key: WordKey, extra: Record<string, string> = {}) =>
    w(key, { who: "\u0001who\u0001", ...Object.fromEntries(Object.keys(extra).map((k) => [k, `\u0001${k}\u0001`])) })
      .replace(/\u0001(\w+)\u0001/g, (_, k: string) => (k === "who" ? `<strong>${who}</strong>` : esc(extra[k] ?? "")));
  switch (c.kind) {
    case "colony_created":
      return fill("changes.colonyCreated");
    case "site_added":
      return fill("changes.siteAdded", { site: c.site?.name ?? "" });
    case "site_moved":
      return fill("changes.siteMoved", { site: c.site?.name ?? "" });
    case "cat_added":
      return fill("changes.catAdded", { cat: c.cat?.name ?? "" });
    case "cat_taken_out":
      return fill("changes.catTakenOut", { cat: c.cat?.name ?? "" });
  }
}

/** The team's list at the top of the Colonies page. */
export function recentChangesSection(W: Words, changes: RecentGuardianChange[]): string {
  const { w, t } = W;
  const list =
    changes.length === 0
      ? `<p class="empty">${w("changes.empty")}</p>`
      : `<ol class="history" id="recent-guardian-changes">` +
        changes
          .map((c) => {
            const colonyName = c.colony.name ?? t("changes.colonyNumber", { id: String(c.colony.id) });
            return (
              `<li class="statement"><p>${changeLine(W, c)}</p>` +
              `<p class="meta"><a href="${esc(colonyHref(c.colony.id))}">${esc(colonyName)}</a> · ` +
              `<time datetime="${esc(c.at)}">${esc(day(c.at))}</time></p></li>`
            );
          })
          .join("") +
        `</ol>`;
  return (
    `<section class="recent-changes" aria-labelledby="recent-changes-title">` +
    `<h2 id="recent-changes-title">${w("changes.title")}</h2>` +
    `<p class="hint">${w("changes.intro", { n: String(RECENT_GUARDIAN_CHANGES) })}</p>` +
    list +
    `</section>`
  );
}

// ── One colony ─────────────────────────────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

const quoted = ({ t }: Words, v: string | null) =>
  v === null || v === "" ? esc(t("history.nobody")) : `“${esc(v)}”`;

/** A centre from a history row, through position.ts (D9). Trusted HTML. */
function centreText({ t }: Words, v: unknown, link: boolean): string {
  const c = v as { lat?: unknown; lng?: unknown } | null | undefined;
  return c && typeof c.lat === "number" && typeof c.lng === "number"
    ? position(c.lat, c.lng, { link })
    : esc(t("colony.noCentre"));
}

/**
 * Only an island-wide viewer gets "Open map" (D9). Unlike `island` above,
 * which defaults to the team's view, a viewer who is not said to be
 * island-wide gets no link.
 */
const mapLinks = (v: ColonyViewer) => v.island === true;

/** What a history row says, as trusted HTML built from fixed words and esc. */
function describe(W: Words, e: ColonyHistoryEntry, island: boolean, link: boolean): string {
  const { w } = W;
  const quoted_ = (v: string | null) => quoted(W, v);
  const centre = (v: unknown) => centreText(W, v, link);
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

function historyList(W: Words, history: ColonyHistoryEntry[], island: boolean, link: boolean): string {
  const { w } = W;
  if (history.length === 0) return `<p class="empty">${w("colony.noHistory")}</p>`;
  return (
    `<ol class="history">` +
    history
      .map(
        (e) =>
          `<li class="statement"><p>${describe(W, e, island, link)}</p>` +
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
            : // A cat guardian's own cat page (SYC-53 PR 2.1; SYC-416), built by
              // guardianCatView only, never the team's (island-only) cat page.
              `<li><a class="catrow" href="${myCatPath(c.id)}">${thumb}` +
              `<span><strong>${esc(c.name)}</strong> <span class="syr">${esc(c.syr)}</span></span></a>`) +
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

function editForm(W: Words, v: ColonyView, may: (c: Capability) => boolean, island: boolean): string {
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
    // Her own colony's notes are just "Notes" to a cat guardian (PR 4.1).
    `<label class="label" for="edit-notes">${w(island ? "create.notes" : "colony.notesOwn")}</label>` +
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

/**
 * "Mimi has moved to another colony" (spec Decision 14): the cat's name and
 * the day, never the colony it went to or who looks after it.
 */
function movedAwayList(W: Words, moved: ReadonlyArray<{ catName: string; movedAt: Date }>): string {
  if (moved.length === 0) return "";
  return (
    `<h3>${W.w("moved.title")}</h3>` +
    `<ul class="refs moved">` +
    moved
      .map(
        (m) =>
          `<li>${esc(W.t("moved.line", { cat: m.catName, date: dayIn(W.lang, m.movedAt.toISOString()) }))}</li>`,
      )
      .join("") +
    `</ul>`
  );
}

export function renderColonyPage(
  v: ColonyView,
  personName: string,
  opts: ColonyViewer & {
    may: (c: Capability) => boolean;
    done?: string;
    /** Her cats that someone else moved to a colony that isn't hers (movedAwayNotices). */
    movedAway?: ReadonlyArray<{ catName: string; movedAt: Date }>;
  },
): string {
  const W = wordsIn(opts.lang);
  const { w } = W;
  const island = opts.island !== false;
  const link = mapLinks(opts);
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
    `<dt>${w("colony.centre")}</dt><dd>${v.lat !== null && v.lng !== null ? position(v.lat, v.lng, { link }) : w("colony.noCentre")}</dd>` +
    `</dl>`;
  // A cat guardian may read (and from PR 4.2 edit) her own colony's notes, so
  // to her they are just "Notes"; the team keeps "Team-only notes".
  const notes =
    `<h2>${w(island ? "colony.notes" : "colony.notesOwn")}</h2>` +
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
      (opts.may("edit_colony") ? editForm(W, v, opts.may, island) : "") +
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
      movedAwayList(W, opts.movedAway ?? []) +
      notes +
      `<h2>${w("colony.historyTitle")}</h2>` +
      historyList(W, v.history, island, link),
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
   * Draw the tick boxes and "Add the ticked cats": can() for this colony
   * (a cat guardian adds to her own since PR 4.2). Default: as `island`.
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
