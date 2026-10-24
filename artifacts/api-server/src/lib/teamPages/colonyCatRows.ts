import type { ColonyCat } from "../teamColonies";
import type { SterilisedMark, TeamCat } from "../teamCatList";

// A colony's cats as its page lists them (SYC-619 spec §7.2, Decision D3):
// each with its sterilisation mark and when it was last seen, in the order of
// the trapping planner's to-do list (redesign §9.2), so the planner can
// replace this list later without reshuffling it. Never a place or position.

/**
 * One cat's row. `mark` and `lastSeenAt` are null for a record the colony
 * lists but `loadTeamCats` leaves out (a merged-away half): it keeps its row,
 * with no mark line.
 */
export type ColonyCatRow = ColonyCat & { mark: SterilisedMark | null; lastSeenAt: Date | null };

/** The planner's groups: not done first. A cat with no mark goes last. */
const GROUP: Record<SterilisedMark, number> = {
  not_sterilised: 0,
  not_known: 1,
  probably: 2,
  sterilised: 3,
};
const groupOf = (m: SterilisedMark | null) => (m === null ? 4 : GROUP[m]);

/**
 * Not sterilised, not known, probably, sterilised, then no mark. Within each,
 * the most recently seen first (they're likeliest to turn up), never seen
 * last, then by name. A new array; the one given is left alone.
 */
export function sortForPlanner(rows: readonly ColonyCatRow[]): ColonyCatRow[] {
  return [...rows].sort(
    (a, b) =>
      groupOf(a.mark) - groupOf(b.mark) ||
      (b.lastSeenAt?.getTime() ?? -Infinity) - (a.lastSeenAt?.getTime() ?? -Infinity) ||
      a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
      a.id - b.id,
  );
}

/** The colony's cats joined on id to every cat `loadTeamCats` gave, sorted for the planner. */
export function colonyCatRows(
  cats: readonly ColonyCat[],
  teamCats: ReadonlyArray<Pick<TeamCat, "id" | "mark" | "lastSeenAt">>,
): ColonyCatRow[] {
  const byId = new Map(teamCats.map((c) => [c.id, c]));
  return sortForPlanner(
    cats.map((c) => {
      const t = byId.get(c.id);
      return { ...c, mark: t?.mark ?? null, lastSeenAt: t?.lastSeenAt ?? null };
    }),
  );
}
