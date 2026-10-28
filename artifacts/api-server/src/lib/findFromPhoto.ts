import { catsTable, db, photosTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { liveCats } from "./catIdentity";
import { MAX_CANDIDATES } from "./candidateSelection";
import { fillMissing, fingerprintsFor, rank } from "./fingerprint";
import { fingerprintOf } from "./fingerprint/model";
import { logger, safeError } from "./logger";
import { validatePhotoBase64 } from "./imageValidation";
import { matchCatPhoto, type CandidateInput } from "./matching";
import { catDisplayPhotoIds } from "./photoVisibility";
import { makeVariant, variantFor } from "./photoVariants";
import { allTeamCats, type CatListFilters } from "./teamCatList";

// Find from a photo (SYC-396 PR 2.5; spec §5.2). The team narrows the search
// to an area or a colony (or, with neither, the whole island: SYC-527 piece 1),
// and the photo is compared with those cats in groups of up to 10 (the most
// the app's matching compares at once), then the best of every group are
// compared again together, so their scores rank against each other. The team
// always decides; this only says how close each one is.
//
// SYC-527 piece 3 (spec docs/specs/find-from-a-photo-whole-island.md §3):
// with 30 cats (with a display photo) or fewer, every cat is compared. With
// more, the photo's fingerprint is made in memory, the closest
// FIND_SHORTLIST_K cats are picked by their photos' fingerprints, and only
// those are read and compared.
//
// **Nothing is kept.** The photo is re-encoded (which drops EXIF and GPS),
// sent to the matching service, and forgotten: nothing is written to
// `photos`, `sightings` or `observations`. A candidate's reference photo is
// the one the public sees (never a hidden one), at its 640px medium size.

export const FIND_MAX_CATS = 30,
  FIND_GROUPS = 3,
  FIND_FINALISTS_PER_GROUP = 3;
/** Spec §3 step 5.3 and §8: the cats kept from the ranking (DINOv2 small). */
export const FIND_SHORTLIST_K = 20;
/** Spec §7: how long a search may spend making missing fingerprints. */
export const FIND_FILL_BUDGET_MS = 15_000;
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
 * The plan's outcomes, plus two the route needs (PR 2.5 build):
 * `bad_photo` (the upload isn't a photo we can read) and `refused` (the gate
 * said no, e.g. a daily cap). Neither calls the matching service.
 */
export type FindOutcome =
  | { kind: "none_to_compare" }
  /** Cats to compare, but none has a photo the public can see (review finding 2). Uses no search. */
  | { kind: "no_photos"; count: number }
  | { kind: "bad_photo"; count: number }
  | { kind: "refused"; count: number; reason: string }
  | { kind: "not_a_cat"; count: number }
  | { kind: "matching_down"; count: number }
  /** Over 30 cats and the looks-like index can't run (spec §9.4). Uses no search. */
  | { kind: "index_down"; count: number }
  | {
      kind: "results";
      count: number;
      compared: number;
      /** `{ of: N }` when the shortlist was used (N cats with a display photo); null when every cat was compared. */
      shortlist: { of: number } | null;
      /** Shortlist-path cats whose display photo still has no fingerprint after the fill (spec §7). 0 otherwise. */
      leftOut: number;
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

/** No area and no colony: the search covers the whole island (SYC-527 piece 1). */
export const isWholeIsland = (f: FindFilters): boolean => f.area === undefined && f.colony === undefined;

/** Each cat's display photo id (the one the public sees); a cat with none is absent. */
export async function displayPhotoOf(catIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (catIds.length === 0) return out;
  const rows = await liveCats(
    { id: catsTable.id, primaryPhotoId: catsTable.primaryPhotoId },
    { where: inArray(catsTable.id, catIds) },
  );
  for (const [catId, photoId] of await catDisplayPhotoIds(rows)) if (photoId !== null) out.set(catId, photoId);
  return out;
}

/**
 * How many cats the search compares: the narrowed cats that have a display
 * photo (spec §3 step 3.3). The form's count line and the threshold use this.
 */
export async function comparableCount(filters: FindFilters, now: Date = new Date()): Promise<number> {
  const cats = await catsToCompare(filters, now);
  return (await displayPhotoOf(cats.map((c) => c.id))).size;
}

interface SearchStats {
  path?: "all" | "shortlist";
  cats: number;
  made: number;
  leftOut: number;
  fillMs: number;
}

export async function findFromPhoto(
  photo: Buffer,
  filters: FindFilters,
  now: Date = new Date(),
  opts: FindOptions = {},
): Promise<FindOutcome> {
  const stats: SearchStats = { cats: 0, made: 0, leftOut: 0, fillMs: 0 };
  try {
    return await search(photo, filters, now, opts, stats);
  } finally {
    // Spec §10: counts and timings only. Never an id, a vector or the photo.
    if (stats.path) {
      logger.info(
        { path: stats.path, cats: stats.cats, made: stats.made, leftOut: stats.leftOut, fillMs: stats.fillMs },
        "find from a photo: path",
      );
    }
  }
}

async function search(
  photo: Buffer,
  filters: FindFilters,
  now: Date,
  opts: FindOptions,
  stats: SearchStats,
): Promise<FindOutcome> {
  // 1. The narrowed cats. With no area and no colony that is the whole island.
  const cats = await catsToCompare(filters, now);
  const count = cats.length;
  if (count === 0) return { kind: "none_to_compare" };

  // 2. The re-encoded photo is what gets sent, never the upload's own bytes:
  // the re-encode is what drops EXIF and GPS.
  const valid = await validatePhotoBase64(photo.toString("base64"));
  if ("error" in valid) return { kind: "bad_photo", count };

  // 3. "The number of cats" is cats with a display photo (spec §3 step 3.3).
  let shown: Map<number, number>;
  try {
    shown = await displayPhotoOf(cats.map((c) => c.id));
  } catch {
    return { kind: "matching_down", count };
  }
  const withPhoto = cats.filter((c) => shown.has(c.id));
  const comparable = withPhoto.length;
  if (comparable === 0) return { kind: "no_photos", count };
  stats.cats = comparable;

  let toRead = cats.map((c) => ({ id: c.id, name: c.name }));
  let shortlist: { of: number } | null = null;
  let leftOut = 0;

  if (comparable <= FIND_MAX_CATS) {
    // 4. #252's path, untouched: every cat is compared.
    stats.path = "all";
  } else {
    // 5. More than 30: the shortlist. Nothing here uses up a search.
    stats.path = "shortlist";
    const displayIds = withPhoto.map((c) => shown.get(c.id)!);
    try {
      // 5.1 The team's photo's fingerprint, in memory only, made from the
      // validated, re-encoded photo (medium size, as the cats' are).
      const query = await fingerprintOf(await makeVariant(valid.buffer, "medium"));
      // 5.2 Any fingerprints still missing for those cats' display photos.
      const fillStart = Date.now();
      const filled = await fillMissing(displayIds, FIND_FILL_BUDGET_MS);
      stats.made = filled.made;
      stats.fillMs = Date.now() - fillStart;
      // 5.3 The closest, by their photos' fingerprints.
      const have = await fingerprintsFor(displayIds);
      leftOut = withPhoto.filter((c) => !have.has(shown.get(c.id)!)).length;
      stats.leftOut = leftOut;
      if (have.size === 0) return { kind: "index_down", count };
      // Every ranked photo, closest first; the K cats are taken from the front
      // (two cats can share one display photo, so K photos could be fewer cats).
      const order = rank(query, have, have.size);
      const catsByPhoto = new Map<number, { id: number; name: string }[]>();
      for (const c of withPhoto) {
        const list = catsByPhoto.get(shown.get(c.id)!) ?? [];
        list.push({ id: c.id, name: c.name });
        catsByPhoto.set(shown.get(c.id)!, list);
      }
      toRead = [];
      for (const photoId of order) {
        for (const c of catsByPhoto.get(photoId) ?? []) if (toRead.length < FIND_SHORTLIST_K) toRead.push(c);
      }
    } catch (err) {
      logger.warn({ err: safeError(err) }, "find from a photo: the looks-like index could not run");
      return { kind: "index_down", count };
    }
    shortlist = { of: comparable };
  }

  // Each cat's reference photo, BEFORE the caps: a colony whose cats have no
  // photo to compare with must not use up a search (review finding 2).
  let candidates: Candidate[];
  try {
    candidates = await referencePhotos(toRead);
  } catch {
    return { kind: "matching_down", count };
  }
  if (candidates.length === 0) return { kind: "no_photos", count };

  const refusal = opts.gate ? await opts.gate() : null;
  if (refusal !== null) return { kind: "refused", count, reason: refusal };

  try {
    const sent = [{ role: "first" as const, photoBase64: valid.buffer.toString("base64"), mime: valid.mime }];

    // 3. Groups of up to 10, at most 3.
    const groups: Candidate[][] = [];
    for (let i = 0; i < candidates.length && groups.length < FIND_GROUPS; i += MAX_CANDIDATES) {
      groups.push(candidates.slice(i, i + MAX_CANDIDATES));
    }
    const byId = new Map(candidates.map((c) => [c.catId, c]));
    const finalists: { candidate: Candidate; score: number; reasoning: string }[] = [];
    for (const [i, group] of groups.entries()) {
      const out = await matchCatPhoto(sent, group.map(toInput), "find_from_photo");
      // Only the first group decides "not a cat": it stops before any more
      // calls, and one later group's odd answer can't throw away a real
      // cat photo after the calls are paid for (review finding 5).
      if (i === 0 && !out.isCatPhoto) return { kind: "not_a_cat", count };
      finalists.push(...best(out.matches, group, byId));
    }

    // 4. One final round with every group's best together, so the scores
    // rank against each other. With one group they already do, so that
    // round would only repeat it: never more than 4 calls, and one when one
    // will do.
    let results: FindResult[];
    if (groups.length === 1) {
      results = finalists.map((f) => result(f.candidate, f.score, f.reasoning));
    } else {
      // Only what the service needs: never the photo's public id.
      const out = await matchCatPhoto(sent, finalists.map((f) => toInput(f.candidate)), "find_from_photo");
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
    return { kind: "results", count, compared: candidates.length, shortlist, leftOut, results, preview };
  } catch {
    // 5. Anything thrown (the service down, an answer we can't read).
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
  const rows = await liveCats(
    { id: catsTable.id, primaryPhotoId: catsTable.primaryPhotoId },
    { where: inArray(catsTable.id, cats.map((c) => c.id)) },
  );
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
