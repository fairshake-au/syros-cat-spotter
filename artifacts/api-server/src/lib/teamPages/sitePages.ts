import type { SiteChange, SiteCounts, SiteHistoryEntry, SiteRow, SiteView } from "../teamSites";
import type { Position, TileSize, View } from "../mapTiles/geometry";
import { mintTileToken } from "../mapTiles/tileToken";
import { escapeHtml as esc } from "./escape";
import { day } from "./colonyPages";
import { renderPage } from "./layout";
import { renderMap, type MapMarker } from "./map";
import { t, type WordKey } from "./words";
import {
  SITE_DIRECTIONS_MAX,
  SITE_NAME_MAX,
  SITE_NOTES_MAX,
  SITE_REASON_MAX,
} from "../teamSiteWrites";

// The team's Feeding sites pages (SYC-209 PR 3.2; spec §2.1, §2.2, §8).
// Server-drawn, no scripts, read-only. Every value a person typed (a site's
// name, notes, directions, a colony's name, a person's name) goes through
// escapeHtml. No link to any map company, and no position in any address:
// the only addresses here are site and colony numbers (K13).

const w = (key: WordKey) => esc(t(key));

export const SITES_PATH = "/api/team/sites";
/** Where the Feeding sites page's zoom, pan and area buttons post (K13). */
export const SITES_MOVE_PATH = "/api/team/sites/map";

const siteHref = (id: number) => `${SITES_PATH}/${id}`;
const colonyHref = (id: number) => `/api/team/colonies/${id}`;

