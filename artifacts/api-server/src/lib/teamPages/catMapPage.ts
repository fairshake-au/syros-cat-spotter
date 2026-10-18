import { filtersToQuery } from "../teamCatFilters";
import type { CatListFilters, CatListItem, SterilisedMark } from "../teamCatList";
import { assetUrl } from "../teamAssets";
import { AREAS } from "../mapTiles/areas";
import { latToTileY, lngToTileX, MAX_ZOOM, MIN_ZOOM, type View } from "../mapTiles/geometry";
import { activeChips, catsAddress, filterForm, viewSwitch } from "./catGridPage";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { lastSeenWords } from "./lastSeen";
import { renderMap, type MapMarker } from "./map";
import { MARK_ORDER, MARK_WORD } from "./marks";

// The island Map (SYC-396 PR 1.5; spec §6, §10, §12.2, §12.4, §13). Every
// active cat at the place it was last seen, on the Cats page as
// `GET /api/team/cats?view=map` (plan Decision 1), with the grid's filters
// and one switch between Grid and Map.
//
// **With the script** (assets/dashboard-map.js on Leaflet, both from our own
// server): a draggable, pinchable map whose pictures come by token
// (POST /api/team/map-squares, then GET /api/team/map-square/:token), whose
// cats come from a signed-in POST (POST /api/team/cats/positions, the filters
// in the body), grouped when zoomed out, with a card on tap.
//
// **Without it**: the button map that works today, with the cats as markers
// (grouped the same way) inside <noscript>. Its zoom, pan and "Go to"
// buttons post to POST /api/team/cats/map, which draws this page again with
// no script at all and the button map in the open.
//
// **No position in any address** (spec §10.4). The page's own address holds
// filter codes, the search text (D11) and at most a cat's number (`focus`).
// Positions are in the signed-in page only: the feeding sites and a focused
// cat's trail as data on #island-map, for the script; pins' pixel offsets in
// the button map. Nothing here prints a position as numbers: the card and the
// labels give the place in words.

const PATH = "/api/team/cats";
export const CAT_MAP_MOVE_PATH = "/api/team/cats/map";

/** A feeding site, as the map draws it: a square (spec §12.4). */
export interface MapSite {
  id: number;
  name: string;
  lat: number;
  lng: number;
  look: "public" | "private";
}

/** A focused cat's trail: where it was first found, then each sighting, oldest first. */
export interface MapTrail {
  id: number;
  name: string;
  points: { lat: number; lng: number; at: Date; first: boolean }[];
}

export interface CatMapOptions {
  personName: string;
  filters: CatListFilters;
  colonies: { id: number; name: string }[];
  /** Every cat the filters match (for the button map and the count). */
  cats: CatListItem[];
  /** Every cat there is, before any filter. */
  catCount: number;
  /** The team's feeding sites (visibleColonyIds), for the Feeding sites layer. */
  sites: MapSite[];
  /** `focus=<id>`: that cat's trail, for "Where else it's been seen". */
  focus: MapTrail | null;
  /** The button map's view. */
  view: View;
  now: Date;
  /**
   * True: the scripted page (the GET), with the button map in <noscript>.
   * False: the button map in the open and no script (after a button-map move).
   */
  scripted: boolean;
  /** A note after a move that couldn't be read. */
  note?: string;
}

/** The legend's words and shapes: the four marks, then the three kinds of site square. */
function legend(): string {
  const marks = MARK_ORDER.map(
    (m) => `<li><span class="catdot mark-${m}" aria-hidden="true"></span>${esc(MARK_WORD[m])}</li>`,
  ).join("");
  return (
    '<details class="maplegend" id="maplegend" open><summary>Key</summary>' +
    `<ul aria-label="Cats, by sterilisation">${marks}</ul>` +
    '<ul aria-label="Feeding sites">' +
    '<li><span class="sitesq site-public" aria-hidden="true"></span>Public feeding site</li>' +
    '<li><span class="sitesq site-private" aria-hidden="true"></span>Private feeding site</li>' +
    '<li><span class="sitesq site-retired" aria-hidden="true"></span>Retired feeding site</li>' +
    "</ul></details>"
  );
}

/** Cells per map square when grouping nearby cats on the button map. */
const CELLS_PER_SQUARE = 8;

/**
 * The button map's markers: one per cat, or one group where several fall in
 * the same small cell at this zoom (about 32px at 256px squares). Each cat's
 * marker links to its page.
 */
export function buttonMapMarkers(cats: CatListItem[], z: number, now: Date): MapMarker[] {
  const cells = new Map<string, CatListItem[]>();
  for (const c of cats) {
    const key = `${Math.floor(lngToTileX(c.placedAt.lng, z) * CELLS_PER_SQUARE)}:${Math.floor(latToTileY(c.placedAt.lat, z) * CELLS_PER_SQUARE)}`;
    const list = cells.get(key);
    if (list) list.push(c);
    else cells.set(key, [c]);
  }
  const out: MapMarker[] = [];
  for (const group of cells.values()) {
    if (group.length === 1) {
      const c = group[0]!;
      out.push({
        lat: c.placedAt.lat,
        lng: c.placedAt.lng,
        look: c.mark,
        href: `${PATH}/${c.id}`,
        label: `${c.name}: ${MARK_WORD[c.mark]}. ${lastSeenWords(c.lastSeenAt, now)}, ${c.place}.`,
      });
      continue;
    }
    const split: Partial<Record<SterilisedMark, number>> = {};
    for (const c of group) split[c.mark] = (split[c.mark] ?? 0) + 1;
    out.push({
      lat: group.reduce((n, c) => n + c.placedAt.lat, 0) / group.length,
      lng: group.reduce((n, c) => n + c.placedAt.lng, 0) / group.length,
      look: "cluster",
      cluster: { count: group.length, split },
      label: `${group.length} cats here. Zoom in to see each one.`,
    });
  }
  return out;
}

