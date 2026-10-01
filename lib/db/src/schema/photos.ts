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
    // application code, so every insert gets a value without the app having
    // to generate one (artifacts/api-server/src/routes/sightings.ts inserts
    // a photo row without specifying public_id). This is a deliberate
    // deviation from the spec's "base62, ~22 chars" format to a UUID,
    // originally made under SYC-102 (Replit's publish-time structural diff
    // couldn't run a custom backfill). Production migrations now go through
    // the `migrate` runner exclusively (SYC-121, post-Neon-move), which can
    // run arbitrary SQL — see migrations/0002_photos_public_id.sql for the
    // backfill-then-constrain shape that uses. The UUID-vs-base62 judgment
    // call itself stands (still 128 bits of randomness, still unguessable);
    // flagged to Samuel in PR #24, recommended to accept.
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