/** A position as the cat page prints it: five decimal places. */
export const fmtPos = (lat: number, lng: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

// ── The list page ──────────────────────────────────────────────────────────

/** "31 sites: 2 public, 28 private, 1 retired" (the retired part only when there are any). */
export function countLine(c: SiteCounts): string {
  const parts = [`${c.public} public`, `${c.private} private`];
  if (c.retired > 0) parts.push(`${c.retired} retired`);
  return `${c.total} ${c.total === 1 ? "site" : "sites"}: ${parts.join(", ")}`;
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

const kindText = (kind: string): string =>
  Object.hasOwn(KIND_WORDS, kind) ? w(KIND_WORDS[kind]!) : esc(kind.replace(/_/g, " "));

function recentStrip(changes: SiteChange[]): string {
  if (changes.length === 0) return `<p class="empty">${w("sites.noRecent")}</p>`;
  return (
    `<ul class="refs">` +
    changes
      .map(
        (c) =>
          `<li>${kindText(c.kind)}: <a href="${esc(siteHref(c.siteId))}">${esc(c.siteName)}</a> ` +
          `<span class="meta">${w("site.by")} ${esc(c.by)} · <time datetime="${esc(c.at)}">${esc(day(c.at))}</time></span></li>`,
      )
      .join("") +
    `</ul>`
  );
}

function siteRowHtml(s: SiteRow): string {
  const state = s.retired ? w("sites.retired") : s.isPublic ? w("sites.public") : w("sites.private");
  const colony = s.colony
    ? `<a href="${esc(colonyHref(s.colony.id))}">${esc(s.colony.name)}</a>`
    : w("sites.noColony");
  return (
    `<li class="statement${s.retired ? " replaced" : ""}">` +
    `<p><a class="catlink" href="${esc(siteHref(s.id))}">${esc(s.name)}</a></p>` +
    `<p class="meta">${colony} · ${state} · ${w("sites.changed")} ` +
    `<time datetime="${esc(s.changedAt)}">${esc(day(s.changedAt))}</time></p></li>`
  );
}

export function markerFor(s: SiteRow): MapMarker {
  return {
    lat: s.lat,
    lng: s.lng,
    label: s.retired ? `${s.name} (${t("sites.retired").toLowerCase()})` : s.name,
    href: siteHref(s.id),
    look: s.retired ? "retired" : s.isPublic ? "public" : "private",
  };
}

export function renderSitesPage(opts: {
  personName: string;
  counts: SiteCounts;
  changes: SiteChange[];
  sites: SiteRow[];
  view: View;
  showRetired: boolean;
  note?: string;
  /** "Show on our map" from a sighting (PR 3.4): an outlined marker where the cat was seen. */
  sighting?: Position;
}): string {
  const map = renderMap({
    view: opts.view,
    markers: [
      ...opts.sites.map(markerFor),
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
      : `<ul class="cats">${opts.sites.map(siteRowHtml).join("")}</ul>`;
  return renderPage({
    title: t("sites.title"),
    active: "sites",
    personName: opts.personName,
    mainClass: "mappage",
    body:
      // Spec §2.1 order: the count, Recently changed, then the map and its
      // buttons, then the list. Everything above the map has fixed line
      // heights (see .mappage in layout.ts), so the map still starts on a
      // whole pixel.
      `<p><strong>${esc(countLine(opts.counts))}</strong></p>` +
      retiredForm +
      `<h2>${w("sites.recentTitle")}</h2>` +
      recentStrip(opts.changes) +
      (opts.note ? `<p class="warn">${esc(opts.note)}</p>` : "") +
      map +
      `<p class="hint">${w("sites.legend")}</p>` +
      (opts.sighting ? `<p class="hint">${w("sites.sightingLegend")}</p>` : "") +
      `<form method="get" action="${SITES_PATH}/new" class="addsite"><button type="submit">${w("sites.add")}</button></form>` +
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
};

/** A fixed sentence for `?done=<key>`; any other key shows nothing. */
function banner(done: string | undefined): string {
  const key = done !== undefined && Object.hasOwn(SDONE, done) ? SDONE[done] : undefined;
  return key ? `<p class="notice" role="status">${w(key)}</p>` : "";
}

/** The page's `updated_at`, which every write is conditional on (spec §11.2). */
export const stampField = (stamp: string) =>
  `<input type="hidden" name="updatedAt" value="${esc(stamp)}">`;

const textBox = (id: string, name: string, label: WordKey, value: string, max: number, hint?: WordKey) =>
  `<label class="label" for="${id}">${w(label)}</label>` +
  (hint ? `<p class="hint">${w(hint)}</p>` : "") +
  `<input class="text" id="${id}" name="${name}" type="text" maxlength="${max}" value="${esc(value)}" autocomplete="off">`;

const reasonBox = (id: string) =>
  `<label class="label" for="${id}">${w("act.reason")}</label>` +
  `<input class="text" id="${id}" name="reason" type="text" required maxlength="${SITE_REASON_MAX}" autocomplete="off">`;

/**
 * Edit details, Move on the map, Retire or Bring back, Change colony. Each is
 * a form carrying the page's `updated_at` (Move is a plain button: the move
 * pages read the stamp themselves when they open).
 */
export function renderSiteActions(s: SiteView, colonies: Array<{ id: number; name: string }>): string {
  const base = esc(siteHref(s.id));
  const stamp = stampField(s.updatedAt);
  const retired = s.retiredAt !== null;
  const edit =
    `<div class="fixes"><details><summary>${w("act.edit")}</summary>` +
    `<form method="post" action="${base}">` +
    stamp +
    textBox("edit-name", "name", "confirm.name", s.name, SITE_NAME_MAX).replace(" maxlength=", " required maxlength=") +
    textBox("edit-directions", "directions", "site.directions", s.directions ?? "", SITE_DIRECTIONS_MAX, "confirm.directionsHint") +
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
      reasonBox("restore-reason") +
      `<button type="submit">${w("act.restoreButton")}</button></form></details></div>`
    : `<div class="fixes"><details><summary>${w("act.retire")}</summary>` +
      `<form method="post" action="${base}/retire">` +
      stamp +
      `<p class="hint">${w("act.retireHint")}</p>` +
      // A public site's printed sticker would lead nowhere useful (spec §4.5).
      (s.isPublic ? `<p class="notice">${w("act.qr")}</p>` : "") +
      reasonBox("retire-reason") +
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
  return edit + move + retire + colony;
}

// ── One site ───────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** A position as plain text, team-only. */
function where(o: Record<string, unknown> | null): string | null {
  const p = o && typeof o["position"] === "object" && o["position"] ? (o["position"] as Record<string, unknown>) : o;
  const lat = num(p?.["lat"]);
  const lng = num(p?.["lng"]);
  return lat !== null && lng !== null ? fmtPos(lat, lng) : null;
}

const quoted = (v: string | null) => (v === null || v === "" ? w("site.none") : `“${esc(v)}”`);

function describe(e: SiteHistoryEntry): string {
  if (e.redacted) return w("history.removed");
  const b = e.before ?? {};
  const a = e.after ?? {};
  let detail = "";
  switch (e.kind) {
    case "existing":
    case "created":
    case "seeded": {
      const name = str(a["name"]);
      const at = where(e.after);
      detail = [name ? quoted(name) : "", at ? esc(at) : ""].filter(Boolean).join(" · ");
      break;
    }
    case "renamed":
      detail = `${quoted(str(b["name"]))} → ${quoted(str(a["name"]))}`;
      break;
    case "moved":
    case "made_private_moved": {
      const from = where(e.before);
      const to = where(e.after);
      detail = from || to ? `${esc(from ?? "")} → ${esc(to ?? "")}` : "";
      break;
    }
    case "label_changed":
      detail = `${quoted(str(b["publicLabel"]))} → ${quoted(str(a["publicLabel"]))}`;
      break;
    default:
      detail = "";
  }
  const reason = e.note ? ` <span class="meta">${w("sitehist.reason")}: ${esc(e.note)}</span>` : "";
  return kindText(e.kind) + (detail ? `: ${detail}` : "") + reason;
}

function historyList(history: SiteHistoryEntry[]): string {
  if (history.length === 0) return `<p class="empty">${w("site.noHistory")}</p>`;
  return (
    `<ol class="history">` +
    history
      .map(
        (e) =>
          `<li class="statement"><p>${describe(e)}</p>` +
          `<p class="meta">${w("site.by")} ${esc(e.by)} · <time datetime="${esc(e.at)}">${esc(day(e.at))}</time></p></li>`,
      )
      .join("") +
    `</ol>`
  );
}

const textOrNone = (v: string | null) =>
  v && v.trim() !== "" ? `<p class="note">${esc(v)}</p>` : `<p class="empty">${w("site.none")}</p>`;

export function renderSitePage(opts: {
  site: SiteView;
  personName: string;
  view: View;
  colonies: Array<{ id: number; name: string }>;
  done?: string;
}): string {
  const s = opts.site;
  const map = renderMap({
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
    ? `<p>${w("site.publicSince")} ${s.madePublicAt ? esc(day(s.madePublicAt)) : ""}` +
      (s.madePublicBy ? `, ${w("site.by")} ${esc(s.madePublicBy)}` : "") +
      `</p>`
    : `<p>${w("site.privateSentence")}</p>`;
  const retired = s.retiredAt
    ? `<p class="notice">${w("site.retiredSince")} ${esc(day(s.retiredAt))}</p>`
    : "";
  const colony = s.colony
    ? `<p><a href="${esc(colonyHref(s.colony.id))}">${esc(s.colony.name)}</a></p>`
    : `<p class="empty">${w("site.noColony")}</p>`;
  return renderPage({
    title: s.name,
    active: "sites",
    personName: opts.personName,
    mainClass: "mappage",
    beforeTitle: `<p class="back"><a href="${SITES_PATH}">${w("site.back")}</a></p>`,
    body:
      map +
      // Below the map, so nothing of variable height sits above it (see .mappage).
      banner(opts.done) +
      retired +
      visibility +
      `<h2>${w("site.colony")}</h2>` +
      colony +
      `<h2>${w("site.notes")}</h2>` +
      textOrNone(s.notes) +
      `<p class="hint">${w("notes.hint")}</p>` +
      `<h2>${w("site.directions")}</h2>` +
      textOrNone(s.directions) +
      `<h2>${w("site.position")}</h2>` +
      `<p class="syrline">${esc(fmtPos(s.lat, s.lng))}</p>` +
      `<h2>${w("site.historyTitle")}</h2>` +
      historyList(s.history) +
      `<h2>${w("act.title")}</h2>` +
      `<div class="actions" data-actions="site">${renderSiteActions(s, opts.colonies)}</div>`,
  });
}

export function renderNoSuchSite(personName: string): string {
  return renderPage({
    title: t("site.noSuch"),
    active: "sites",
    personName,
    body: `<p>${w("site.noSuchBody")}</p><p><a href="${SITES_PATH}">${w("site.backToSites")}</a></p>`,
  });
}
