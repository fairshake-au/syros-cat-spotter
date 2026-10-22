import { sql } from "drizzle-orm";
import { check, integer, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { photosTable } from "./photos";

/**
 * The looks-like index (SYC-527 piece 3; spec
 * docs/specs/find-from-a-photo-whole-island.md §6.1–§6.2): one fingerprint
 * per photo, a list of 384 numbers scaled to length 1, so how alike two
 * photos look is a plain dot product, ranked by the server.
 *
 * It holds no cat id. Which photo shows each cat is worked out on every
 * search by the existing rule (catDisplayPhotoIds), so the index can never
 * disagree with what the public sees.
 *
 * **A hidden or removed photo has no row here, ever.** Two triggers in
 * migration 0039 (the schema code can't express triggers) delete the row in
 * the same transaction as the hide or the removal, after locking the photo
 * row. The only writer, saveFingerprint (api-server lib/fingerprint), takes
 * the same lock and re-checks first; a source test bans any other writer.
 * Deleting a photo row deletes its fingerprint (the cascade).
 */
export const photoFingerprintsTable = pgTable(
  "photo_fingerprints",
  {
    photoId: integer("photo_id")
      .primaryKey()
      .references(() => photosTable.id, { onDelete: "cascade" }),
    /** Which model made it. A fingerprint from another model is ignored. */
    model: text("model").notNull(),
    vector: real("vector").array().notNull(),
    madeAt: timestamp("made_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One flat list of exactly 384. cardinality, not array_length: an empty
    // list has array_length null, which a check would let through; and
    // array_ndims, so a 2-by-192 grid can't pass as 384.
    check(
      "photo_fingerprints_vector_len_ck",
      sql`array_ndims(${t.vector}) = 1 and cardinality(${t.vector}) = 384`,
    ),
  ],
);

export type PhotoFingerprint = typeof photoFingerprintsTable.$inferSelect;
