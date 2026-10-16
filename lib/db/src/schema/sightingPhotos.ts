import { sql } from "drizzle-orm";
import {
  pgTable,
  integer,
  text,
  smallint,
  primaryKey,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sightingsTable } from "./sightings";
import { photosTable } from "./photos";

export const SIGHTING_PHOTO_ROLES = ["first", "face", "body"] as const;
export type SightingPhotoRole = (typeof SIGHTING_PHOTO_ROLES)[number];

/**
 * Every photo of a spot, in the order taken (SYC-415 spec §6.2): its first
 * photo, and optionally a face and a body photo. The cover photo (spec §5.1)
 * is also `sightings.photo_id`, which older readers keep using. No spotter
 * column, so deleting a person needs nothing here (cat-record-data-spine.md
 * §8.5). Both links cascade: sightings can't be deleted in production (the
 * append-only trigger) but test clean-up deletes them, and a photo deleted
 * for good (hosting-and-photo-storage.md §6.5) takes its row with it.
 */
export const sightingPhotosTable = pgTable(
  "sighting_photos",
  {
    sightingId: integer("sighting_id")
      .notNull()
      .references(() => sightingsTable.id, { onDelete: "cascade" }),
    photoId: integer("photo_id")
      .notNull()
      .references(() => photosTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    position: smallint("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sightingId, t.position] }),
    uniqueIndex("sighting_photos_role_uq").on(t.sightingId, t.role),
    uniqueIndex("sighting_photos_photo_uq").on(t.photoId),
    check("sighting_photos_role_ck", sql`${t.role} IN ('first','face','body')`),
    check("sighting_photos_position_ck", sql`${t.position} BETWEEN 1 AND 3`),
  ],
);

export type SightingPhoto = typeof sightingPhotosTable.$inferSelect;
