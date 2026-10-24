import { and, eq, inArray, isNull } from "drizzle-orm";
import { union } from "drizzle-orm/pg-core";
import {
  db,
  vetBatchCatsTable,
  vetBatchesTable,
  vetBatchPhotosTable,
  vetVisitPhotosTable,
} from "@workspace/db";

// SYC-677: a vet visit's photos are the team's only (Global Constraints:
// "Kept batch photos are team-only"). A photo is team-only while it is
//  - kept by a saved visit (a vet_visit_photos row), or
//  - staged in a batch that isn't saved yet (a vet_batch_photos row whose
//    batch has no saved_at).
// The one exception, a NEW cat's first photo, becomes its public main photo:
// saving doesn't link it in vet_visit_photos, and its batch is saved, so it
// has neither.
//
// hiddenPhotoIds (photoVisibility.ts) counts every team-only photo as hidden,
// the way it counts a removed one, so every public reader and every "hidden
// photo" refusal on the team routes covers it with no reader of its own. The
// team, who hold hide_photo, still see it through the team photo route.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The global pool, or a transaction: inside one, every read goes through it. */
type Queryable = typeof db | Tx;

/** Which of `ids` are team-only. One query (vet_batch_photos is indexed by photo_id). */
export async function teamOnlyPhotoIds(
  ids: readonly number[],
  q: Queryable = db,
): Promise<Set<number>> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return new Set();
  const rows = await union(
    q
      .select({ photoId: vetVisitPhotosTable.photoId })
      .from(vetVisitPhotosTable)
      .where(inArray(vetVisitPhotosTable.photoId, unique)),
    q
      .select({ photoId: vetBatchPhotosTable.photoId })
      .from(vetBatchPhotosTable)
      .innerJoin(vetBatchCatsTable, eq(vetBatchCatsTable.id, vetBatchPhotosTable.batchCatId))
      .innerJoin(vetBatchesTable, eq(vetBatchesTable.id, vetBatchCatsTable.batchId))
      .where(and(inArray(vetBatchPhotosTable.photoId, unique), isNull(vetBatchesTable.savedAt))),
  );
  return new Set(rows.map((r) => r.photoId));
}
