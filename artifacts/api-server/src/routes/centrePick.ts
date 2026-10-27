import { areaFor } from "../lib/areas/namedAreas";
import { t } from "../lib/teamPages/words";
import type { Position } from "../lib/mapTiles/geometry";
import { readPick, type Picked } from "./teamSites";

// The tap (or typed position) behind "set the centre on a map" for a colony
// and for an area (SYC-517, 517-B): the site pickers' own reader, with the
// off-island refusal said the way the spec words it. Nothing is saved here.

export const CENTRE_ZOOM = 16;

/**
 * Reads the map's pin, typed numbers or (colony centres only) an area from
 * the list. A spot off the island, or (for a colony) one `areaFor` calls Off
 * Syros, is refused with "That's off Syros. Choose a spot on the island." An
 * area's centre may sit anywhere on Syros, so it skips the second check: it
 * is the area being moved that decides what is near. An area's own centre is
 * never chosen from the list of areas (`allowArea: false`).
 */
export function readCentrePick(
  body: Record<string, unknown>,
  lang: string | undefined,
  opts: { requireArea: boolean; allowArea: boolean },
): Picked {
  const picked = readPick(body, lang, { allowArea: opts.allowArea });
  const off = t("centre.off", lang);
  if (!picked.ok) {
    return picked.note === t("sproblem.outside", lang) ? { ...picked, note: off } : picked;
  }
  if (opts.requireArea && areaFor(picked.spot.lat, picked.spot.lng).key === "off") {
    return { ok: false, status: 400, note: off, fields: ["lat", "lng"] };
  }
  return picked;
}

/** Where the map opens when nothing else says: Ermoupoli, zoom 15. */
export const ERMOUPOLI_START: { centre: Position; zoom: number } = { centre: { lat: 37.4447, lng: 24.9417 }, zoom: 15 };
