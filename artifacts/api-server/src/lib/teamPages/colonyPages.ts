import type { Capability } from "../capabilities";
import { keptLine, type KeptFields } from "./signedOutPage";
import { myCatPath, lastSeenWords as guardianLastSeen } from "./guardianPages";
import { lastSeenWords } from "./lastSeen";
import type { ColonyCatRow } from "./colonyCatRows";
import type { ColonyHistoryEntry, ColonyRow, ColonyView } from "../teamColonies";
import { COLONY_NAME_MAX, COLONY_NOTES_MAX, GUARDIAN_NAME_MAX } from "../teamColonies";
import type { CatToAdd } from "../colonyCats";
import { RECENT_GUARDIAN_CHANGES, type RecentGuardianChange } from "../recentGuardianChanges";
import { ADD_SEARCH_LIMIT } from "../colonyCats";
import { escapeHtml as esc } from "./escape";
import { backLink } from "./backLink";
import { renderPage } from "./layout";
import { rowMenu } from "./rowMenu";
import { place } from "./position";
import { placeLabel } from "../areas/placeLabel";
import { formatDate, formatDateTime, pageLanguage } from "./strings";
import { markBadge, markBar } from "./marks";
import type { ColonyFigures, ColonyFlag } from "../dashboard/colonyFigures";
import type { SterilisedMark } from "../teamCatList";
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

// ── Progress and flags (SYC-396 PR 2.2; spec §9.1) ────────────────────────

/** How the list is sorted: by name, fewest confirmed sterilised first, or latest activity first. */
export const COLONY_SORTS = ["name", "fewest", "recent"] as const;
export type ColonySort = (typeof COLONY_SORTS)[number];

/** `?sort=`: one of the three, anything else (or nothing) is by name. */
export const colonySortOf = (raw: unknown): ColonySort =>
  typeof raw === "string" && (COLONY_SORTS as readonly string[]).includes(raw) ? (raw as ColonySort) : "name";

const SORT_WORD: Record<ColonySort, WordKey> = {
  name: "colonies.sort.name",
  fewest: "colonies.sort.fewest",
  recent: "colonies.sort.recent",
};

/**
 * The colonies in the chosen order. They arrive in name order, and every
 * sort is stable, so ties stay in name order. A colony with no figures (no
 * street cats, never sighted, or figures not available) goes last.
 */
export function sortColonies(
  colonies: readonly ColonyRow[],
  figures: ReadonlyMap<number, ColonyFigures> | null,
  sort: ColonySort,
): ColonyRow[] {
  const out = [...colonies];
  if (sort === "name" || figures === null) return out;
  const key = (c: ColonyRow): number | null => {
    const f = figures.get(c.id);
    if (!f) return null;
    if (sort === "fewest") return f.confirmedPct;
    return f.latestSightingAt === null ? null : -f.latestSightingAt.getTime();
  };
  return out.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null || kb === null) return (ka === null ? 1 : 0) - (kb === null ? 1 : 0);
    return ka - kb;
  });
}

const FLAG_WORD: Record<ColonyFlag, WordKey> = {
  growing: "colonies.flag.growing",
  kittens: "colonies.flag.kittens",
  no_guardian: "colonies.flag.noGuardian",
  not_visited: "colonies.flag.notVisited",
};

// 16px shapes in neutral ink, never the sterilisation colours (§12.2): an
// arrow up, a paw, a clock, and a person with a slash. Each sits beside its
// word, so a flag is never an icon alone.
const FLAG_SHAPE: Record<ColonyFlag, string> = {
  growing: '<path d="M8 13V3M4 7l4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  kittens:
    '<circle cx="4" cy="6" r="1.6" fill="currentColor"/><circle cx="8" cy="4" r="1.6" fill="currentColor"/>' +
    '<circle cx="12" cy="6" r="1.6" fill="currentColor"/><ellipse cx="8" cy="11" rx="3.4" ry="2.8" fill="currentColor"/>',
  not_visited:
    '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  no_guardian:
    '<circle cx="8" cy="5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '<path d="M3.5 14c.5-3 2.3-4.5 4.5-4.5s4 1.5 4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '<path d="M2.5 13.5l11-11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};

/** A flag as a word and its icon. Home borrows it for Kittens reported (SYC-603). */
export function flagChip({ w }: Words, f: ColonyFlag): string {
  return (
    `<span class="cflag cflag-${f}"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${FLAG_SHAPE[f]}</svg>` +
    `${w(FLAG_WORD[f])}</span>`
  );
}

