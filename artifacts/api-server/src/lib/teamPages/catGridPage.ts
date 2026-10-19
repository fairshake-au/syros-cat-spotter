import { NOT_SEEN_LATELY_DAYS } from "../dashboard/countedCats";
import { currentAreas } from "../areas/namedAreas";
import { filtersToQuery } from "../teamCatFilters";
import {
  COLOUR_FILTERS,
  DEFAULT_LIVES,
  LAST_SEEN,
  LIVES,
  MARKS,
  PAGE_SIZE,
  SORTS,
  type CatListFilters,
  type CatListItem,
  type Lives,
} from "../teamCatList";
import { QUERY_MAX, teamPhotoUrl } from "../teamCatView";
import { assetUrl } from "../teamAssets";
import type { TieMode } from "./catPages";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { lastSeenWords } from "./lastSeen";
import { markBadge, MARK_WORD } from "./marks";
import { timeAgo } from "./queuePage";
import { tr, type StringKey } from "./strings";
import { coatIsUnknown, coatWordsFor } from "./teamCoatWords";

// The Cats page: every cat as a photo grid with filters (SYC-396 PR 1.3; spec
// §5.1). An ordinary GET form that works with no script. The filters live in
// the web address as short codes only (lib/teamCatFilters.ts); positions are
// never drawn here, only the named area in words.

const PATH = "/api/team/cats";

const COLOUR_WORD = (c: string) =>
  c === "not_sure" ? "Not sure" : tr(undefined, `coat.${c}` as StringKey);
// "Not sure" is a look filter only: the team never states it (see appearancePage).
const COLOURS = [...COLOUR_FILTERS];

const LIVES_WORD: Record<Lives, string> = {
  street: "On the street",
  homed: "Has a home",
  in_care: "In care",
  gone: "No longer with us",
};

/** "6 weeks or more", from the one constant Home uses, so it follows if Syros Cats change it (SYC-442). */
function quietWord(): string {
  return NOT_SEEN_LATELY_DAYS % 7 === 0 ? `${NOT_SEEN_LATELY_DAYS / 7} weeks or more` : `${NOT_SEEN_LATELY_DAYS} days or more`;
}

const LAST_SEEN_WORD: Record<(typeof LAST_SEEN)[number], string> = {
  week: "This week",
  month: "This month",
  "1to3": "1–3 months",
  over3: "Over 3 months",
  quiet: quietWord(),
  never: "Never seen since first recorded",
};

const SORT_WORD: Record<(typeof SORTS)[number], string> = {
  recent: "Most recently seen",
  newest: "Newest to the records",
  name: "Name A–Z",
};

export interface CatGridOptions {
  items: CatListItem[];
  total: number;
  /** Every cat there is, before any filter. */
  catCount: number;
  filters: CatListFilters;
  personName: string;
  tie?: TieMode;
  now: Date;
  colonies: { id: number; name: string }[];
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/** What "Lives" shows when nothing is chosen. Choosing a cat for a report includes everyone. */
const defaultLives = (tie: boolean): readonly Lives[] => (tie ? LIVES : DEFAULT_LIVES);

/** The filters with the default "Lives" choice left out. */
export function withoutDefaultLives(f: CatListFilters, tie = false): CatListFilters {
  if (f.lives && same(f.lives, defaultLives(tie))) {
    const { lives: _lives, ...rest } = f;
    return rest;
  }
  return f;
}

const monthYear = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "Europe/Athens" });

/** How many separate filters are on (a group of colours counts once). */
export function activeFilterCount(f: CatListFilters): number {
  return (
    (f.colours?.length ? 1 : 0) +
    (f.area !== undefined ? 1 : 0) +
    (f.colony !== undefined ? 1 : 0) +
    (f.sterilised?.length ? 1 : 0) +
    (f.lives?.length ? 1 : 0) +
    (f.lastSeen !== undefined ? 1 : 0)
  );
}

/**
 * The Cats page's address for these filters: the grid, or with `map` the
 * island map (`view=map`, SYC-396 PR 1.5). The map is never paged.
 */
export function catsAddress(f: CatListFilters, tie?: TieMode, map = false): string {
  const parts = [filtersToQuery(map ? { ...f, page: undefined } : f)];
  if (tie) parts.push(`tie=${encodeURIComponent(tie.publicId)}`);
  if (map) parts.push("view=map");
  const qs = parts.filter(Boolean).join("&");
  return qs ? `${PATH}?${qs}` : PATH;
}

const address = catsAddress;