const dayMonth = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Athens" });

/** The trail on the button map: numbered sighting markers, each with its date. */
function trailMarkers(t: MapTrail): MapMarker[] {
  return t.points.map((p, i) => ({
    lat: p.lat,
    lng: p.lng,
    look: "sighting" as const,
    label: `${i + 1}. ${p.first ? "First recorded" : "Seen"} ${dayMonth(p.at)}`,
  }));
}

/** The data the script reads, as JSON in an attribute (escaped; parsed, never run). */
function dataAttr(name: string, value: unknown): string {
  return ` data-${name}="${esc(JSON.stringify(value))}"`;
}

function countLine(o: CatMapOptions): string {
  const filtered = Object.keys(o.filters).some((k) => k !== "page" && k !== "sort");
  const clear = filtered ? ` <a class="tap" id="mapclear" href="${esc(catsAddress({}, undefined, true))}">Clear filters</a>` : "";
  if (o.cats.length === 0 && o.catCount === 0) {
    return '<p class="empty" id="mapcount" role="status">No cats recorded yet. Cats appear here once spotters send sightings.</p>';
  }
  if (o.cats.length === 0) {
    return `<p class="count" id="mapcount" role="status">No cats match these filters${clear || ` <a class="tap" id="mapclear" href="${esc(catsAddress({}, undefined, true))}">Clear filters</a>`}</p>`;
  }
  const n = o.cats.length === 1 ? "1 cat on the map" : `${o.cats.length} cats on the map`;
  return `<p class="count" id="mapcount" role="status"><span id="mapcountn">${n}</span>${clear}</p>`;
}

function buttonMap(o: CatMapOptions): string {
  const markers = [...buttonMapMarkers(o.cats, o.view.z, o.now), ...(o.focus ? trailMarkers(o.focus) : [])];
  const hidden: Record<string, string> = { filters: filtersToQuery({ ...o.filters, page: undefined }) };
  if (o.focus) hidden["focus"] = String(o.focus.id);
  return (
    '<div class="mapfallback">' +
    renderMap({ view: o.view, markers, mode: "view", moveAction: CAT_MAP_MOVE_PATH, hidden }) +
    '<p class="hint">Tap a cat to open it. A circle with a number is a group of cats: zoom in to see each one.</p>' +
    "</div>"
  );
}

/** The island Map page. Trusted HTML: fixed text, numbers, assetUrl() addresses and escapeHtml only. */
export function renderCatMapPage(o: CatMapOptions): string {
  const top =
    viewSwitch(o.filters, "map") +
    filterForm(o, true) +
    `<div id="mapresults">${activeChips(o, true)}${countLine(o)}</div>` +
    (o.note ? `<p class="warn" role="status">${esc(o.note)}</p>` : "");

  if (!o.scripted) {
    return renderPage({
      title: "Cats",
      active: "cats",
      personName: o.personName,
      mainClass: "wide",
      body: top + buttonMap(o) + teamOnlyHint(),
    });
  }

  const focus = o.focus
    ? {
        id: o.focus.id,
        name: o.focus.name,
        points: o.focus.points.map((p) => ({ lat: p.lat, lng: p.lng, at: p.at.toISOString(), first: p.first })),
      }
    : null;
  const areas = AREAS.map((a) => ({ key: a.key, label: a.label, lat: a.lat, lng: a.lng, zoom: a.zoom }));
  const goTo =
    '<div class="arearow" id="mapgoto" role="group" aria-label="Go to">' +
    AREAS.map((a) => `<button type="button" data-area="${esc(a.key)}">${esc(a.label)}</button>`).join("") +
    "</div>";
  const scripted =
    // Shown by the script once the map is up; with no script it stays hidden.
    '<div id="mapscripted" hidden>' +
    '<fieldset class="maplayers" id="maplayers"><legend>Show on the map</legend>' +
    '<label class="choicechip"><input type="checkbox" id="layer-cats" checked> Cats</label>' +
    '<label class="choicechip"><input type="checkbox" id="layer-sites"> Feeding sites</label>' +
    "</fieldset>" +
    '<div class="mapwrap">' +
    `<div id="island-map" role="region" aria-label="Map of Syros with the cats on it"` +
    ` data-minzoom="${MIN_ZOOM}" data-maxzoom="${MAX_ZOOM}"` +
    dataAttr("sites", o.sites) +
    dataAttr("areas", areas) +
    (focus ? dataAttr("focus", focus) : "") +
    "></div>" +
    legend() +
    '<p class="mapnote" id="mapnote" role="status" hidden>Map pictures aren\'t loading. The cats are still shown.</p>' +
    '<div class="catsheet" id="catsheet" role="dialog" aria-label="Cat" hidden></div>' +
    "</div>" +
    '<div class="mapmove"><p class="label">Go to</p>' +
    goTo +
    "</div>" +
    `<p class="attrib">Map pictures © <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">OpenStreetMap contributors</a></p>` +
    "</div>";
  return renderPage({
    title: "Cats",
    active: "cats",
    personName: o.personName,
    mainClass: "wide",
    body: top + scripted + `<noscript>${buttonMap(o)}</noscript>` + teamOnlyHint(),
    styles: [assetUrl("leaflet.css")],
    script: [assetUrl("leaflet.js"), assetUrl("dashboard-map.js")],
  });
}

function teamOnlyHint(): string {
  return (
    '<p class="hint">This map is only for the team. Our server fetches the map pictures, so your browser ' +
    "never tells a map company where you are looking.</p>"
  );
}
