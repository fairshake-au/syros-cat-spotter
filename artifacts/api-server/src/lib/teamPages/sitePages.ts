import type { SiteChange, SiteCounts, SiteHistoryEntry, SiteRow, SiteView } from "../teamSites";
import type { Position, TileSize, View } from "../mapTiles/geometry";
import { mintTileToken } from "../mapTiles/tileToken";
import { escapeHtml as esc } from "./escape";
import { dayIn } from "./colonyPages";
import { renderPage } from "./layout";
import { renderMap, type MapMarker } from "./map";
import { place, position } from "./position";
import { publicLabelOf } from "../areas/placeLabel";
import { wordsIn, type WordKey, type Words } from "./words";
import {
  SITE_DIRECTIONS_MAX,
  SITE_NAME_MAX,
  SITE_NOTES_MAX,
  SITE_REASON_MAX,
} from "../teamSiteWrites";

// The team's Feeding sites pages (SYC-209 PR 3.2; spec §2.1, §2.2, §8).
// Server-drawn, no scripts, read-only. Every value a person typed (a site's
// name, notes, directions, a colony's name, a person's name) goes through
// escapeHtml. No position in any of our own addresses: the only addresses
// here are site and colony numbers (K13). Positions print through
// position.ts, which adds D9's outbound "Open map" link only for an
// island-wide viewer (`island === true`; SYC-395).
//
// **A cat guardian (PR 4.1).** The same pages, drawn from data already
// filtered to her colonies (lib/teamSites.ts), in her language, with her own
// menu, and with no actions: adding, editing, moving and retiring are PR
// 4.2's, and changing a site's colony is the team's alone. The "Ask the team
// to make this public" button is not drawn until the roles plan's PR 3.4 and
// SYC-209 PR 6.2 are both live (plan K7).

/** Who a page is drawn for: the team (English, every action) or a cat guardian. */
export interface SiteViewer {
  personName: string;
  /** A cat guardian's own language; omitted (English) for the team. */
  lang?: string;
  /** False for a cat guardian: her menu, and none of the team's actions. Default true. */
  island?: boolean;
}

const navFor = (v: { island?: boolean }) => (v.island === false ? "guardian" : undefined);

export const SITES_PATH = "/api/team/sites";
/** Where the Feeding sites page's zoom, pan and area buttons post (K13). */
export const SITES_MOVE_PATH = "/api/team/sites/map";

const siteHref = (id: number) => `${SITES_PATH}/${id}`;
const colonyHref = (id: number) => `/api/team/colonies/${id}`;

/**
 * Only an island-wide viewer gets "Open map" (D9). Unlike `island` above,
 * which defaults to the team's view, a viewer not said to be island-wide gets
 * no link.
 */
const mapLinks = (v: { island?: boolean }) => v.island === true;

// ── The list page ──────────────────────────────────────────────────────────

/** "31 sites: 2 public, 28 private, 1 retired" (the retired part only when there are any). */
export function countLine(c: SiteCounts, lang?: string): string {
  const { t } = wordsIn(lang);
  const n = (v: number) => String(v);
  return (
    t(c.total === 1 ? "count.site" : "count.sites", {
      total: n(c.total),
      public: n(c.public),
      private: n(c.private),
    }) + (c.retired > 0 ? t("count.retired", { retired: n(c.retired) }) : "")
  );
}

/** What a recent change was, in a few fixed words. */
const KIND_WORDS: Record<string, WordKey> = {
  existing: "sitehist.existing",
  created: "sitehist.created",
  seeded: "sitehist.seeded",
  renamed: "sitehist.renamed",
  notes_edited: "sitehist.notes",
  directions_edited: "sitehist.directions",
  colony_changed: "sitehist.colony",
  moved: "sitehist.moved",
  made_public: "sitehist.madePublic",
  made_private: "sitehist.madePrivate",
  made_private_moved: "sitehist.madePrivateMoved",
  made_private_colony_changed: "sitehist.madePrivateColony",
  made_private_guardian_changed: "sitehist.madePrivateGuardian",
  label_changed: "sitehist.label",
  retired: "sitehist.retired",
  restored: "sitehist.restored",
};