/**
 * The one switch between Grid and Map (spec §6.1): the same filters either
 * way, so the Grid link's query is exactly the grid's own. Not drawn while
 * choosing a cat for a report.
 */
export function viewSwitch(f: CatListFilters, current: "grid" | "map"): string {
  const link = (which: "grid" | "map", label: string) =>
    `<a id="view-${which}" href="${esc(catsAddress({ ...f, page: undefined }, undefined, which === "map"))}"` +
    (which === current ? ' aria-current="page"' : "") +
    `>${label}</a>`;
  return `<nav class="viewswitch" aria-label="Show the cats as">${link("grid", "Grid")}${link("map", "Map")}</nav>`;
}

/** The chips under the Filters button: each one a link to the same page without that filter. */
export function activeChips(o: Pick<CatGridOptions, "filters" | "colonies" | "tie">, map = false): string {
  const f = o.filters;
  const colonyName = (id: number) => o.colonies.find((c) => c.id === id)?.name ?? "Colony";
  const chips: { label: string; without: CatListFilters }[] = [];
  for (const c of f.colours ?? []) {
    const left = f.colours!.filter((x) => x !== c);
    chips.push({ label: COLOUR_WORD(c), without: { ...f, colours: left.length ? left : undefined, page: undefined } });
  }
  if (f.area !== undefined) {
    const a = currentAreas().find((x) => x.key === f.area);
    chips.push({ label: a ? a.name : "Area", without: { ...f, area: undefined, page: undefined } });
  }
  if (f.colony !== undefined) {
    chips.push({ label: colonyName(f.colony), without: { ...f, colony: undefined, page: undefined } });
  }
  for (const s of f.sterilised ?? []) {
    const left = f.sterilised!.filter((x) => x !== s);
    chips.push({ label: MARK_WORD[s], without: { ...f, sterilised: left.length ? left : undefined, page: undefined } });
  }
  if (f.lives?.length) {
    for (const l of f.lives) {
      const left = f.lives.filter((x) => x !== l);
      chips.push({ label: LIVES_WORD[l], without: { ...f, lives: left.length ? left : undefined, page: undefined } });
    }
  }
  if (f.lastSeen !== undefined) {
    chips.push({ label: `Last seen: ${LAST_SEEN_WORD[f.lastSeen]}`, without: { ...f, lastSeen: undefined, page: undefined } });
  }
  if (f.q) {
    chips.push({ label: `“${f.q}”`, without: { ...f, q: undefined, page: undefined } });
  }
  if (chips.length === 0) return "";
  return (
    '<ul class="fchips" aria-label="Filters that are on">' +
    chips
      .map(
        (c) =>
          `<li><a class="fchip" href="${esc(address(c.without, o.tie, map))}">${esc(c.label)} ` +
          '<span aria-hidden="true">×</span><span class="sr"> Remove this filter</span></a></li>',
      )
      .join("") +
    "</ul>"
  );
}

