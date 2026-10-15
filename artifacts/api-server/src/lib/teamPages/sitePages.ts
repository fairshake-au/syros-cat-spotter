import type { SiteChange, SiteCounts, SiteHistoryEntry, SiteRow, SiteView } from "../teamSites";
import type { View } from "../mapTiles/geometry";
import { escapeHtml as esc } from "./escape";
import { day } from "./colonyPages";
import { renderPage } from "./layout";
import { renderMap, type MapMarker } from "./map";
import { t, type WordKey } from "./words";

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
}): string {
  const map = renderMap({
    view: opts.view,
    markers: opts.sites.map(markerFor),
    mode: "view",
    moveAction: SITES_MOVE_PATH,
    // The page's own setting travels with every map button, as a fixed key.
    hidden: opts.showRetired ? { retired: "1" } : undefined,
  });
  const retiredForm =
    `<form method="get" action="${SITES_PATH}" class="search">` +
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
      map +
      (opts.note ? `<p class="warn">${esc(opts.note)}</p>` : "") +
      `<p class="hint">${w("sites.legend")}</p>` +
      `<p><strong>${esc(countLine(opts.counts))}</strong></p>` +
      retiredForm +
      `<h2>${w("sites.recentTitle")}</h2>` +
      recentStrip(opts.changes) +
      `<h2>${w("sites.listTitle")}</h2>` +
      list +
      `<p class="hint">${w("sites.mapHint")}</p>`,
  });
}

// ── One site ───────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** A position as plain text, team-only. */
function where(o: Record<string, unknown> | null): string | null {
  const p = o && typeof o["position"] === "object" && o["position"] ? (o["position"] as Record<string, unknown>) : o;
  const lat = num(p?.["lat"]);
  const lng = num(p?.["lng"]);
  return lat !== null && lng !== null ? `${lat}, ${lng}` : null;
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
      `<p class="syrline">${esc(`${s.lat}, ${s.lng}`)}</p>` +
      `<h2>${w("site.historyTitle")}</h2>` +
      historyList(s.history) +
      // PR 3.3 puts Edit details, Move on the map, Retire and Change colony here.
      `<div class="actions" data-actions="site"></div>`,
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