const kindText = ({ w }: Words, kind: string): string =>
  Object.hasOwn(KIND_WORDS, kind) ? w(KIND_WORDS[kind]!) : esc(kind.replace(/_/g, " "));

function recentStrip(W: Words, changes: SiteChange[]): string {
  const { w } = W;
  if (changes.length === 0) return `<p class="empty">${w("sites.noRecent")}</p>`;
  return (
    `<ul class="refs">` +
    changes
      .map(
        (c) =>
          `<li>${kindText(W, c.kind)}: <a href="${esc(siteHref(c.siteId))}">${esc(c.siteName)}</a> ` +
          `<span class="meta">${w("site.by")} ${esc(c.by)} · <time datetime="${esc(c.at)}">${esc(dayIn(W.lang, c.at))}</time></span></li>`,
      )
      .join("") +
    `</ul>`
  );
}

function siteRowHtml(W: Words, s: SiteRow): string {
  const { w } = W;
  const state = s.retired ? w("sites.retired") : s.isPublic ? w("sites.public") : w("sites.private");
  const colony = s.colony
    ? `<a href="${esc(colonyHref(s.colony.id))}">${esc(s.colony.name)}</a>`
    : w("sites.noColony");
  return (
    `<li class="statement${s.retired ? " replaced" : ""}">` +
    `<p><a class="catlink" href="${esc(siteHref(s.id))}">${esc(s.name)}</a></p>` +
    `<p class="meta">${colony} · ${state} · ${w("sites.changed")} ` +
    `<time datetime="${esc(s.changedAt)}">${esc(dayIn(W.lang, s.changedAt))}</time></p></li>`
  );
}

export function markerFor(s: SiteRow, lang?: string): MapMarker {
  const { t } = wordsIn(lang);
  return {
    lat: s.lat,
    lng: s.lng,
    label: s.retired ? `${s.name} (${t("sites.retired").toLowerCase()})` : s.name,
    href: siteHref(s.id),
    look: s.retired ? "retired" : s.isPublic ? "public" : "private",
  };
}

export function renderSitesPage(opts: SiteViewer & {
  counts: SiteCounts;
  changes: SiteChange[];
  sites: SiteRow[];
  view: View;
  showRetired: boolean;
  note?: string;
  /** "Show on our map" from a sighting (PR 3.4): an outlined marker where the cat was seen. */
  sighting?: Position;
  /** Draw "Add a site": anyone who may add a site to a colony they see (PR 4.2). Default: as `island`. */
  mayAdd?: boolean;
}): string {
  const W = wordsIn(opts.lang);
  const { t, w } = W;
  const mayAdd = opts.mayAdd ?? opts.island !== false;
  const map = renderMap({
    lang: opts.lang,
    view: opts.view,
    markers: [
      ...opts.sites.map((s) => markerFor(s, opts.lang)),
      ...(opts.sighting
        ? [{ ...opts.sighting, label: t("sites.sightingMarker"), look: "sighting" as const }]
        : []),
    ],
    mode: "view",
    moveAction: SITES_MOVE_PATH,
    // The page's own setting travels with every map button, as a fixed key.
    hidden: opts.showRetired ? { retired: "1" } : undefined,
  });
  const retiredForm =
    `<form method="get" action="${SITES_PATH}" class="search">` +
    // The view travels as an opaque token, never as numbers (K13).
    `<input type="hidden" name="view" value="${esc(mintTileToken({ ...opts.view, size: 179 as TileSize }))}">` +
    `<label class="choice" for="show-retired"><input type="checkbox" id="show-retired" name="retired" value="1"${opts.showRetired ? " checked" : ""}>` +
    `${w("sites.showRetired")}</label>` +
    `<button type="submit">${w("sites.update")}</button></form>`;
  const list =
    opts.sites.length === 0
      ? `<p class="empty">${w("sites.empty")}</p>`
      : `<ul class="cats">${opts.sites.map((s) => siteRowHtml(W, s)).join("")}</ul>`;
  return renderPage({
    title: t("sites.title"),
    active: "sites",
    nav: navFor(opts),
    lang: opts.lang,
    personName: opts.personName,
    mainClass: "mappage",
    body:
      // Spec §2.1 order: the count, Recently changed, then the map and its
      // buttons, then the list. Everything above the map has fixed line
      // heights (see .mappage in layout.ts), so the map still starts on a
      // whole pixel.
      `<p><strong>${esc(countLine(opts.counts, opts.lang))}</strong></p>` +
      retiredForm +
      `<h2>${w("sites.recentTitle")}</h2>` +
      recentStrip(W, opts.changes) +
      (opts.note ? `<p class="warn">${esc(opts.note)}</p>` : "") +
      map +
      `<p class="hint">${w("sites.legend")}</p>` +
      (opts.sighting ? `<p class="hint">${w("sites.sightingLegend")}</p>` : "") +
      (mayAdd
        ? `<form method="get" action="${SITES_PATH}/new" class="addsite"><button type="submit">${w("sites.add")}</button></form>`
        : "") +
      `<h2>${w("sites.listTitle")}</h2>` +
      list +
      `<p class="hint">${w("sites.mapHint")}</p>`,
  });
}


