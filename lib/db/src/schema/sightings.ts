import {
  pgTable,
  text,
  serial,
  integer,
  doublePrecision,
  timestamp,
} from "drizzle-orm/pg-core";

export const sightingsTable = pgTable("sightings", {
  id: serial("id").primaryKey(),
  catId: integer("cat_id"), // null until resolved
  deviceId: text("device_id").notNull(),
  photoId: integer("photo_id").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  status: text("status").notNull().default("pending"), // pending | resolved
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Deletion unlinks a sighting from its spotter rather than removing it, so
  // the cat keeps its history (cat-record-data-spine.md §8.5). How deviceId is
  // cleared is the deletion work's (SYC-63); this column exists now so that
  // work needs no migration across a season of sightings.
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
  redactionReason: text("redaction_reason"),
});

export type Sighting = typeof sightingsTable.$inferSelect;
