import { inArray } from "drizzle-orm";
import { catsTable, db, photosTable } from "@workspace/db";
import { liveCats } from "./catIdentity";
import { loadCatRecords, type CoatColour, type CoatPattern, type Mark } from "./observations";
import {
  appearanceAuthorityLevel,
  resolveCoatParts,
  resolveMarkings,
  standingAboveTeam,
  type AppearanceCheckReason,
} from "./resolve";
import { handPickDisagrees, handPickedAmong } from "./handPick";
import { syrNumber, teamPhotoUrl } from "./teamCatView";

// The Colour check list (SYC-2 PR 3.1; coat-markings-and-health.md §5.3,
// §10.3). Read by GET /api/team/colour-check, as a page or as JSON, both
// through listColourCheck, so they can't disagree. Built like the Probably
// sterilised list (lib/likelyReview.ts).
//
// A cat is listed while any of the spec's conditions holds. All but one are
// the resolver's own `checkReasons` (lib/resolve.ts), so the list never has
// a second rule for which colour wins:
//
// - `no_authority`: the colour is the machine's alone, or not known, and no
//   team or cat guardian statement stands;
// - `spotters_over_machine`: two spotters overturned a real machine reading;
// - `tied_camps`: two groups of spotters disagree on the colours;
// - `pattern_tied_camps`: two groups of spotters disagree on the pattern
//   (SYC-398);
// - `mixed_sources`: the colours and the pattern come from different rules,
//   say the team's colours and the machine's pattern (SYC-398 Decision 2A);
// - `markings_reopened`: two spotters added a mark after the team's list;
// - `markings_changed_recently`: marks reached two voices in the last 30 days;
//
// and one worked out here, because it needs `sighting_matches`:
//
// - `hand_pick`: on a sighting the spotter matched by hand, the spotter's own
//   colour answer shares no colour with what the cat is resolved to, or
//   names a different pattern (both known). No
//   spotter answer, no flag; nothing calls the model. It clears when that
//   answer is marked wrong, or when a team or guardian statement made after
//   the answer decides the colour (the team has looked, as "Looks right" does
//   on the Likely list).
//
// "A few minutes a week" (§5.3): cats whose only reason is `no_authority`
// (never described by the team) are listed last, in one group the page
// collapses, so they never sit in the way of the cases that matter. Before
// SYC-161 reads colours, that group is most of the cat-alog.
//
// Team-only. Nothing here reaches a public payload.

export type ColourCheckReason = AppearanceCheckReason | "hand_pick";

export interface ColourCheckCat {
  catId: number;
  syr: string;
  name: string;
  /** The cat's main photo, through the team photo route. */
  photoUrl: string | null;
  /** What the cat's colours, pattern and markings resolve to now (null: not known). */
  coatColours: CoatColour[] | null;
  coatPattern: CoatPattern | null;
  markings: Mark[] | null;
  reasons: ColourCheckReason[];
  /**
   * The cat guardian statements a team Correct would mark wrong, per kind
   * (empty: none decides). The list warns before Correct overrules her.
   */
  above: { coat: number[]; markings: number[] };
  /** "check": a reason other than `no_authority`. "not_described": only that. */
  group: "check" | "not_described";
  /** The newest colour or markings statement on the cat, else when it was first recorded (ISO). */
  newestAt: string;
}

/** The order the reasons are shown in. */
export const REASON_ORDER: readonly ColourCheckReason[] = [
  "hand_pick",
  "spotters_over_machine",
  "tied_camps",
  "pattern_tied_camps",
  "mixed_sources",
  "markings_reopened",
  "markings_changed_recently",
  "no_authority",
];

/**
 * Every cat whose colour or markings deserve a second look, cats with a
 * reason other than `no_authority` first, newest first within each group.
 * A fixed number of queries whatever the catalogue's size.
 */
export async function listColourCheck(now = new Date()): Promise<ColourCheckCat[]> {
  const cats = await liveCats({
    id: catsTable.id,
    name: catsTable.name,
    createdAt: catsTable.createdAt,
    primaryPhotoId: catsTable.primaryPhotoId,
  });
  if (cats.length === 0) return [];

  const records = await loadCatRecords(cats.map((c) => c.id));

  const handPicked = await handPickedAmong([...records.values()].flatMap((r) => r.observations));

  const photoIds = [...new Set(cats.map((c) => c.primaryPhotoId).filter((id): id is number => id != null))];
  const photos =
    photoIds.length === 0
      ? []
      : await db
          .select({ id: photosTable.id, publicId: photosTable.publicId })
          .from(photosTable)
          .where(inArray(photosTable.id, photoIds));
  const publicIdOf = new Map(photos.map((p) => [p.id, p.publicId]));

  const listed: ColourCheckCat[] = [];
  for (const cat of cats) {
    const observations = records.get(cat.id)?.observations ?? [];
    const coat = resolveCoatParts(observations, appearanceAuthorityLevel);
    const markings = resolveMarkings(observations, now, appearanceAuthorityLevel);
    // Each part has its own reasons (SYC-398 §4); the cat's are their union.
    const found = new Set<ColourCheckReason>([
      ...coat.colours.checkReasons,
      ...coat.pattern.checkReasons,
      ...markings.checkReasons,
    ]);
    if (handPickDisagrees(observations, coat, handPicked)) found.add("hand_pick");
    if (found.size === 0) continue;

    const reasons = REASON_ORDER.filter((r) => found.has(r));
    const appearanceRows = observations.filter((o) => o.kind === "coat" || o.kind === "markings");
    const newest = appearanceRows.reduce(
      (t, o) => Math.max(t, o.createdAt.getTime()),
      cat.createdAt.getTime(),
    );
    const publicId = cat.primaryPhotoId == null ? undefined : publicIdOf.get(cat.primaryPhotoId);
    listed.push({
      catId: cat.id,
      syr: syrNumber(cat.id),
      name: cat.name,
      photoUrl: publicId ? teamPhotoUrl(publicId) : null,
      coatColours: coat.colours.value,
      coatPattern: coat.pattern.value,
      markings: markings.value,
      above: {
        coat: standingAboveTeam(observations, "coat").map((o) => o.id),
        markings: standingAboveTeam(observations, "markings").map((o) => o.id),
      },
      reasons,
      group: reasons.some((r) => r !== "no_authority") ? "check" : "not_described",
      newestAt: new Date(newest).toISOString(),
    });
  }

  listed.sort(
    (a, b) =>
      Number(a.group === "not_described") - Number(b.group === "not_described") ||
      Date.parse(b.newestAt) - Date.parse(a.newestAt) ||
      b.catId - a.catId,
  );
  return listed;
}
