import { escapeHtml as esc } from "./escape";
import {
  BANDS,
  clampView,
  GRID,
  latToTileY,
  lngToTileX,
  MAX_ZOOM,
  MIN_ZOOM,
  pan,
  pointOnView,
  viewAround,
  type Position,
  type TileSize,
  type View,
} from "../mapTiles/geometry";
import { AREAS } from "../mapTiles/areas";
import { mintTileToken } from "../mapTiles/tileToken";
import { wordsIn } from "./words";
import { clusterRing } from "./marks";
import type { SterilisedMark } from "../teamCatList";

// The team's map (SYC-209 PR 3.1; spec §3, Decision 1A; plan K4, K13). One
// function draws it, so a better map can replace it later without touching
// any page that uses it.
//
// No scripts: the map is one picture, 2×2 map tiles joined by our own
// server. In `view` mode it is a plain picture and the markers are links. In
// `place` mode it is an image button in a form, and the browser posts the
// point that was tapped; the server turns it into a position.
//
// Rules this keeps, each with a test:
// - **No position in any address** (K13). The picture is fetched by an
//   opaque token; zoom, pan, the area buttons and every tap are POST forms whose
//   hidden fields carry the view. No `href`, `action` or `src` holds a
//   coordinate or a z/x/y.
// - **Never shrunk** (K4). The map is drawn once per screen-width band, at
//   exactly its size, and the CSS shows exactly one. Each tap form carries
//   the size it was drawn at, so the server converts at the scale tapped.
// - **Whole pixels.** The picture starts on a whole pixel (the tap test:
//   WebKit misreads taps by up to 1.5 px otherwise). The page puts the map
//   under fixed-height lines only; see `.mappage` in layout.ts.

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

const LOOKS: Record<NonNullable<MapMarker["look"]>, string> = {
  public: " site-public",
  private: " site-private",
  retired: " site-retired",
  // Where a cat was seen (PR 3.4): outlined and dashed, so it never reads as a site.
  sighting: " sighting",
  // A cat (SYC-396 PR 1.5): its mark's dot inside a 44px tap target.
  sterilised: " catpin",
  probably: " catpin",
  not_known: " catpin",
  not_sterilised: " catpin",
  cluster: " catpin cluster",
  // One of a cat's own sightings on its page (SYC-396 PR 1.4): a numbered
  // dark-ink circle. Circles mean cats; never teal, which means sterilisation.
  seen: " seen",
};

const isMark = (look: MapMarker["look"]): look is SterilisedMark =>
  look === "sterilised" || look === "probably" || look === "not_known" || look === "not_sterilised";

/** What is drawn inside a cat's pin: its dot, or a cluster's count in its ring. Fixed text and numbers only. */
function pinInside(m: MapMarker): string {
  if (isMark(m.look)) return `<span class="catdot mark-${m.look}" aria-hidden="true"></span>`;
  if (m.look === "cluster" && m.cluster) {
    const n = Math.max(0, Math.floor(m.cluster.count));
    return `<span class="catcluster" style="background:${clusterRing(m.cluster.split)}" aria-hidden="true"><span>${n}</span></span>`;
  }
  // One of a cat's own sightings on its page (SYC-396 PR 1.4): its number.
  if (m.look === "seen" && m.text) return `<span class="pinnum" aria-hidden="true">${esc(m.text)}</span>`;
  if (m.look === "seen" && Number.isInteger(m.n)) return `<span class="pinnum" aria-hidden="true">${m.n}</span>`;
  return "";
}

export interface MapOptions {
  /** What to show: a view, or a centre and zoom to build one around. */
  view?: View;
  centre?: Position;
  zoom?: number;
  markers?: MapMarker[];
  mode: "view" | "place";
  /** Place mode: where a tap posts. */
  tapAction?: string;
  /** Where zoom, pan and the area buttons post. */
  moveAction?: string;
  /** Extra hidden fields every map form carries (a page's own context). */
  hidden?: Record<string, string>;
  /** Leave out the zoom, pan and area buttons (a small map on a page of its own). Default true. */
  controls?: boolean;
  /** Seconds, for the picture tokens; tests pin it. */
  now?: number;
  /** The page's language (a cat guardian's own; English for the team). */
  lang?: string;
}

/** Where a map opens: the middle of the island, zoom 12. */
export const ISLAND_CENTRE: Position = { lat: 37.445, lng: 24.93 };
export const START_ZOOM = 12;

export const DEFAULT_TAP_ACTION = "/api/team/map/tap";
export const DEFAULT_MOVE_ACTION = "/api/team/map";