// ── Banners, and the actions ───────────────────────────────────────────────

const SDONE: Record<string, WordKey> = {
  created: "sdone.created",
  saved: "sdone.saved",
  unchanged: "sdone.unchanged",
  moved: "sdone.moved",
  movedPrivate: "sdone.movedPrivate",
  retired: "sdone.retired",
  restored: "sdone.restored",
  colony: "sdone.colony",
  colonyPrivate: "sdone.colonyPrivate",
  stale: "sdone.stale",
  alreadyRetired: "sdone.alreadyRetired",
};

/** A fixed sentence for `?done=<key>`; any other key shows nothing. */
function banner({ w }: Words, done: string | undefined): string {
  const key = done !== undefined && Object.hasOwn(SDONE, done) ? SDONE[done] : undefined;
  return key ? `<p class="notice" role="status">${w(key)}</p>` : "";
}

/** The page's `updated_at`, which every write is conditional on (spec §11.2). */
export const stampField = (stamp: string) =>
  `<input type="hidden" name="updatedAt" value="${esc(stamp)}">`;

const textBox = ({ w }: Words, id: string, name: string, label: WordKey, value: string, max: number, hint?: WordKey) =>
  `<label class="label" for="${id}">${w(label)}</label>` +
  (hint ? `<p class="hint">${w(hint)}</p>` : "") +
  `<input class="text" id="${id}" name="${name}" type="text" maxlength="${max}" value="${esc(value)}" autocomplete="off">`;

const reasonBox = ({ w }: Words, id: string) =>
  `<label class="label" for="${id}">${w("act.reason")}</label>` +
  `<input class="text" id="${id}" name="reason" type="text" required maxlength="${SITE_REASON_MAX}" autocomplete="off">`;

/**
 * Edit details, Move on the map, Retire or Bring back, Change colony. Each is
 * a form carrying the page's `updated_at` (Move is a plain button: the move
 * pages read the stamp themselves when they open).
 */
