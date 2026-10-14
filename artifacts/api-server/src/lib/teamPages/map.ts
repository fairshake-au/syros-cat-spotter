import { escapeHtml as esc } from "./escape";
import {
  BANDS,
  clampView,
  GRID,
  isTileAllowed,
  MAX_ZOOM,
  MIN_ZOOM,
  pan,
  pointOnView,
  viewAround,
  viewTiles,
  type Position,
  type TileSize,
  type View,
} from "../mapTiles/geometry";
import { AREAS } from "../mapTiles/areas";
import { mintTileToken } from "../mapTiles/tileToken";

// The team's map (SYC-209 PR 3.1; spec §3, Decision 1A; plan K4, K13). One
// function draws it, so a better map can replace it later without touching
// any page that uses it.
//
// No scripts: the map is 2×2 pictures served by our own server. In `view`
// mode they are plain pictures and the markers are links. In `place` mode
// each picture is an image button in its own form, and the browser posts the
// point that was tapped; the server turns it into a position.
//
// Rules this keeps, each with a test:
// - **No position in any address** (K13). Pictures are fetched by an opaque
//   token; zoom, pan, the area buttons and every tap are POST forms whose
//   hidden fields carry the view. No `href`, `action` or `src` holds a
//   coordinate or a z/x/y.
// - **Never shrunk** (K4). The map is drawn once per screen-width band, at
//   exactly its size, and the CSS shows exactly one. Each tap form carries
//   the size it was drawn at, so the server converts at the scale tapped.
// - **Whole pixels.** Every picture starts on a whole pixel (the tap test:
//   WebKit misreads taps by up to 1.5 px otherwise). The page puts the map
//   under fixed-height lines only; see `.mappage` in layout.ts.

export interface MapMarker extends Position {
  /** Read by screen readers and shown on hover. */
  label: string;
  /** View mode: where the marker goes. Never holds a position. */
  href?: string;
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
  /** Seconds, for the picture tokens; tests pin it. */
  now?: number;
}

export const DEFAULT_TAP_ACTION = "/api/team/map/tap";
export const DEFAULT_MOVE_ACTION = "/api/team/map";

const hiddenField = (name: string, value: string) =>
  `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;

const hiddenFields = (fields: Record<string, string> | undefined) =>
  Object.entries(fields ?? {})
    .map(([k, v]) => hiddenField(k, v))
    .join("");

const CORNER = ["top left", "top right", "bottom left", "bottom right"];

/** The view a map option set describes, kept over the island. */
export function resolveView(opts: Pick<MapOptions, "view" | "centre" | "zoom">): View {
  if (opts.view) return clampView(opts.view);
  if (opts.centre) return viewAround(opts.centre, opts.zoom ?? MIN_ZOOM);
  throw new Error("renderMap: a view or a centre is needed");
}

function band(
  view: View,
  size: number,
  opts: MapOptions,
  tokens: Map<string, string>,
): string {
  const span = GRID * size;
  const tileHtml = viewTiles(view)
    .map((tile, i) => {
      if (!isTileAllowed(tile)) {
        // Off the island's tiles: a blank square, never fetched.
        return `<span class="blank" style="width:${size}px;height:${size}px"></span>`;
      }
      const key = `${tile.x}/${tile.y}/${size}`;
      let token = tokens.get(key);
      if (!token) {
        token = mintTileToken({ ...tile, size: size as TileSize }, opts.now);
        tokens.set(key, token);
      }
      const src = `/api/team/map-tiles/${token}`;
      if (opts.mode === "view") {
        return `<img src="${src}" width="${size}" height="${size}" alt="" loading="lazy">`;
      }
      return (
        `<form method="post" action="${esc(opts.tapAction ?? DEFAULT_TAP_ACTION)}">` +
        hiddenField("tile", token) +
        hiddenField("size", String(size)) +
        hiddenFields(opts.hidden) +
        `<input type="image" src="${src}" width="${size}" height="${size}" ` +
        `alt="Map picture, ${CORNER[i]}. Tap to pick a spot.">` +
        "</form>"
      );
    })
    .join("");
  const pins = (opts.markers ?? [])
    .map((m) => {
      const at = pointOnView(view, size, m);
      if (!at) return "";
      const style = `left:${at.left}px;top:${at.top}px`;
      const label = esc(m.label);
      return opts.mode === "view" && m.href
        ? `<a class="pin" style="${style}" href="${esc(m.href)}" title="${label}"><span class="sr">${label}</span></a>`
        : `<span class="pin" style="${style}" title="${label}"><span class="sr">${label}</span></span>`;
    })
    .join("");
  return (
    `<div class="mapband b${size}" style="width:${span}px;height:${span}px">` +
    `<div class="maptiles" style="grid-template-columns:${size}px ${size}px">${tileHtml}</div>` +
    pins +
    "</div>"
  );
}

function controls(view: View, opts: MapOptions): string {
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
    button("go", "in", "Zoom in", view.z >= MAX_ZOOM) +
    button("go", "out", "Zoom out", view.z <= MIN_ZOOM) +
    "</div>" +
    '<div class="panrow">' +
    button("go", "north", "↑ North", stuck(0, -1)) +
    button("go", "west", "← West", stuck(-1, 0)) +
    button("go", "east", "East →", stuck(1, 0)) +
    button("go", "south", "↓ South", stuck(0, 1)) +
    "</div>" +
    '<p class="label">Go to</p><div class="arearow">' +
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
  const tokens = new Map<string, string>();
  return (
    `<div class="map" role="group" aria-label="Map of Syros, zoom ${view.z} of ${MAX_ZOOM}">` +
    BANDS.map((b) => band(view, b.size, opts, tokens)).join("") +
    "</div>" +
    '<p class="attrib">Map pictures © <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">OpenStreetMap contributors</a></p>' +
    controls(view, opts)
  );
}
