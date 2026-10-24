import { inArray } from "drizzle-orm";
import { union } from "drizzle-orm/pg-core";
import {
  db,
  catsTable,
  vetBatchPhotosTable,
  vetVisitPhotosTable,
} from "@workspace/db";

// SYC-677: a vet visit's photos are the team's only (Global Constraints:
// "Kept batch photos are team-only"). The rule fails closed: a photo is
// team-only if it has ANY vet_batch_photos row (staged or saved batch) or a
// vet_visit_photos row, UNLESS it is some cat's primary photo. The one
// exception, a NEW cat's first photo, becomes that cat's public main photo,
// and so is a cat's primary_photo_id. Mirrored in SQL by lib/db standIn.ts.
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
  const linked = await union(
    q
      .select({ photoId: vetVisitPhotosTable.photoId })
      .from(vetVisitPhotosTable)
      .where(inArray(vetVisitPhotosTable.photoId, unique)),
    q
      .select({ photoId: vetBatchPhotosTable.photoId })
      .from(vetBatchPhotosTable)
      .where(inArray(vetBatchPhotosTable.photoId, unique)),
  );
  if (linked.length === 0) return new Set();
  const primary = await q
    .select({ photoId: catsTable.primaryPhotoId })
    .from(catsTable)
    .where(
      inArray(
        catsTable.primaryPhotoId,
        linked.map((r) => r.photoId),
      ),
    );
  const exempt = new Set(primary.map((r) => r.photoId));
  return new Set(linked.map((r) => r.photoId).filter((id) => !exempt.has(id)));
}