/** The filter form. With `map`, it stays on the island map (a hidden `view=map`). */
export function filterForm(o: Pick<CatGridOptions, "filters" | "colonies" | "tie">, map = false): string {
  const f = o.filters;
  const n = activeFilterCount(f);
  const checked = (on: boolean) => (on ? " checked" : "");
  const sel = (on: boolean) => (on ? " selected" : "");
  const colours = COLOURS.map(
    (c) =>
      `<label class="choicechip"><input type="checkbox" name="colours" value="${esc(c)}"${checked(f.colours?.includes(c) ?? false)}> ${esc(COLOUR_WORD(c))}</label>`,
  ).join("");
  const areas =
    '<option value="">Anywhere</option>' +
    currentAreas().map(
      (a) => `<option value="${esc(a.key)}"${sel(f.area === a.key)}>${esc(a.name)}</option>`,
    ).join("");
  const colonies =
    '<option value="">Any colony</option>' +
    o.colonies
      .map((c) => `<option value="${c.id}"${sel(f.colony === c.id)}>${esc(c.name)}</option>`)
      .join("");
  const marks = MARKS.map(
    (m) =>
      `<label class="choicechip"><input type="checkbox" name="sterilised" value="${m}"${checked(f.sterilised?.includes(m) ?? false)}> ${esc(MARK_WORD[m])}</label>`,
  ).join("");
  const livesNow = f.lives?.length ? f.lives : defaultLives(Boolean(o.tie));
  const lives = LIVES.map(
    (l) =>
      `<label class="choicechip"><input type="checkbox" name="lives" value="${l}"${checked(livesNow.includes(l))}> ${esc(LIVES_WORD[l])}</label>`,
  ).join("");
  const lastSeen =
    '<option value="">Any time</option>' +
    LAST_SEEN.map(
      (l) => `<option value="${l}"${sel(f.lastSeen === l)}>${esc(LAST_SEEN_WORD[l])}</option>`,
    ).join("");
  const sort = SORTS.map(
    (s) => `<option value="${s}"${sel((f.sort ?? "recent") === s)}>${esc(SORT_WORD[s])}</option>`,
  ).join("");
  const tieField = o.tie ? `<input type="hidden" name="tie" value="${esc(o.tie.publicId)}">` : "";
  return (
    `<form class="catfilters" id="catfilters" method="get" action="${PATH}" role="search">` +
    tieField +
    (map ? '<input type="hidden" name="view" value="map">' : "") +
    '<label class="label" for="q">Name or SYR number</label>' +
    `<div class="searchrow"><input id="q" name="q" type="search" value="${esc(f.q ?? "")}" maxlength="${QUERY_MAX}" autocomplete="off" autocapitalize="none" spellcheck="false">` +
    '<button type="submit">Show cats</button></div>' +
    `<details class="filters"><summary>Filters (${n})</summary>` +
    '<div class="fpanel">' +
    `<fieldset><legend>Look</legend><div class="choices">${colours}</div></fieldset>` +
    `<fieldset><legend>Where</legend><label class="flabel" for="f-area">Area</label><select class="text" id="f-area" name="area">${areas}</select>` +
    // The list itself is the team's to correct (SYC-396 PR 2.4).
    '<p class="hint"><a href="/api/team/areas">Change the areas</a></p>' +
    `<label class="flabel" for="f-colony">Colony</label><select class="text" id="f-colony" name="colony">${colonies}</select></fieldset>` +
    `<fieldset><legend>Sterilised</legend><div class="choices">${marks}</div></fieldset>` +
    `<fieldset><legend>Lives</legend><div class="choices">${lives}</div></fieldset>` +
    `<fieldset><legend>Last seen</legend><select class="text" id="f-seen" name="lastSeen" aria-label="Last seen">${lastSeen}</select></fieldset>` +
    `<fieldset><legend>Sort</legend><select class="text" id="f-sort" name="sort" aria-label="Sort">${sort}</select></fieldset>` +
    "</div></details></form>"
  );
}

function tieAction(c: CatListItem, tie: TieMode & { report: NonNullable<TieMode["report"]> }): string {
  const current = tie.report.cat?.id === c.id;
  if (current) return '<p class="hint">This report is already tied to this cat.</p>';
  if (!tie.canTie) return "";
  return (
    `<form method="post" action="/api/team/reports/${esc(encodeURIComponent(tie.publicId))}/cat">` +
    `<input type="hidden" name="catId" value="${c.id}">` +
    `<input type="hidden" name="expectedCatId" value="${tie.report.cat ? tie.report.cat.id : ""}">` +
    '<button type="submit" class="tiebtn">This is the cat</button></form>'
  );
}

/** The card's coat in the team's words (SYC-443 §15.1): "Ginger tabby", or
 * null when neither part is known. */
function coatPhrase(c: CatListItem): string | null {
  const coat = { colours: c.coat, pattern: c.pattern };
  return coatIsUnknown(coat) ? null : coatWordsFor(undefined, coat);
}

function card(c: CatListItem, o: CatGridOptions): string {
  const coat = coatPhrase(c);
  const alt = `Photo of ${c.name}${coat !== null ? `, ${coat}` : ""}`;
  const photo = c.photoPublicId
    ? `<img class="cardimg" src="${esc(`${teamPhotoUrl(c.photoPublicId)}/small`)}" alt="${esc(alt)}" loading="lazy" width="180" height="180">`
    : '<span class="cardimg nothumb">No photo</span>';
  const colour = coat !== null ? esc(coat) : "Coat not known";
  const colony = c.colonyId === null ? "No colony" : (o.colonies.find((x) => x.id === c.colonyId)?.name ?? "Colony");
  const words = esc(lastSeenWords(c.lastSeenAt, o.now));
  const seen = c.lastSeenAt ? `<time datetime="${esc(c.lastSeenAt.toISOString())}">${words}</time>` : words;
  let tag = "";
  if (c.lives === "homed") tag = "Has a home";
  else if (c.lives === "in_care") tag = "In care";
  else if (c.lives === "gone") tag = c.notSeenSince ? `Not seen since ${monthYear(c.notSeenSince)}` : "No longer with us";
  const tie = o.tie && o.tie.report ? tieAction(c, { ...o.tie, report: o.tie.report }) : "";
  return (
    '<li class="catcard">' +
    `<a class="catcardlink" href="${PATH}/${c.id}">${photo}` +
    `<span class="cardname"><strong>${esc(c.name)}</strong> <span class="syr">${esc(c.syr)}</span></span>` +
    `<span class="cardfact">${colour}</span>` +
    `<span class="cardfact">${esc(colony)}</span>` +
    `<span class="cardfact">${markBadge(c.mark)}</span>` +
    `<span class="cardfact">${seen} · ${esc(c.place)}</span>` +
    (tag ? `<span class="tag">${esc(tag)}</span>` : "") +
    "</a>" +
    tie +
    "</li>"
  );
}

