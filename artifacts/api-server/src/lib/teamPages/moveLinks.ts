// The addresses of the move screen (which-cat-is-which.md §5.1, §5.2; SYC-150
// PR 3.3). Plain links, so every way in works with no script: the cat page's
// History, a "That's a different cat" report, and "Move back". Only a
// sighting's number and the cat it is under travel in an address, never a
// position (K13).

export const MOVE_SCREEN = "/api/team/sightings/move";
export const MOVE_FORM = "/api/team/sightings/move/form";

export type MoveSource = "cat_page" | "matched_by_hand" | "report" | "game";

export interface MoveScreenAsk {
  /** The cat the sightings are filed under now: what the screen expects to find. */
  cat: number;
  sightings: readonly number[];
  /** The cat they go to, chosen already (Move back). */
  to?: number;
  /** "It's a new cat". */
  fresh?: boolean;
  source?: MoveSource;
  /** With `source: "report"`: the report's public id. */
  report?: string;
  /** The search box's words. */
  q?: string;
}

/** The screen's address for this ask (no `&amp;`: the caller escapes it where it draws it). */
export function moveHref(a: MoveScreenAsk): string {
  const p = new URLSearchParams();
  p.set("cat", String(a.cat));
  p.set("s", [...a.sightings].join(","));
  if (a.to !== undefined) p.set("to", String(a.to));
  if (a.fresh) p.set("new", "1");
  if (a.source && a.source !== "cat_page") p.set("source", a.source);
  if (a.report) p.set("report", a.report);
  if (a.q) p.set("q", a.q);
  return `${MOVE_SCREEN}?${p.toString()}`;
}
