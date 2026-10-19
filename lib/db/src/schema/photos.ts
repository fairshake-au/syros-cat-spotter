import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  text,
  serial,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// people.ts doesn't import this file; the reference below is lazy anyway.
import { peopleTable } from "./people";

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
    // Base64-encoded image. Null only once the photo is removed for good
    // (SYC-462 spec §4.1; hosting-and-photo-storage.md §6.5: "null the bytes
    // and mark it removed"). photos_removed_ck ties the two together.
    data: text("data"),
    mime: text("mime").notNull().default("image/jpeg"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // SYC-462 spec §4.1: who removed it, when, and the request it answered (a
    // reference only: SYC-<n> or "hello YYYY-MM-DD #<n>", never personal
    // data). The row stays, so every link to it survives. A removed photo
    // can't be restored: migration 0034's trigger on photo_visibility_events.
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => peopleTable.id),
    removedReason: text("removed_reason"),
  },
  (table) => [
    uniqueIndex("photos_public_id_unique").on(table.publicId),
    check(
      "photos_removed_ck",
      sql`(${table.removedAt} is null and ${table.removedBy} is null and ${table.removedReason} is null and ${table.data} is not null) or (${table.removedAt} is not null and ${table.removedBy} is not null and ${table.removedReason} is not null and ${table.data} is null)`,
    ),
  ],
);

export type Photo = typeof photosTable.$inferSelect;