export function renderSiteActions(
  s: SiteView,
  colonies: Array<{ id: number; name: string }>,
  lang?: string,
  /** Draw "Change colony" (`reassign_feeding_site`, island-only: never for a cat guardian). Default: yes. */
  mayReassign = true,
): string {
  const W = wordsIn(lang);
  const { w } = W;
  const base = esc(siteHref(s.id));
  const stamp = stampField(s.updatedAt);
  const retired = s.retiredAt !== null;
  const edit =
    `<div class="fixes"><details><summary>${w("act.edit")}</summary>` +
    `<form method="post" action="${base}">` +
    stamp +
    textBox(W, "edit-name", "name", "confirm.name", s.name, SITE_NAME_MAX).replace(" maxlength=", " required maxlength=") +
    textBox(W, "edit-directions", "directions", "site.directions", s.directions ?? "", SITE_DIRECTIONS_MAX, "confirm.directionsHint") +
    `<label class="label" for="edit-notes">${w("site.notes")}</label>` +
    `<textarea id="edit-notes" name="notes" maxlength="${SITE_NOTES_MAX}">${esc(s.notes ?? "")}</textarea>` +
    `<p class="hint">${w("notes.hint")}</p>` +
    `<button type="submit">${w("act.save")}</button></form></details></div>`;
  const move =
    `<form method="get" action="${base}/move" class="movesite">` +
    `<button type="submit">${w("act.move")}</button></form>`;
  const retire = retired
    ? `<div class="fixes"><details><summary>${w("act.restore")}</summary>` +
      `<form method="post" action="${base}/restore">` +
      stamp +
      `<p class="hint">${w("act.restoreHint")}</p>` +
      reasonBox(W, "restore-reason") +
      `<button type="submit">${w("act.restoreButton")}</button></form></details></div>`
    : `<div class="fixes"><details><summary>${w("act.retire")}</summary>` +
      `<form method="post" action="${base}/retire">` +
      stamp +
      `<p class="hint">${w("act.retireHint")}</p>` +
      // A public site's printed sticker would lead nowhere useful (spec §4.5).
      (s.isPublic ? `<p class="notice">${w("act.qr")}</p>` : "") +
      reasonBox(W, "retire-reason") +
      `<button type="submit" class="risky">${w("act.retireButton")}</button></form></details></div>`;
  const options =
    `<option value=""${s.colony === null ? " selected" : ""}>${w("confirm.noColony")}</option>` +
    colonies
      .map(
        (c) =>
          `<option value="${c.id}"${s.colony?.id === c.id ? " selected" : ""}>${esc(c.name)}</option>`,
      )
      .join("");
  const colony =
    `<div class="fixes"><details><summary>${w("act.colony")}</summary>` +
    `<form method="post" action="${base}/colony">` +
    stamp +
    `<label class="label" for="colony-pick">${w("confirm.colony")}</label>` +
    `<select class="text" id="colony-pick" name="colonyId">${options}</select>` +
    `<p class="hint">${w("act.colonyPublic")}</p>` +
    `<button type="submit">${w("act.colonyButton")}</button></form></details></div>`;
  return edit + move + retire + (mayReassign ? colony : "");
}

// ── One site ───────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * A position from a history row, through position.ts. Trusted HTML. An
 * island-wide viewer (link true) reads the area in words; a cat guardian's
 * own site keeps the exact position.
 */
function where(o: Record<string, unknown> | null, link: boolean): string | null {
  const p = o && typeof o["position"] === "object" && o["position"] ? (o["position"] as Record<string, unknown>) : o;
  const lat = num(p?.["lat"]);
  const lng = num(p?.["lng"]);
  if (lat === null || lng === null) return null;
  return link ? place(lat, lng, { link }) : position(lat, lng, { link });
}

const quoted = ({ w }: Words, v: string | null) => (v === null || v === "" ? w("site.none") : `“${esc(v)}”`);

function describe(W: Words, e: SiteHistoryEntry, link: boolean): string {
  const { w } = W;
  const q = (v: string | null) => quoted(W, v);
  if (e.redacted) return w("history.removed");
  const b = e.before ?? {};
  const a = e.after ?? {};
  let detail = "";
  switch (e.kind) {
    case "existing":
    case "created":
    case "seeded": {
      const name = str(a["name"]);
      const at = where(e.after, link);
      detail = [name ? q(name) : "", at ?? ""].filter(Boolean).join(" · ");
      break;
    }
    case "renamed":
      detail = `${q(str(b["name"]))} → ${q(str(a["name"]))}`;
      break;
    case "moved":
    case "made_private_moved": {
      const from = where(e.before, link);
      const to = where(e.after, link);
      detail = from || to ? `${from ?? ""} → ${to ?? ""}` : "";
      break;
    }
    case "label_changed":
      detail = `${q(str(b["publicLabel"]))} → ${q(str(a["publicLabel"]))}`;
      break;
    default:
      detail = "";
  }
  const reason = e.note ? ` <span class="meta">${w("sitehist.reason")}: ${esc(e.note)}</span>` : "";
  return kindText(W, e.kind) + (detail ? `: ${detail}` : "") + reason;
}

function historyList(W: Words, history: SiteHistoryEntry[], link: boolean): string {
  const { w } = W;
  if (history.length === 0) return `<p class="empty">${w("site.noHistory")}</p>`;
  return (
    `<ol class="history">` +
    history
      .map(
        (e) =>
          `<li class="statement"><p>${describe(W, e, link)}</p>` +
          `<p class="meta">${w("site.by")} ${esc(e.by)} · <time datetime="${esc(e.at)}">${esc(dayIn(W.lang, e.at))}</time></p></li>`,
      )
      .join("") +
    `</ol>`
  );
}

