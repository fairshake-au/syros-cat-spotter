import { asc, eq } from "drizzle-orm";
import { db, photosTable, vetBatchCatsTable, vetBatchPhotosTable } from "@workspace/db";
import { logger, safeError } from "./logger";
import { checkBatchFindLimits } from "../middlewares/rateLimit";
import { findFromPhoto, type FindFilters, type FindOutcome, type FindResult } from "./findFromPhoto";
import { BatchSavedError, getBatch, setSuggestions } from "./vetBatches";

// Matching a batch cat by photo (SYC-677 Task 5). The cat's first staged photo
// is compared with the cats in the chosen place, with the batch's own daily
// limits (60 a person, 200 for the team), counted apart from the single-photo
// page's. A found match list is kept on the batch cat so the page can show it
// again; only the ranking is kept (cat, score, band, reasoning and the public
// reference photo id), never the photo's bytes and never a position.

export type BatchScope = "batch" | "island" | { colonyId: number } | { areaKey: string };

const NOTHING_TO_SEARCH: FindOutcome = { kind: "bad_photo", count: 0 };

function filtersFor(scope: BatchScope, shared: { colonyId: number | null; areaKey: string | null }): FindFilters {
  if (scope === "island") return {};
  if (scope === "batch") {
    if (shared.colonyId !== null) return { colony: shared.colonyId };
    if (shared.areaKey !== null) return { area: shared.areaKey };
    return {};
  }
  if ("colonyId" in scope) return { colony: scope.colonyId };
  return { area: scope.areaKey };
}

/** Only what the page needs from a result; the score is rounded so no precise number is kept. */
const tidy = (r: FindResult): FindResult => ({
  catId: r.catId,
  score: Math.round(r.score * 100) / 100,
  band: r.band,
  reasoning: r.reasoning.slice(0, 300),
  photoPublicId: r.photoPublicId,
});

export async function searchBatchCat(
  person: { id: string },
  batchCatId: number,
  scope: BatchScope,
  now: Date = new Date(),
): Promise<FindOutcome> {
  const [cat] = await db
    .select({ batchId: vetBatchCatsTable.batchId })
    .from(vetBatchCatsTable)
    .where(eq(vetBatchCatsTable.id, batchCatId));
  if (!cat) return NOTHING_TO_SEARCH;
  const batch = await getBatch(cat.batchId);
  if (!batch) return NOTHING_TO_SEARCH;
  // A saved batch can't change: refuse before the gate, so no search is spent.
  if (batch.savedAt) throw new BatchSavedError();
  const [first] = await db
    .select({ data: photosTable.data })
    .from(vetBatchPhotosTable)
    .innerJoin(photosTable, eq(photosTable.id, vetBatchPhotosTable.photoId))
    .where(eq(vetBatchPhotosTable.batchCatId, batchCatId))
    .orderBy(asc(vetBatchPhotosTable.position), asc(vetBatchPhotosTable.id))
    .limit(1);
  if (!first?.data) return NOTHING_TO_SEARCH;

  const outcome = await findFromPhoto(Buffer.from(first.data, "base64"), filtersFor(scope, batch.shared), now, {
    gate: async () => {
      try {
        const limit = await checkBatchFindLimits(person.id, now.getTime());
        return limit === "ok" ? null : limit;
      } catch (err) {
        // Fails closed, with the page and words, never the app's JSON 500
        // (the same as the single-photo page, review finding 1).
        logger.warn({ err: safeError(err) }, "vet batch find: the daily count failed");
        return "counter_down";
      }
    },
  });
  if (outcome.kind === "results") await setSuggestions(batchCatId, outcome.results.map(tidy));
  return outcome;
}
