import { MAP_LANG } from "@workspace/map-style";
import { escapeHtml as esc } from "./escape";
import { wordsIn } from "./words";
import { assetUrl } from "../teamAssets";
import { ISLAND_BOX, ISLAND_CENTRE, type Position } from "../island";
import type { SterilisedMark } from "../teamCatList";

// The team's map (SYC-209 PR 3.1; SYC-705 Phase 2). One function draws it,
// so a page never knows how the map is made.
//
// Since SYC-705 the map is MapLibre GL JS drawing our own Syros map file, in
// the browser: renderMap writes a box holding what the page's scripts need
// (assets/map-core.js starts the map; dashboard-pin.js puts the markers on a
// view map) and, until a script replaces it, a line saying the map needs
// JavaScript. Everything else on the page (the lists, the links) works
// without it.
//
// Rules this keeps, each with a test:
// - **No position in any address** (K13). Positions are data in the box's
//   data-map attribute, never in an href, action or src. A marker links to
//   a record's number (a site, a sighting row), never to a position.
// - **Trusted HTML.** Fixed text, numbers, assetUrl() addresses and
//   escapeHtml only; the JSON is escaped into its attribute.
//
// The old picture map (zoom and pan buttons) is buttonMap.ts, kept only
// for the pages that place a spot until SYC-705 Task 2b.7.

export interface MapMarker extends Position {
  /** Read by screen readers and shown on hover. */
  label: string;
  /** View mode: where the marker goes. Never holds a position. */
  href?: string;
  /**
   * How a marker looks; a fixed set, never free text. A feeding site's
   * (SYC-209 PR 3.2), a sighting's (PR 3.4), a cat's on the island map
   * (SYC-396 PR 1.5): one of the four sterilisation marks (spec §12.2), or a
   * group of nearby cats; or one of a cat's own sightings on its page (PR 1.4).
   */
  look?: "public" | "private" | "retired" | "sighting" | SterilisedMark | "cluster" | "seen";
  /** A cluster only: how many cats, and how many of each mark (its ring). */
  cluster?: { count: number; split: Partial<Record<SterilisedMark, number>> };
  /** A number drawn on the marker: the cat page's sightings, in time order (SYC-396 PR 1.4). */
  n?: number;
  /** Drawn instead of `n` when set: a spot seen more than once ("2–4", "2, 5, 7"). */
  text?: string;
}

export interface MapOptions {
  /** `view`: markers to look at. `place`: pick a spot (SYC-705 Task 2b.7). */
  mode: "view" | "place";
  /** Where the map opens, and how close (app zoom, 12 to 19). Default: the island, zoom 12. */
  centre?: Position;
  zoom?: number;
  /** Fit these positions in view (never closer than zoom 17), instead of `centre`. */
  fit?: readonly Position[];
  markers?: MapMarker[];
  /** The viewer's language: picks the map's own (Greek for el, else English) and the buttons' words. */
  lang?: string;
  /** Place mode: the form whose lat/lng inputs the pin writes. */
  formId?: string;
  /** Write id="map" (the "#map" anchor). Default true; false where the page has its own anchor. */
  anchor?: boolean;
  /** The box's id instead of "map" (the island cats map's "island-map"). */
  id?: string;
  /** The box as a labelled region, for screen readers. */
  label?: string;
  /**
   * More JSON for a page's own script, each as data-<name> (the island cats
   * map's sites, areas and focused cat). Names are fixed lowercase words.
   */
  data?: Record<string, unknown>;
}

/** Where a map opens: the middle of the island, zoom 12 (defined in lib/island.ts). */
export { ISLAND_CENTRE };
export const START_ZOOM = 12;

/**
 * The box the map can show: Syros, padded by 0.03° (map-core.js's maxBounds,
 * the same numbers). A position outside it can never be in view.
 */
export const MAP_BOX = {
  minLat: ISLAND_BOX.minLat - 0.03,
  maxLat: ISLAND_BOX.maxLat + 0.03,
  minLng: ISLAND_BOX.minLng - 0.03,
  maxLng: ISLAND_BOX.maxLng + 0.03,
} as const;

/** Can the map show this position at all. */
export function inMapBox(p: Position): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= MAP_BOX.minLat &&
    p.lat <= MAP_BOX.maxLat &&
    p.lng >= MAP_BOX.minLng &&
    p.lng <= MAP_BOX.maxLng
  );
}

/** A spot's grouping key: the position rounded to 5 decimal places (never printed). */
const spotKey = (m: Position) => `${Math.round(m.lat * 1e5)},${Math.round(m.lng * 1e5)}`;

