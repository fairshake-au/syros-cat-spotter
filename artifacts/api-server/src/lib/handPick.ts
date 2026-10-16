import { and, eq, inArray } from "drizzle-orm";
import { db, sightingMatchesTable, type Observation } from "@workspace/db";
import { normaliseColours, type CoatColour } from "./observations";
import {
  appearanceAuthorityLevel,
  standingAppearanceRows,
  type AppearanceResolved,
} from "./resolve";

// The Colour check list's hand-pick reason (SYC-2 PR 3.1; spec §5.3,
// choose-a-different-cat.md §4.3): the cat a spotter chose by hand is
// resolved to colours that share none with that spotter's own colour answer
// on that sighting. Team-only: the spotter sees nothing different. Read by
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
 * answer shares no colour with the cat's resolved colour? Compared with the
 * resolved colour, never the machine's reading on its own.
 *
 * - No spotter answer, or a "Not sure", gives no flag.
 * - It clears when that answer is marked wrong (it no longer stands), or
 *   when any standing team or guardian statement on the colour was recorded
 *   after the answer: the team has looked. Any, not only the one that
 *   decides: on a cat guardian's cat, a team Confirm made after the answer
 *   is the team looking, though her older statement still decides.
 */
export function handPickDisagrees(
  observations: readonly Observation[],
  coat: AppearanceResolved<CoatColour[]>,
  handPickedSightings: ReadonlySet<number>,
): boolean {
  const resolved: readonly string[] = coat.value ?? [];
  if (resolved.length === 0) return false;
  const standing = standingAppearanceRows(observations, "coat", false, appearanceAuthorityLevel);
  const lookedAt = standing
    .filter((o) => o.provenance !== "machine" && appearanceAuthorityLevel(o) > 0)
    .reduce((t, o) => Math.max(t, o.createdAt.getTime()), -Infinity);
  return standing.some((o) => {
    if (o.roleAtTime !== "public" || o.sightingId == null) return false;
    if (!handPickedSightings.has(o.sightingId)) return false;
    const raw = (o.value as { colours?: unknown } | null)?.colours;
    if (!Array.isArray(raw)) return false;
    const said = normaliseColours(raw as string[]).filter((c) => c !== "not_sure");
    if (said.length === 0) return false;
    if (lookedAt > o.createdAt.getTime()) return false;
    return !said.some((c) => resolved.includes(c));
  });
}
