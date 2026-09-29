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
  // the cat keeps its history (cat-record-data-spine.md §8.5). These columns
  // record that it happened. Clearing deviceId, which is NOT NULL, still needs
  // its own migration in the deletion work (SYC-63), as does an append-only
  // guard on sightings, which the app updates today (status, catId).
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
  redactionReason: text("redaction_reason"),
});

export type Sighting = typeof sightingsTable.$inferSelect;
