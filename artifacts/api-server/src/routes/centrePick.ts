import { areaFor } from "../lib/areas/namedAreas";
import { t } from "../lib/teamPages/words";
import { viewAround, type View } from "../lib/mapTiles/geometry";
import { readPick, type Picked } from "./teamSites";

// The tap (or typed position) behind "set the centre on a map" for a colony
// and for an area (SYC-517, 517-B): the site pickers' own reader, with the
// off-island refusal said the way the spec words it. Nothing is saved here.

export const CENTRE_ZOOM = 16;

/**
 * Reads a tap or typed position. A spot off the island, or (for a colony)
 * one `areaFor` calls Off Syros, is refused with "That's off Syros. Tap a spot
 * on the island." An area's centre may sit anywhere on Syros, so it skips the
 * second check: it is the area being moved that decides what is near.
 */
export function readCentrePick(
  body: Record<string, unknown>,
  lang: string | undefined,
  start: View,
  opts: { requireArea: boolean },
): Picked {
  const picked = readPick(body, lang);
  const off = t("centre.off", lang);
  if (!picked.ok) {
    return picked.note === t("sproblem.outside", lang) ? { ...picked, note: off, view: start } : picked;
  }
  if (opts.requireArea && areaFor(picked.spot.lat, picked.spot.lng).key === "off") {
    return { ok: false, status: 400, view: start, note: off, fields: ["lat", "lng"] };
  }
  return picked;
}

/** Where the map opens when nothing else says: Ermoupoli. */
export const ERMOUPOLI_VIEW: View = viewAround({ lat: 37.4447, lng: 24.9417 }, 15);
