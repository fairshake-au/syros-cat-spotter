import { z } from "zod";
import {
  clampView,
  inIsland,
  isViewAllowed,
  pan,
  tapToPosition,
  viewAround,
  zoomIn,
  zoomOut,
  type Position,
  type View,
} from "./geometry";
import { AREAS, areaByKey } from "./areas";
import { readTileToken, type PictureRef } from "./tileToken";

// Reading the team map's forms (SYC-209 PR 3.1). Every page that has a map
// reads its taps and its zoom/pan/area buttons through these two functions,
// so the checks can't be left out of one: PR 3.3's picker and move pages
// call them too.

/** A whole number written plainly (no "1e3", no "0x10", no spaces). */
const wholeNumber = z.string().regex(/^-?\d{1,10}$/).transform(Number);

const TapForm = z.object({
  view: z.string().max(100),
  size: wholeNumber,
  // An image button posts the point tapped as x and y (it has no name).
  x: wholeNumber,
  y: wholeNumber,
});

export type Tap =
  | { ok: true; picture: PictureRef; spot: Position; point: { x: number; y: number } }
  /** The form couldn't be read: altered or expired (open over a day), or a size that isn't the picture's. */
  | { ok: false; reason: "unreadable" }
  /** (0, 0): a picture that never loaded, or a keyboard press. Not a place anyone tapped. */
  | { ok: false; reason: "no_point"; picture: PictureRef }
  /** A real tap, outside Syros. */
  | { ok: false; reason: "outside"; picture: PictureRef };

/**
 * A tap on a map picture. The form carries the picture's token and the size
 * it was drawn at; the browser adds the point. The size must be the token's
 * own, so a picture is always converted at the scale it was tapped at.
 */
export function readTap(body: unknown, nowSeconds?: number): Tap {
  const parsed = TapForm.safeParse(body);
  if (!parsed.success) return { ok: false, reason: "unreadable" };
  const picture = readTileToken(parsed.data.view, nowSeconds);
  if (!picture || picture.size !== parsed.data.size || !isViewAllowed(picture)) {
    return { ok: false, reason: "unreadable" };
  }
  const { x, y } = parsed.data;
  // (0, 0) is what a browser sends when the picture never loaded, or when
  // the button is pressed from the keyboard. Taking it would put the spot
  // on the picture's corner without a word.
  if (x === 0 && y === 0) return { ok: false, reason: "no_point", picture };
  const spot = tapToPosition(picture, picture.size, x, y);
  if (!spot) return { ok: false, reason: "unreadable" };
  if (!inIsland(spot)) return { ok: false, reason: "outside", picture };
  return { ok: true, picture, spot, point: { x, y } };
}

const MoveForm = z.object({
  vz: wholeNumber,
  vx: wholeNumber,
  vy: wholeNumber,
  go: z.enum(["in", "out", "north", "south", "east", "west"]).optional(),
  area: z.enum(AREAS.map((a) => a.key) as [string, ...string[]]).optional(),
});

/**
 * The zoom, pan and area buttons: the view after the button pressed, kept
 * over Syros, or null if the form couldn't be read.
 */
export function applyMove(body: unknown): View | null {
  const parsed = MoveForm.safeParse(body);
  if (!parsed.success) return null;
  const f = parsed.data;
  const view = clampView({ z: f.vz, x: f.vx, y: f.vy });
  const area = areaByKey(f.area);
  if (area) return viewAround(area, area.zoom);
  switch (f.go) {
    case "in":
      return zoomIn(view);
    case "out":
      return zoomOut(view);
    case "north":
      return pan(view, 0, -1);
    case "south":
      return pan(view, 0, 1);
    case "east":
      return pan(view, 1, 0);
    case "west":
      return pan(view, -1, 0);
    default:
      return view;
  }
}