export function renderCatGridPage(o: CatGridOptions): string {
  const { tie } = o;
  if (tie && !tie.report) {
    return renderPage({
      title: "Which cat is this?",
      active: "queue",
      personName: o.personName,
      body:
        '<p class="notice" role="status">That report couldn\'t be found.</p>' +
        '<p><a class="tap" href="/api/team">Back to the welfare queue</a></p>',
    });
  }
  const filtered = activeFilterCount(o.filters) > 0 || Boolean(o.filters.q);
  const page = Math.max(1, o.filters.page ?? 1);
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(o.total, page * PAGE_SIZE);
  const clear = filtered ? ` <a class="tap" href="${esc(address({}, tie))}">Clear filters</a>` : "";

  let results: string;
  if (o.total === 0 && !filtered && o.catCount === 0) {
    results = '<p class="empty">No cats recorded yet. Cats appear here once spotters send sightings.</p>';
  } else if (o.total === 0 && !filtered) {
    // Cats exist, but the usual choice of "Lives" hides every one of them.
    results =
      '<p class="notice" role="status">No cats match these filters</p>' +
      `<p><a class="tap" href="${esc(address({ lives: [...LIVES] }, tie))}">Also show cats who are no longer with us</a></p>`;
  } else if (o.total === 0) {
    results =
      '<p class="notice" role="status">No cats match these filters</p>' +
      `<p><a class="tap" href="${esc(address({}, tie))}">Clear filters</a></p>`;
  } else {
    const more = (href: string, text: string) => `<a class="tap" href="${esc(href)}">${text}</a>`;
    const paging =
      (page > 1 ? `<p class="paging">${more(address({ ...o.filters, page: undefined }, tie), "Back to the first cats")}</p>` : "") +
      (last < o.total
        ? `<p class="paging">${more(address({ ...o.filters, page: page + 1 }, tie), "Show more")}</p>`
        : "");
    results =
      `<p class="count" role="status">${o.total === 1 ? "1 cat matches" : `${o.total} cats match`}${clear}` +
      (o.total > PAGE_SIZE ? ` <span class="meta">Showing ${first}–${last}</span>` : "") +
      "</p>" +
      `<ul class="catgrid">${o.items.map((c) => card(c, o)).join("")}</ul>` +
      paging;
  }
  // #catresults is what dashboard-grid.js swaps when a filter changes: the
  // Grid/Map switch (so the Map link keeps the filters), the chips, the
  // count, the grid and "Show more", and nothing else. No switch while
  // choosing a cat for a report.
  const body =
    filterForm(o) +
    `<div id="catresults">${tie ? "" : viewSwitch(o.filters, "grid")}${activeChips(o)}${results}</div>`;
  // The one page with our own script (SYC-396 PR 1.3.4). Its route sends the wider header.
  const script = assetUrl("dashboard-grid.js");

  if (!tie) {
    return renderPage({ title: "Cats", active: "cats", personName: o.personName, body, mainClass: "wide", script });
  }
  const r = tie.report!;
  const sev = r.severity === "urgent" ? "Urgent" : "Needs attention";
  const intro =
    `<p class="hint">Report: ${esc(sev)}${r.isLitter ? ", kittens" : ""}, sent ` +
    `${esc(timeAgo(r.at, o.now))}. ` +
    (r.cat
      ? `Now tied to ${esc(r.cat.name)}. Pick the right cat below.`
      : "Find the cat it is about, then tap “This is the cat”.") +
    " Nothing is sent to anyone.</p>";
  return renderPage({
    title: "Which cat is this?",
    active: "queue",
    personName: o.personName,
    beforeTitle: `<p class="back"><a class="tap" href="${esc(`/api/team#r-${encodeURIComponent(tie.publicId)}`)}">Back to the report</a></p>`,
    body: intro + body,
    mainClass: "wide",
    script,
  });
}
