import { catsTable, db, photosTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { MAX_CANDIDATES } from "./candidateSelection";
import { validatePhotoBase64 } from "./imageValidation";
import { matchCatPhoto, type CandidateInput } from "./matching";
import { catDisplayPhotoIds } from "./photoVisibility";
import { makeVariant, variantFor } from "./photoVariants";
import { allTeamCats, type CatListFilters } from "./teamCatList";

// Find from a photo (SYC-396 PR 2.5; spec §5.2). The team narrows the search
// to an area or a colony, and the photo is compared with those cats in groups
// of up to 10 (the most the app's matching compares at once), then the best
// of every group are compared again together, so their scores rank against
// each other. The team always decides; this only says how close each one is.
//
// **Nothing is kept.** The photo is re-encoded (which drops EXIF and GPS),
// sent to the matching service, and forgotten: nothing is written to
// `photos`, `sightings` or `observations`. A candidate's reference photo is
// the one the public sees (never a hidden one), at its 640px medium size.

export const FIND_MAX_CATS = 30,
  FIND_GROUPS = 3,
  FIND_FINALISTS_PER_GROUP = 3;
export const VERY_LIKELY = 0.8,
  POSSIBLE = 0.5;
export type Band = "very_likely" | "possible" | "unlikely";
export const bandOf = (score: number): Band =>
  score >= VERY_LIKELY ? "very_likely" : score >= POSSIBLE ? "possible" : "unlikely";

export type FindFilters = Pick<CatListFilters, "area" | "colony" | "colours">;

/** `photoPublicId`: the reference photo it was compared with (its display photo). */
export type FindResult = { catId: number; score: number; band: Band; reasoning: string; photoPublicId: string };

type Candidate = CandidateInput & { photoPublicId: string };

/**
 * The plan's outcomes, plus three the route needs (PR 2.5 build):
 * `no_place` (no area or colony), `bad_photo` (the upload isn't a photo we
 * can read) and `refused` (the gate said no, e.g. a daily cap). None of them
 * calls the matching service.
 */
export type FindOutcome =
  | { kind: "no_place" }
  | { kind: "too_many"; count: number }
  | { kind: "none_to_compare" }
  | { kind: "bad_photo"; count: number }
  | { kind: "refused"; count: number; reason: string }
  | { kind: "not_a_cat"; count: number }
  | { kind: "matching_down"; count: number }
  | {
      kind: "results";
      count: number;
      compared: number;
      results: FindResult[];
      /**
       * The team's photo, for the results page only (SYC-491): a 640px JPEG
       * made from the RE-ENCODED photo, never the upload, so it carries no
       * EXIF or GPS. Base64. Kept nowhere; null if it couldn't be made.
       */
      preview: string | null;
    };

export interface FindOptions {
  /**
   * Runs once the narrowing and the photo have passed, and before any call to
   * the matching service: the daily caps. A string refuses the search with
   * that reason; null lets it run. Not called for a refused narrowing or an
   * unreadable photo, so those don't use up a search.
   */
  gate?: () => Promise<string | null>;
}

/** The active cats these filters leave, for the count ("34 cats to compare"). */
export async function catsToCompare(filters: FindFilters, now: Date = new Date()) {
  // Only the three narrowing filters; "Lives" stays at its default, so only
  // active cats (on the street, homed or in care) are compared (§9.5).
  const { cats } = await allTeamCats(
    { area: filters.area, colony: filters.colony, colours: filters.colours },
    now,
  );
  return cats;
}

export const hasPlace = (f: FindFilters): boolean => f.area !== undefined || f.colony !== undefined;

export async function findFromPhoto(
  photo: Buffer,
  filters: FindFilters,
  now: Date = new Date(),
  opts: FindOptions = {},
): Promise<FindOutcome> {
  // 1. Never without a place.
  if (!hasPlace(filters)) return { kind: "no_place" };

  // 2. The narrowed cats.
  const cats = await catsToCompare(filters, now);
  const count = cats.length;
  if (count > FIND_MAX_CATS) return { kind: "too_many", count };
  if (count === 0) return { kind: "none_to_compare" };

  // 3. The re-encoded photo is what gets sent, never the upload's own bytes:
  // the re-encode is what drops EXIF and GPS.
  const valid = await validatePhotoBase64(photo.toString("base64"));
  if ("error" in valid) return { kind: "bad_photo", count };

  const refusal = opts.gate ? await opts.gate() : null;
  if (refusal !== null) return { kind: "refused", count, reason: refusal };

  try {
    const sent = [{ role: "first" as const, photoBase64: valid.buffer.toString("base64"), mime: valid.mime }];
    const candidates = await referencePhotos(cats.map((c) => ({ id: c.id, name: c.name })));
    if (candidates.length === 0) return { kind: "none_to_compare" };

    // 4. Groups of up to 10, at most 3.
    const groups: Candidate[][] = [];
    for (let i = 0; i < candidates.length && groups.length < FIND_GROUPS; i += MAX_CANDIDATES) {
      groups.push(candidates.slice(i, i + MAX_CANDIDATES));
    }
    const byId = new Map(candidates.map((c) => [c.catId, c]));
    const finalists: { candidate: Candidate; score: number; reasoning: string }[] = [];
    for (const group of groups) {
      const out = await matchCatPhoto(sent, group.map(toInput));
      if (!out.isCatPhoto) return { kind: "not_a_cat", count };
      finalists.push(...best(out.matches, group, byId));
    }

    // 5. One final round with every group's best together, so the scores
    // rank against each other. With one group they already do, so that
    // round would only repeat it: never more than 4 calls, and one when one
    // will do.
    let results: FindResult[];
    if (groups.length === 1) {
      results = finalists.map((f) => result(f.candidate, f.score, f.reasoning));
    } else {
      // Only what the service needs: never the photo's public id.
      const out = await matchCatPhoto(sent, finalists.map((f) => toInput(f.candidate)));
      const scored = new Map(out.matches.map((m) => [m.catId, m]));
      results = finalists.map((f) => {
        const m = scored.get(f.candidate.catId);
        return result(f.candidate, m?.confidence ?? 0, m?.reasoning ?? "");
      });
    }
    results.sort((a, b) => b.score - a.score || a.catId - b.catId);
    const preview = await makeVariant(valid.buffer, "medium").then(
      (b) => b.toString("base64"),
      () => null,
    );
    return { kind: "results", count, compared: candidates.length, results, preview };
  } catch {
    // 6. Anything thrown (the service down, an answer we can't read).
    return { kind: "matching_down", count };
  }
}

function result(c: Candidate, score: number, reasoning: string): FindResult {
  return { catId: c.catId, score, band: bandOf(score), reasoning, photoPublicId: c.photoPublicId };
}

const toInput = ({ catId, name, photoBase64, mime }: Candidate): CandidateInput => ({ catId, name, photoBase64, mime });

/** A group's best few, by the model's score. A cat it left out scores 0. */
function best(
  matches: { catId: number; confidence: number; reasoning: string }[],
  group: Candidate[],
  byId: Map<number, Candidate>,
) {
  const inGroup = new Set(group.map((c) => c.catId));
  const scored = new Map<number, { confidence: number; reasoning: string }>();
  for (const m of matches) if (inGroup.has(m.catId) && !scored.has(m.catId)) scored.set(m.catId, m);
  return group
    .map((c) => ({
      candidate: byId.get(c.catId)!,
      score: scored.get(c.catId)?.confidence ?? 0,
      reasoning: scored.get(c.catId)?.reasoning ?? "",
    }))
    .sort((a, b) => b.score - a.score || a.candidate.catId - b.candidate.catId)
    .slice(0, FIND_FINALISTS_PER_GROUP);
}

/**
 * Each cat's reference photo: the one the public sees (`catDisplayPhotoIds`,
 * so never a hidden photo), at its medium size. A cat with no photo to show
 * can't be compared and is left out.
 */
async function referencePhotos(cats: { id: number; name: string }[]): Promise<Candidate[]> {
  const rows = await db
    .select({ id: catsTable.id, primaryPhotoId: catsTable.primaryPhotoId })
    .from(catsTable)
    .where(inArray(catsTable.id, cats.map((c) => c.id)));
  const shown = await catDisplayPhotoIds(rows);
  const shownIds = [...new Set([...shown.values()].filter((id): id is number => id !== null))];
  const publicIds = new Map(
    shownIds.length
      ? (
          await db
            .select({ id: photosTable.id, publicId: photosTable.publicId })
            .from(photosTable)
            .where(inArray(photosTable.id, shownIds))
        ).map((p) => [p.id, p.publicId])
      : [],
  );
  const out = await Promise.all(
    cats.map(async (c): Promise<Candidate | null> => {
      const photoId = shown.get(c.id) ?? null;
      const publicId = photoId === null ? undefined : publicIds.get(photoId);
      if (photoId === null || publicId === undefined) return null;
      const bytes = await variantFor(photoId, "medium");
      return bytes
        ? { catId: c.id, name: c.name, photoBase64: bytes.toString("base64"), mime: "image/jpeg", photoPublicId: publicId }
        : null;
    }),
  );
  return out.filter((c): c is Candidate => c !== null);
}
