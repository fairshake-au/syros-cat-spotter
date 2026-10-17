import { and, eq, inArray } from "drizzle-orm";
import { db, sightingMatchesTable, type Observation } from "@workspace/db";
import { readCoatValue, type CoatColour, type CoatPattern } from "./appearance";
import {
  appearanceAuthorityLevel,
  standingAppearanceRows,
  type AppearanceResolved,
} from "./resolve";

// The Colour check list's hand-pick reason (SYC-2 PR 3.1; spec §5.3,
// choose-a-different-cat.md §4.3): the cat a spotter chose by hand is
// resolved to colours that share none with that spotter's own colour answer
// on that sighting, or to a different pattern (SYC-398 §9). Team-only: the spotter sees nothing different. Read by
// the Colour check list (lib/colourCheck.ts) and the team cat page
// (lib/teamCatView.ts).

/** Of the sightings these colour answers came from, the ones matched by hand. */
export async function handPickedAmong(observations: readonly Observation[]): Promise<Set<number>> {
  const sightingIds = [
    ...new Set(
      observations
        .filter((o) => o.kind === "coat" && o.roleAtTime === "public" && o.sightingId != null)
        .map((o) => o.sightingId!),
    ),
  ];
  if (sightingIds.length === 0) return new Set();
  const rows = await db
    .select({ sightingId: sightingMatchesTable.sightingId })
    .from(sightingMatchesTable)
    .where(
      and(
        inArray(sightingMatchesTable.sightingId, sightingIds),
        eq(sightingMatchesTable.choice, "hand_pick"),
      ),
    );
  return new Set(rows.map((r) => r.sightingId));
}

/**
 * Is there a sighting matched by hand whose spotter's own standing colour
 * answer shares no colour with the cat's resolved colours, or names a
 * pattern other than the cat's resolved pattern (both known)? The answer is
 * read through the one translation (`readCoatValue`), so an old "Black and
 * white" is black and white. Compared with the resolved coat, never the
 * machine's reading on its own.
 *
 * - No spotter answer, or a "Not sure", gives no flag. A part either side
 *   doesn't know gives no flag on that part.
 * - It clears when that answer is marked wrong (it no longer stands), or
 *   when any standing team or guardian statement on the colour was recorded
 *   after the answer: the team has looked. Any, not only the one that
 *   decides: on a cat guardian's cat, a team Confirm made after the answer
 *   is the team looking, though her older statement still decides.
 */
export function handPickDisagrees(
  observations: readonly Observation[],
  coat: { colours: AppearanceResolved<CoatColour[]>; pattern: AppearanceResolved<CoatPattern | null> },
  handPickedSightings: ReadonlySet<number>,
): boolean {
  const resolved: readonly CoatColour[] = coat.colours.value ?? [];
  const resolvedPattern = coat.pattern.value;
  if (resolved.length === 0 && resolvedPattern === null) return false;
  const standing = standingAppearanceRows(observations, "coat", false, appearanceAuthorityLevel);
  const lookedAt = standing
    .filter((o) => o.provenance !== "machine" && appearanceAuthorityLevel(o) > 0)
    .reduce((t, o) => Math.max(t, o.createdAt.getTime()), -Infinity);
  return standing.some((o) => {
    if (o.roleAtTime !== "public" || o.sightingId == null) return false;
    if (!handPickedSightings.has(o.sightingId)) return false;
    const said = readCoatValue(o.value);
    if (!said || said.notSure) return false;
    if (lookedAt > o.createdAt.getTime()) return false;
    const coloursClash =
      said.colours !== null && resolved.length > 0 && !said.colours.some((c) => resolved.includes(c));
    const patternClash = said.pattern !== null && resolvedPattern !== null && said.pattern !== resolvedPattern;
    return coloursClash || patternClash;
  });
}
