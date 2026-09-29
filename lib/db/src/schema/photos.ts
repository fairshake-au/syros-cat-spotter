import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  serial,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const photosTable = pgTable(
  "photos",
  {
    id: serial("id").primaryKey(),
    // hosting-and-photo-storage.md §6.2 item 1 (SYC-98): the id served in
    // GET /api/photos/:publicId — never a sequential value, so the corpus
    // can't be walked. The integer `id` stays as the real primary key;
    // every internal foreign key (cats.primary_photo_id, sightings.photo_id)
    // keeps pointing at it.
    //
    // Generated with a DATABASE-side default (gen_random_uuid(), built into
    // Postgres core since v13 — no extension needed) rather than in
    // application code. This is a deliberate deviation from the spec's
    // "base62, ~22 chars" format to a UUID: SYC-102 found that Replit's
    // Publish step diffs dev and prod schemas and applies the difference
    // itself, independent of this repo's migration runner, and can't run a
    // custom backfill UPDATE or an app-level insert hook. A plain
    // `ADD COLUMN ... NOT NULL DEFAULT gen_random_uuid()::text` is the one
    // form of "existing rows get a value, new rows get a value" that is
    // correct whichever path applies it. See the PR body ("How this
    // reaches production on Replit") for the full reasoning and the
    // recommendation to Samuel.
    publicId: text("public_id")
      .notNull()
      .default(sql`gen_random_uuid()::text`),
    data: text("data").notNull(), // base64-encoded image
    mime: text("mime").notNull().default("image/jpeg"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("photos_public_id_unique").on(table.publicId)],
);

export type Photo = typeof photosTable.$inferSelect;