const textOrNone = ({ w }: Words, v: string | null) =>
  v && v.trim() !== "" ? `<p class="note">${esc(v)}</p>` : `<p class="empty">${w("site.none")}</p>`;

export function renderSitePage(opts: SiteViewer & {
  site: SiteView;
  view: View;
  colonies: Array<{ id: number; name: string }>;
  done?: string;
  /** Draw the actions (edit, move, retire). Default: as `island`. */
  mayAct?: boolean;
  /** Draw "Change colony" among them (island-only). Default: as `island`. */
  mayReassign?: boolean;
}): string {
  const W = wordsIn(opts.lang);
  const { w } = W;
  const mayAct = opts.mayAct ?? opts.island !== false;
  const s = opts.site;
  const map = renderMap({
    lang: opts.lang,
    view: opts.view,
    markers: [
      {
        lat: s.lat,
        lng: s.lng,
        label: s.name,
        look: s.retiredAt ? "retired" : s.isPublic ? "public" : "private",
      },
    ],
    mode: "view",
    controls: false,
  });
  const visibility = s.isPublic
    ? `<p>${w("site.publicSince")} ${s.madePublicAt ? esc(dayIn(W.lang, s.madePublicAt)) : ""}` +
      (s.madePublicBy ? `, ${w("site.by")} ${esc(s.madePublicBy)}` : "") +
      `</p>`
    : `<p>${w("site.privateSentence")}</p>`;
  const retired = s.retiredAt
    ? `<p class="notice">${w("site.retiredSince")} ${esc(dayIn(W.lang, s.retiredAt))}</p>`
    : "";
  const colony = s.colony
    ? `<p><a href="${esc(colonyHref(s.colony.id))}">${esc(s.colony.name)}</a></p>`
    : `<p class="empty">${w("site.noColony")}</p>`;
  return renderPage({
    title: s.name,
    active: "sites",
    nav: navFor(opts),
    lang: opts.lang,
    personName: opts.personName,
    mainClass: "mappage",
    beforeTitle: `<p class="back"><a href="${SITES_PATH}">${w("site.back")}</a></p>`,
    body:
      map +
      // Below the map, so nothing of variable height sits above it (see .mappage).
      banner(W, opts.done) +
      retired +
      visibility +
      `<h2>${w("site.colony")}</h2>` +
      colony +
      `<h2>${w("site.notes")}</h2>` +
      textOrNone(W, s.notes) +
      `<p class="hint">${w("notes.hint")}</p>` +
      `<h2>${w("site.directions")}</h2>` +
      textOrNone(W, s.directions) +
      `<h2>${w("site.position")}</h2>` +
      `<p class="syrline">${
        mapLinks(opts)
          ? place(s.lat, s.lng, {
              link: true,
              label: publicLabelOf({
                isPublic: s.isPublic,
                publicLabel: s.publicLabel,
                retiredAt: s.retiredAt ? new Date(s.retiredAt) : null,
              }),
            })
          : position(s.lat, s.lng, { link: false })
      }</p>` +
      `<h2>${w("site.historyTitle")}</h2>` +
      historyList(W, s.history, mapLinks(opts)) +
      (mayAct
        ? `<h2>${w("act.title")}</h2>` +
          `<div class="actions" data-actions="site">${renderSiteActions(s, opts.colonies, opts.lang, opts.mayReassign ?? opts.island !== false)}</div>`
        : ""),
  });
}

/**
 * "No such feeding site". A cat guardian gets exactly this, byte for byte,
 * for another colony's site as for a number that was never a site (spec
 * §7.3), so ids can't be counted by trying them.
 */
export function renderNoSuchSite(personName: string, viewer: Omit<SiteViewer, "personName"> = {}): string {
  const { t, w } = wordsIn(viewer.lang);
  return renderPage({
    title: t("site.noSuch"),
    active: "sites",
    nav: navFor(viewer),
    lang: viewer.lang,
    personName,
    body: `<p>${w("site.noSuchBody")}</p><p><a href="${SITES_PATH}">${w("site.backToSites")}</a></p>`,
  });
}
