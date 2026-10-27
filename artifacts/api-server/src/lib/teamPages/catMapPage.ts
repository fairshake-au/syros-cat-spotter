import type { CatListFilters, CatListItem } from "../teamCatList";
import { assetUrl } from "../teamAssets";
import { currentAreas } from "../areas/namedAreas";
import { activeChips, catsAddress, filterForm, viewRow } from "./catGridPage";
import { escapeHtml as esc } from "./escape";
import { pageIntro } from "./help";
import { renderPage } from "./layout";
import { ISLAND_CENTRE, renderMap, START_ZOOM } from "./map";
import { mapPrivacyNote } from "./mapNote";
import { MARK_ORDER, MARK_WORD } from "./marks";
import { tr } from "./strings";

// The island Map (SYC-396 PR 1.5; spec §6, §10, §12.2, §12.4, §13; SYC-705
// Phase 2). Every active cat at the place it was last seen, on the Cats page
// as `GET /api/team/cats?view=map` (plan Decision 1), with the grid's filters
// and one switch between Grid and Map.
//
// **With the script** (assets/map-core.js starts MapLibre GL JS on our own
// Syros map file; assets/dashboard-map.js puts the cats on it): a draggable,
// pinchable map whose cats come from a signed-in POST
// (POST /api/team/cats/positions, the filters in the body), grouped when
// close together, with a card on tap.
//
// **Without it, or when the map can't start**: the map's box says the map
// needs JavaScript, and a link shows these same cats as the grid (the
// filters in its query, as the Grid switch has them; never a position).
//
// **No position in any address** (spec §10.4). The page's own address holds
// filter codes, the search text (D11) and at most a cat's number (`focus`).
// Positions are in the signed-in page only, as data on the map's box (the
// feeding sites, the Go to areas, a focused cat's trail) for the script.
// Nothing here prints a position as numbers: the card and the labels give
// the place in words.

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
  /** Every cat the filters match (for the count). */
  cats: CatListItem[];
  /** Every cat there is, before any filter. */
  catCount: number;
  /** The team's feeding sites (visibleColonyIds), for the Feeding sites layer. */
  sites: MapSite[];
  /** `focus=<id>`: that cat's trail, for "Where else it's been seen". */
  focus: MapTrail | null;
  now: Date;
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

/** The island Map page. Trusted HTML: fixed text, numbers, assetUrl() addresses and escapeHtml only. */
export function renderCatMapPage(o: CatMapOptions): string {
  const intro = pageIntro(
    "Each dot is a cat, placed where it was last seen. A circle with a number is a group of cats: zoom in to split it. These places are for the team only.",
  );
  const top =
    intro +
    // Same order as the grid (search and Filters, then Grid/Map), so the
    // controls stay put when the person switches view (SYC-522).
    filterForm(o, true) +
    viewRow(o, "map") +
    `<div id="mapresults">${activeChips(o, true)}${countLine(o)}</div>`;

  const focus = o.focus
    ? {
        id: o.focus.id,
        name: o.focus.name,
        points: o.focus.points.map((p) => ({ lat: p.lat, lng: p.lng, at: p.at.toISOString(), first: p.first })),
      }
    : null;
  const areas = currentAreas().map((a) => ({ key: a.key, name: a.name, lat: a.lat, lng: a.lng }));
  const map = renderMap({
    mode: "view",
    id: "island-map",
    label: "Map of Syros with the cats on it",
    centre: ISLAND_CENTRE,
    zoom: START_ZOOM,
    data: { sites: o.sites, areas, ...(focus ? { focus } : {}) },
  });
  // The map's credit line (renderMap's last part) goes under the Go to row.
  const creditAt = map.lastIndexOf('<p class="attrib">');
  const box = map.slice(0, creditAt);
  const credit = map.slice(creditAt);
  // Same fields as the Grid switch: the filters, never `view` or a position.
  const gridHref = catsAddress({ ...o.filters, page: undefined });
  const body =
    top +
    // Shown by the script once the map is up; with no script it stays hidden.
    '<fieldset class="maplayers" id="maplayers" hidden><legend>Show on the map</legend>' +
    '<label class="choicechip"><input type="checkbox" id="layer-cats" checked> Cats</label>' +
    '<label class="choicechip"><input type="checkbox" id="layer-sites"> Feeding sites</label>' +
    "</fieldset>" +
    '<div class="mapwrap">' +
    box +
    legend() +
    '<div class="catsheet" id="catsheet" role="dialog" aria-label="Cat" hidden></div>' +
    "</div>" +
    // No script, or the map can't start: the same cats as the grid.
    `<p class="mapfallback" id="mapgrid"><a class="tap" id="map-gridlink" href="${esc(gridHref)}">${esc(tr("en", "map.catsAsGrid"))}</a></p>` +
    '<div class="mapmove" id="mapmove" hidden><p class="label">Go to</p>' +
    '<div class="arearow" id="mapgoto" role="group" aria-label="Go to">' +
    areas.map((a) => `<button type="button" data-area="${esc(a.key)}">${esc(a.name)}</button>`).join("") +
    "</div></div>" +
    credit +
    mapPrivacyNote();
  return renderPage({
    title: "Map",
    active: "map",
    personName: o.personName,
    mainClass: "wide",
    body,
    styles: [assetUrl("maplibre-gl.css")],
    script: [assetUrl("pmtiles.js"), assetUrl("map-core.js"), assetUrl("dashboard-map.js")],
  });
}