const BAR_WORD: Record<SterilisedMark, WordKey> = {
  sterilised: "colonies.mark.sterilised",
  probably: "colonies.mark.probably",
  not_known: "colonies.mark.notKnown",
  not_sterilised: "colonies.mark.notSterilised",
};

/** The bar, % confirmed sterilised, the latest sighting and the flags: trusted HTML. */
function figuresBlock(W: Words, f: ColonyFigures): string {
  const { t, w } = W;
  const words = Object.fromEntries(
    (Object.keys(BAR_WORD) as SterilisedMark[]).map((m) => [m, t(BAR_WORD[m])]),
  ) as Record<SterilisedMark, string>;
  const bar = markBar(f.split, { label: t("colonies.streetCats"), words, empty: t("colonies.noStreetCats") });
  const pct =
    f.confirmedPct === null
      ? ""
      : `<span class="status cpct">${w("colonies.confirmed", { pct: String(f.confirmedPct) })}</span>`;
  const seen =
    f.latestSightingAt === null
      ? w("colonies.noSighting")
      : w("colonies.latestSighting", { date: dayIn(W.lang, f.latestSightingAt.toISOString()) });
  const flags = f.flags.length > 0 ? `<span class="cflags">${f.flags.map((x) => flagChip(W, x)).join("")}</span>` : "";
  return bar + pct + `<span class="status">${seen}</span>` + flags;
}

function colonyCard(W: Words, c: ColonyRow, f: ColonyFigures | undefined): string {
  const { w } = W;
  // The typed name, else whoever is placed on it now; with neither, the
  // "No cat guardian" flag says so (or, with no figures, the old line).
  const names = c.guardianName?.trim() ? [c.guardianName] : (f?.guardianNames ?? []);
  const guardian =
    names.length > 0
      ? `<span class="status">${w("colonies.guardian")}: ${esc(names.join(", "))}</span>`
      : f
        ? ""
        : `<span class="status">${w("colonies.noGuardian")}</span>`;
  const formerly = c.matchedOldName
    ? `<span class="status">${w("colonies.formerly")}: ${esc(c.matchedOldName)}</span>`
    : "";
  const cats = f ? f.catCount : c.catCount;
  return (
    `<li><a class="catrow colonycard" href="${esc(colonyHref(c.id))}"><span>` +
    `<strong>${esc(c.name)}</strong>` +
    guardian +
    formerly +
    (f ? figuresBlock(W, f) : "") +
    `<span class="status">${esc(counted(W, c.siteCount, "count.colonySite", "count.colonySites"))} · ` +
    `${esc(counted(W, cats, "count.colonyCat", "count.colonyCats"))}</span>` +
    `</span></a></li>`
  );
}

/** Sort links: fixed words and fixed addresses only (no search, no name, no position). */
function sortBar(W: Words, sort: ColonySort): string {
  const { w } = W;
  const links = COLONY_SORTS.map((s) => {
    const href = s === "name" ? "/api/team/colonies" : `/api/team/colonies?sort=${s}`;
    return `<a href="${href}"${s === sort ? ' aria-current="true"' : ""}>${w(SORT_WORD[s])}</a>`;
  }).join("");
  return `<nav class="sortbar" aria-label="${w("colonies.sortLabel")}"><span>${w("colonies.sortLabel")}:</span>${links}</nav>`;
}

/**
 * "Create a colony". A cat guardian's form has a name and notes only: she
 * becomes its guardian, under her own name (spec §2.7; SYC-209 PR 4.2).
 */