const hiddenField = (name: string, value: string) =>
  `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;

const hiddenFields = (fields: Record<string, string> | undefined) =>
  Object.entries(fields ?? {})
    .map(([k, v]) => hiddenField(k, v))
    .join("");

/**
 * The closest view (zoom 17 at most) that shows every point, at least a
 * marker's half-width in from the edge; the whole island when none fits.
 */
export function fitView(points: readonly Position[], maxZoom = 17): View {
  if (points.length === 0) return viewAround(ISLAND_CENTRE, MIN_ZOOM);
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const centre = {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  };
  // Worked out at the smallest picture, where a marker takes the most room.
  const size = BANDS[0].size;
  const margin = 12;
  const fits = (v: View) =>
    points.every((p) => {
      const at = pointOnView(v, size, p);
      return at !== null && Math.min(at.left, at.top, GRID * size - at.left, GRID * size - at.top) >= margin;
    });
  const centreX = (z: number) => lngToTileX(centre.lng, z);
  const centreY = (z: number) => latToTileY(centre.lat, z);
  for (let z = maxZoom; z >= MIN_ZOOM; z--) {
    const base = viewAround(centre, z);
    // The view snaps to whole map pictures, so also try one picture over each way,
    // and keep the fitting view whose middle is nearest the points' middle.
    let best: View | null = null;
    let nearest = Infinity;
    for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const v = clampView({ z, x: base.x + dx, y: base.y + dy });
      if (!fits(v)) continue;
      const away = Math.hypot(v.x + GRID / 2 - centreX(z), v.y + GRID / 2 - centreY(z));
      if (away < nearest) [best, nearest] = [v, away];
    }
    if (best) return best;
  }
  // Too far apart for one picture: the widest view that shows the most of
  // them, and the page says how many didn't fit.
  let best = viewAround(centre, MIN_ZOOM);
  let most = -1;
  for (const p of [centre, ...points]) {
    const v = viewAround(p, MIN_ZOOM);
    const n = points.filter((q) => pointOnView(v, size, q) !== null).length;
    if (n > most) [best, most] = [v, n];
  }
  return best;
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

/** The view a map option set describes, kept over the island. */
export function resolveView(opts: Pick<MapOptions, "view" | "centre" | "zoom">): View {
  if (opts.view) return clampView(opts.view);
  if (opts.centre) return viewAround(opts.centre, opts.zoom ?? MIN_ZOOM);
  throw new Error("renderMap: a view or a centre is needed");
}

function band(view: View, size: number, opts: MapOptions): string {
  const { w } = wordsIn(opts.lang);
  const span = GRID * size;
  // One picture per band: the view's 2×2 tiles joined by the server at
  // exactly this size (plan K4's mosaic). No seams to tap on.
  const token = mintTileToken({ ...view, size: size as TileSize }, opts.now);
  const src = `/api/team/map-tiles/${token}`;
  const picture =
    opts.mode === "view"
      ? `<img src="${src}" width="${span}" height="${span}" alt="${w("map.alt")}" loading="lazy">`
      : `<form method="post" action="${esc(opts.tapAction ?? DEFAULT_TAP_ACTION)}">` +
        hiddenField("view", token) +
        hiddenField("size", String(size)) +
        hiddenFields(opts.hidden) +
        `<input type="image" src="${src}" width="${span}" height="${span}" ` +
        `alt="${w("map.altPlace")}">` +
        "</form>";
  const pins = (opts.markers ?? [])
    .map((m) => {
      const at = pointOnView(view, size, m);
      if (!at) return "";
      const style = `left:${at.left}px;top:${at.top}px`;
      const label = esc(m.label);
      const cls = "pin" + (m.look && Object.hasOwn(LOOKS, m.look) ? LOOKS[m.look] : "");
      const inside = pinInside(m);
      return opts.mode === "view" && m.href
        ? `<a class="${cls}" style="${style}" href="${esc(m.href)}" title="${label}">${inside}<span class="sr">${label}</span></a>`
        : `<span class="${cls}" style="${style}" title="${label}">${inside}<span class="sr">${label}</span></span>`;
    })
    .join("");
  return (
    `<div class="mapband b${size}" style="width:${span}px;height:${span}px">` +
    picture +
    pins +
    "</div>"
  );
}

function controls(view: View, opts: MapOptions): string {
  const { t } = wordsIn(opts.lang);
  const button = (name: string, value: string, label: string, disabled = false) =>
    `<button type="submit" name="${name}" value="${esc(value)}"${disabled ? " disabled" : ""}>${esc(label)}</button>`;
  const stuck = (dx: number, dy: number) => {
    const moved = pan(view, dx, dy);
    return moved.x === view.x && moved.y === view.y;
  };
  return (
    `<form method="post" action="${esc(opts.moveAction ?? DEFAULT_MOVE_ACTION)}" class="mapmove">` +
    hiddenField("vz", String(view.z)) +
    hiddenField("vx", String(view.x)) +
    hiddenField("vy", String(view.y)) +
    hiddenFields(opts.hidden) +
    '<div class="zoomrow">' +
    button("go", "in", t("map.zoomIn"), view.z >= MAX_ZOOM) +
    button("go", "out", t("map.zoomOut"), view.z <= MIN_ZOOM) +
    "</div>" +
    '<div class="panrow">' +
    button("go", "north", t("map.north"), stuck(0, -1)) +
    button("go", "west", t("map.west"), stuck(-1, 0)) +
    button("go", "east", t("map.east"), stuck(1, 0)) +
    button("go", "south", t("map.south"), stuck(0, 1)) +
    "</div>" +
    `<p class="label">${esc(t("map.goTo"))}</p><div class="arearow">` +
    AREAS.map((a) => button("area", a.key, a.label)).join("") +
    "</div></form>"
  );
}

/**
 * The map's HTML: the pictures (one set per screen-width band), the markers,
 * the attribution the map provider requires, and the zoom, pan and area
 * buttons. Trusted HTML: fixed text, numbers, tokens and escapeHtml only.
 */
export function renderMap(opts: MapOptions): string {
  const view = resolveView(opts);
  const { w } = wordsIn(opts.lang);
  return (
    // id="map": "Show on our map" lands here (#map), as the map sits below the
    // fold on a phone. One map per page.
    `<div class="map" id="map" role="group" aria-label="${w("map.aria", { zoom: String(view.z), max: String(MAX_ZOOM) })}">` +
    BANDS.map((b) => band(view, b.size, opts)).join("") +
    "</div>" +
    `<p class="attrib">${w("map.attrib")} <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">${w("map.attribLink")}</a></p>` +
    (opts.controls === false ? "" : controls(view, opts))
  );
}
