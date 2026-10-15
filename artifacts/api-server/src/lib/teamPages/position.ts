/**
 * The one place a team page prints a position or builds a map link (SYC-362).
 * Positions print to 5 decimal places (about 1 m). The "Open map" link is only
 * added when the caller says so: island-wide viewers get it, nobody else.
 * Never pass link: true for an owner's home pin (D5).
 */
import { escapeHtml as esc } from "./escape";

export const roundPos = (n: number): string => n.toFixed(5);

export const mapUrl = (lat: number, lng: number): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${roundPos(lat)},${roundPos(lng)}`)}`;

/** Returns trusted HTML (already escaped). */
export function position(lat: number, lng: number, opts: { link: boolean }): string {
  const here = esc(`${roundPos(lat)}, ${roundPos(lng)}`);
  if (!opts.link) return here;
  return `${here} &middot; <a href="${esc(mapUrl(lat, lng))}" rel="noopener noreferrer">Open map</a>`;
}
