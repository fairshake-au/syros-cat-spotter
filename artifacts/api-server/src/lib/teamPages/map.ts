import { escapeHtml as esc } from "./escape";
import {
  BANDS,
  clampView,
  GRID,
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
   * (SYC-209 PR 3.2), a sighting's (PR 3.4), or a cat's on the island map
   * (SYC-396 PR 1.5): one of the four sterilisation marks (spec §12.2), or a
   * group of nearby cats.
   */
  look?: "public" | "private" | "retired" | "sighting" | SterilisedMark | "cluster";
  /** A cluster only: how many cats, and how many of each mark (its ring). */
  cluster?: { count: number; split: Partial<Record<SterilisedMark, number>> };
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
