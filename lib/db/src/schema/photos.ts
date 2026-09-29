import { pgTable, text, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const photosTable = pgTable(
  "photos",
  {
    id: serial("id").primaryKey(),
    // hosting-and-photo-storage.md §6.2 item 1 (SYC-98): the id served in
    // GET /api/photos/:publicId. 128-bit random, base62, ~22 chars, minted
    // in application code on insert (see lib/photoIds.ts) — never a
    // sequential value, so the corpus can't be walked. The integer `id`
    // stays as the real primary key; every internal foreign key
    // (cats.primary_photo_id, sightings.photo_id) keeps pointing at it.
    publicId: text("public_id").notNull(),
    data: text("data").notNull(), // base64-encoded image
    mime: text("mime").notNull().default("image/jpeg"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("photos_public_id_unique").on(table.publicId)],
);

export type Photo = typeof photosTable.$inferSelect;