/** "2–4, 7": runs of consecutive numbers as a range, the rest comma-separated. */
function numberRanges(ns: readonly number[]): string {
  const sorted = [...new Set(ns)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(", ");
}

/**
 * One marker per spot (SYC-459 item 1): numbered markers at the same position
 * (to 5 decimal places) become one, drawn with the range of their numbers,
 * linking to the newest (highest number) and naming each in its label. Markers
 * without a number, and a spot with one marker, are left as they were.
 */
export function mergeSameSpot(markers: MapMarker[]): MapMarker[] {
  const groups = new Map<string, MapMarker[]>();
  const out: (MapMarker | string)[] = [];
  for (const m of markers) {
    if (!Number.isInteger(m.n)) {
      out.push(m);
      continue;
    }
    const key = spotKey(m);
    const g = groups.get(key);
    if (g) g.push(m);
    else {
      groups.set(key, [m]);
      out.push(key);
    }
  }
  return out.map((o) => {
    if (typeof o !== "string") return o;
    const g = groups.get(o)!;
    if (g.length === 1) return g[0]!;
    const newest = g.reduce((a, b) => (b.n! > a.n! ? b : a));
    const first = g[0]!;
    return {
      ...first,
      n: newest.n,
      text: numberRanges(g.map((m) => m.n!)),
      label: [...g].sort((a, b) => a.n! - b.n!).map((m) => m.label).join("; "),
      ...(newest.href !== undefined ? { href: newest.href } : {}),
    };
  });
}

/** The credit line the map's data asks for, linking to OpenStreetMap's copyright page. */
export function mapCredit(lang?: string): string {
  const { w } = wordsIn(lang);
  return `<p class="attrib"><a href="https://www.openstreetmap.org/copyright" rel="noreferrer">${w("map.attrib")}</a></p>`;
}

/**
 * The files a page with a map loads, in order (layout.ts renderPage's
 * `styles` and `script`): PMTiles, then map-core.js, then the view maps'
 * dashboard-pin.js. The page's route must send the wider security header
 * (setTeamHeaders(res, { scripts: true })) for its 200 page.
 */
export function mapPageAssets(): { styles: (string | null)[]; script: (string | null)[] } {
  return {
    styles: [assetUrl("maplibre-gl.css")],
    script: [assetUrl("pmtiles.js"), assetUrl("map-core.js"), assetUrl("dashboard-pin.js")],
  };
}

/** To 5 decimal places (about a metre): no float noise in the page. */
const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
const pair = (p: Position): [number, number] => [r5(p.lat), r5(p.lng)];

/** What dashboard-pin.js needs of a marker: fixed keys, the label as text. */
function markerData(m: MapMarker): Record<string, unknown> {
  return {
    lat: r5(m.lat),
    lng: r5(m.lng),
    label: m.label,
    ...(m.href !== undefined ? { href: m.href } : {}),
    ...(m.look !== undefined ? { look: m.look } : {}),
    ...(Number.isInteger(m.n) ? { n: m.n } : {}),
    ...(m.text !== undefined ? { text: m.text } : {}),
    ...(m.cluster ? { count: Math.max(0, Math.floor(m.cluster.count)) } : {}),
  };
}

/** A JSON value in a double-quoted attribute: escaped, so the page parses it as text. */
const jsonAttr = (v: unknown) => esc(JSON.stringify(v));

/**
 * The map's HTML: the box the scripts start the map in (its data in
 * data-map, the buttons' words in data-words, the library's and worker's
 * addresses), holding the "needs JavaScript" line until then; and the
 * credit line. If the library can't be served, only that line.
 */
export function renderMap(opts: MapOptions): string {
  const { t, w } = wordsIn(opts.lang);
  const id = opts.id !== undefined ? ` id="${esc(opts.id)}"` : opts.anchor === false ? "" : ' id="map"';
  const noMap = `<p class="mapnojs">${w("map.needsJs")}</p>`;
  const library = assetUrl("maplibre-gl.mjs");
  const worker = assetUrl("maplibre-gl-worker.mjs");
  // id="map": "Show on our map" lands here (#map), as the map sits below the fold on a phone.
  if (!library || !worker) return `<div class="nomap"${id}>${noMap}</div>`;
  const appLang = opts.lang === "el" || opts.lang === "fr" ? opts.lang : "en";
  const data = {
    mode: opts.mode,
    lang: MAP_LANG(appLang),
    centre: pair(opts.centre ?? ISLAND_CENTRE),
    zoom: opts.zoom ?? START_ZOOM,
    fit: opts.fit && opts.fit.length > 0 ? opts.fit.map(pair) : null,
    markers: (opts.markers ?? []).map(markerData),
    ...(opts.formId !== undefined ? { formId: opts.formId } : {}),
    // Place mode: where a spot may be saved (the server's inIsland box).
    ...(opts.mode === "place" ? { island: { ...ISLAND_BOX } } : {}),
  };
  const words = {
    zoomIn: t("map.zoomIn"),
    zoomOut: t("map.zoomOut"),
    compass: t("map.compass"),
    needsJs: t("map.needsJs"),
    loading: t("map.loading"),
    // Place mode: the map's own name for screen readers (SYC-705 Task 2b.7).
    ...(opts.mode === "place" ? { place: t("map.place"), moved: t("map.moved"), offIsland: t("map.offIsland") } : {}),
  };
  const label = opts.label !== undefined ? ` role="region" aria-label="${esc(opts.label)}"` : "";
  const extra = Object.entries(opts.data ?? {})
    .filter(([name, v]) => /^[a-z]+$/.test(name) && v !== undefined)
    .map(([name, v]) => ` data-${name}="${jsonAttr(v)}"`)
    .join("");
  return (
    `<div class="map"${id}${label} data-map="${jsonAttr(data)}" data-words="${jsonAttr(words)}"${extra} ` +
    `data-maplibre="${esc(library)}" data-worker="${esc(worker)}">` +
    noMap +
    "</div>" +
    mapCredit(opts.lang)
  );
}