function createForm(W: Words, island: boolean, open = false, kept?: KeptFields): string {
  const { w } = W;
  const k = kept ?? {};
  const value = (f: string) => (k[f] !== undefined ? ` value="${esc(k[f]!)}"` : "");
  // `#create` is where "Create a colony" on My colonies lands (SYC-439); it
  // starts open for a cat guardian who has no colony to see yet.
  return (
    `<div class="fixes"><details id="create"${open || kept ? " open" : ""}><summary>${w("create.open")}</summary>` +
    `<form method="post" action="/api/team/colonies">` +
    `<label class="label" for="new-name">${w("create.name")}</label>` +
    `<p class="hint">${w("create.nameHint")}</p>` +
    `<input class="text" id="new-name" name="name" type="text" required maxlength="${COLONY_NAME_MAX}" autocomplete="off"${value("name")}>` +
    (island
      ? `<label class="label" for="new-guardian">${w("create.guardian")}</label>` +
        `<input class="text" id="new-guardian" name="guardianName" type="text" maxlength="${GUARDIAN_NAME_MAX}" autocomplete="off"${value("guardianName")}>`
      : "") +
    `<label class="label" for="new-notes">${w(island ? "create.notes" : "colony.notesOwn")}</label>` +
    `<textarea id="new-notes" name="notes" maxlength="${COLONY_NOTES_MAX}">${esc(k["notes"] ?? "")}</textarea>` +
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
  /** What was typed into "Create a colony" before the sign-in lapsed (SYC-516 C3). */
  kept?: KeptFields;
  /**
   * "Recent changes by cat guardians" (SYC-209 PR 4.3): passed only when the
   * viewer holds `view_guardian_changes` (island-only, team-only). Left out,
   * nothing is drawn.
   */
  recentChanges?: RecentGuardianChange[];
  /**
   * Each colony's progress and flags (SYC-396 PR 2.2). `null` when they
   * couldn't be worked out: the list still draws, with a line saying so.
   */
  figures: ReadonlyMap<number, ColonyFigures> | null;
  sort: ColonySort;
  /** When the figures were worked out (§9.6). */
  now: Date;
}): string {
  const W = wordsIn(opts.lang);
  const { t, w } = W;
  const searching = opts.query.trim() !== "" || opts.searched === true;
  const shown = sortColonies(opts.colonies, opts.figures, opts.sort);
  const figuresLine =
    opts.colonies.length === 0
      ? ""
      : opts.figures === null
        ? `<p class="figat" role="status">${w("colonies.figuresUnavailable")}</p>`
        : `<p class="figat">${w("colonies.figuresAt", { time: formatDateTime(opts.lang, opts.now) })}</p>`;
  // The "Growing" chip says what it means, once, above the list (SYC-522).
  const figures = opts.figures;
  const anyGrowing = figures !== null && shown.some((c) => figures.get(c.id)?.flags.includes("growing"));
  const growingKey = anyGrowing ? `<p class="hint">${w("colonies.flag.growingKey")}</p>` : "";
  const list =
    opts.colonies.length > 0
      ? `<ul class="cats colonylist">${shown.map((c) => colonyCard(W, c, opts.figures?.get(c.id))).join("")}</ul>`
      : // A cat guardian sees only her own colonies, so "there are none" would
        // be untrue from where she stands (SYC-439).
        `<p class="empty">${w(
          opts.island === false
            ? searching
              ? "colonies.noMatchOwn"
              : "colonies.emptyOwn"
            : searching
              ? "colonies.noMatch"
              : opts.canCreate
                ? "colonies.empty" // the lead above says what a colony is
                : "colonies.emptyTeam",
        )}</p>`;
  // The team's first visit with no colony yet (SYC-577): say what a colony is
  // and offer "Create a colony" first.
  const leadCreate = opts.canCreate && opts.island !== false && opts.colonies.length === 0 && !searching;
  const create = opts.canCreate
    ? createForm(W, opts.island !== false, opts.island === false && opts.colonies.length === 0 && !searching, opts.kept)
    : "";
  // SYC-619 §7.1: with no colony and no search there is nothing to search and
  // nothing has changed, so the search form and Recent changes are left out.
  const searchable = opts.colonies.length > 0 || searching;
  return renderPage({
    title: t("colonies.title"),
    active: "colonies",
    nav: navFor(opts),
    lang: opts.lang,
    personName: opts.personName,
    // Feeding sites left the team's menu with Home (PR 2.1); its way in is
    // here, for the team only (a guardian's own menu already has it).
    afterTitle:
      opts.island === false ? undefined : `<p><a class="tap" href="/api/team/sites">${w("colonies.sites")}</a></p>`,
    body:
      (opts.kept && opts.canCreate ? keptLine(opts.lang) : "") +
      banner(W, opts.done) +
      (leadCreate
        ? `<p>${w("colonies.lead")}</p>` + create
        : "") +
      (searchable
        ? `<form class="search" method="get" action="/api/team/colonies" role="search">` +
          `<label class="label" for="colony-q">${w("colonies.searchLabel")}</label>` +
          `<div class="searchrow"><input id="colony-q" name="q" type="search" value="${esc(opts.query)}" maxlength="200" autocomplete="off">` +
          // Searching keeps the chosen order.
          (opts.sort === "name" ? "" : `<input type="hidden" name="sort" value="${opts.sort}">`) +
          `<button type="submit">${w("colonies.searchButton")}</button></div></form>` +
          (searching ? `<p><a class="tap" href="/api/team/colonies">${w("colonies.showAll")}</a></p>` : "")
        : "") +
      (opts.colonies.length > 1 && opts.figures !== null ? sortBar(W, opts.sort) : "") +
      figuresLine +
      growingKey +
      list +
      (leadCreate ? "" : create) +
      (opts.recentChanges && searchable ? recentChangesSection(W, opts.recentChanges) : ""),
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
              `<time datetime="${esc(c.at)}">${esc(dayIn(W.lang, c.at))}</time></p></li>`
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

/** A centre from a history row, as the area it is in (no numbers). */
const centreArea = (v: unknown): string | null => {
  const c = v as { lat?: unknown; lng?: unknown } | null | undefined;
  return c && typeof c.lat === "number" && typeof c.lng === "number"
    ? placeLabel({ lat: c.lat, lng: c.lng })
    : null;
};

/** The "centre moved" line: words only, escaped by w(). Trusted HTML. */
function centreChange({ w }: Words, before: unknown, after: unknown): string {
  const a = centreArea(before);
  const b = centreArea(after);
  if (a === null && b === null) return w("colony.noCentre");
  if (a === null) return w("colony.centreSet", { area: b! });
  if (b === null) return w("colony.centreCleared", { area: a });
  return a === b ? w("colony.centreWithin", { area: b }) : w("colony.centreFromTo", { a, b });
}

/**
 * Only an island-wide viewer gets "Open map" (D9). Unlike `island` above,
 * which defaults to the team's view, a viewer who is not said to be
 * island-wide gets no link.
 */
const mapLinks = (v: ColonyViewer) => v.island === true;

/** What a history row says, as trusted HTML built from fixed words and esc. */
function describe(W: Words, e: ColonyHistoryEntry, island: boolean): string {
  const { w } = W;
  const quoted_ = (v: string | null) => quoted(W, v);
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
      return centreChange(W, b["centre"], a["centre"]);
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

/**
 * The colony's cats (SYC-619 spec §7.2, D3), already in the planner's order.
 * Each row is a card: the cat's link fills it and the compact "⋯" sits at its
 * right, beside the link (a fold can't go inside a link). Under the name, the
 * mark and when it was last seen, never a place: the team reads the grid's
 * words without its " · place"; a cat guardian reads the colony bar's mark
 * words and the date only, in her language (redesign §10.2). A record with no
 * mark (a merged-away half) keeps its row with neither line.
 */
function catList(
  W: Words,
  rows: readonly ColonyCatRow[],
  colonyId: number,
  mayTakeOut: boolean,
  island: boolean,
  now: Date,
): string {
  const { w, t } = W;
  if (rows.length === 0) return `<p class="empty">${w("colony.noCats")}</p>`;
  return (
    `<ul class="cats">` +
    rows
      .map((c) => {
        const thumb = c.photoUrl
          ? `<img class="thumb" src="${esc(c.photoUrl)}" alt="" loading="lazy">`
          : `<span class="thumb nothumb">${w("colony.noPhoto")}</span>`;
        // A cat guardian's own cat page (SYC-53 PR 2.1; SYC-416), built by
        // guardianCatView only, never the team's (island-only) cat page.
        const href = island ? `/api/team/cats/${c.id}` : myCatPath(c.id);
        const lines =
          c.mark === null
            ? ""
            : island
              ? `<span class="status">${markBadge(c.mark)}</span>` +
                `<span class="status">${esc(lastSeenWords(c.lastSeenAt, now))}</span>`
              : `<span class="status">${markBadge(c.mark, t(BAR_WORD[c.mark]))}</span>` +
                `<span class="status">${esc(
                  guardianLastSeen(c.lastSeenAt ? c.lastSeenAt.toISOString().slice(0, 10) : null, W.lang, t),
                )}</span>`;
        return (
          `<li class="catcard"><a class="catrow" href="${href}">${thumb}` +
          `<span class="catinfo"><span><strong>${esc(c.name)}</strong> <span class="syr">${esc(c.syr)}</span></span>` +
          lines +
          `</span></a>` +
          // In the cat's own "⋯", not a red button on every row (SYC-396 PR 1.4; SYC-619 §7.2).
          rowMenu(
            t("colony.more"),
            c.name,
            [
              mayTakeOut
                ? `<form class="takeout" method="post" action="/api/team/cats/${c.id}/colony">` +
                  `<input type="hidden" name="colonyId" value="none">` +
                  `<input type="hidden" name="from" value="${colonyId}">` +
                  `<button type="submit" class="risky">${w("colony.takeOut")}</button></form>`
                : "",
            ],
            { compact: true },
          ) +
          `</li>`
        );
      })
      .join("") +
    `</ul>`
  );
}

function editForm(W: Words, v: ColonyView, may: (c: Capability) => boolean, island: boolean, kept?: KeptFields): string {
  const { w } = W;
  const k = kept ?? {};
  const rename = may("rename_colony")
    ? `<label class="label" for="edit-name">${w("colony.rename")}</label>` +
      `<input class="text" id="edit-name" name="name" type="text" required maxlength="${COLONY_NAME_MAX}" value="${esc(k["name"] ?? v.name)}" autocomplete="off">`
    : "";
  return (
    `<div class="fixes"><details${kept ? " open" : ""}><summary>${w("colony.editTitle")}</summary>` +
    `<form method="post" action="${esc(colonyHref(v.id))}">` +
    rename +
    `<label class="label" for="edit-guardian">${w("create.guardian")}</label>` +
    `<input class="text" id="edit-guardian" name="guardianName" type="text" maxlength="${GUARDIAN_NAME_MAX}" value="${esc(k["guardianName"] ?? v.guardianName ?? "")}" autocomplete="off">` +
    // Her own colony's notes are just "Notes" to a cat guardian (PR 4.1).
    `<label class="label" for="edit-notes">${w(island ? "create.notes" : "colony.notesOwn")}</label>` +
    `<textarea id="edit-notes" name="notes" maxlength="${COLONY_NOTES_MAX}">${esc(k["notes"] ?? v.notes ?? "")}</textarea>` +
    notesHint(W) +
    `<button type="submit">${w("colony.save")}</button>` +
    `</form>` +
    // The centre is set by tapping a map (SYC-517, 517-B), not by typing numbers.
    `<p><a class="tap" href="${esc(colonyHref(v.id))}/centre">${w("centre.link")}</a></p>` +
    `</details></div>`
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
    /** What was typed into the edit form before the sign-in lapsed (SYC-516 C3). */
    kept?: KeptFields;
    /** The colony's cats with their marks, sorted for the planner (colonyCatRows; SYC-619 §7.2). */
    rows: readonly ColonyCatRow[];
    /** For "Last seen 3 days ago"; now unless a test says otherwise. */
    now?: Date;
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
    `<dt>${w("colony.centre")}</dt><dd>${v.lat !== null && v.lng !== null ? place(v.lat, v.lng, { link }) : w("colony.noCentre")}</dd>` +
    `</dl>` +
    `<p class="hint">${w("colony.centreNote")}</p>`;
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
    beforeTitle: backLink("/api/team/colonies", w("colony.back")),
    body:
      (opts.kept && opts.may("edit_colony") ? keptLine(opts.lang) : "") +
      banner(W, opts.done) +
      summary +
      (opts.may("edit_colony") ? editForm(W, v, opts.may, island, opts.kept) : "") +
      // The cats come before the feeding sites (SYC-619 spec §7.2, D3).
      `<h2>${w("colony.catsTitle")}</h2>` +
      catList(W, opts.rows, v.id, opts.may("assign_cat_to_colony"), island, opts.now ?? new Date()) +
      (opts.rows.length > 0 && opts.may("assign_cat_to_colony")
        ? `<p class="hint">${w("colony.takeOutNote")}</p>`
        : "") +
      (opts.may("assign_cat_to_colony")
        ? `<p><a class="tap cardlink" href="${esc(colonyHref(v.id))}/cats">${w("colony.addCats")}</a></p>`
        : "") +
      `<h2>${w("colony.sitesTitle")}</h2>` +
      sites +
      // Opens the add page with this colony chosen. Only the colony's number
      // is in the address, never a position (PR 3.4).
      (opts.may("add_feeding_site")
        ? `<p><a class="tap" href="/api/team/sites/new?colony=${v.id}">${w("colony.addSite")}</a></p>`
        : "") +
      movedAwayList(W, opts.movedAway ?? []) +
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
          : `<p>${w("taken.anotherHas")}</p>`) +
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
    beforeTitle: backLink(colonyHref(colony.id), colony.name),
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
