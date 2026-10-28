import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  serial,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";

export const sightingsTable = pgTable(
  "sightings",
  {
    id: serial("id").primaryKey(),
    catId: integer("cat_id"), // null until resolved
    // Null only once deletion has unlinked the spotter (SYC-63); the check
    // below refuses a null on a row that isn't stamped as redacted.
    deviceId: text("device_id"),
    photoId: integer("photo_id").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    // pending | awaiting_team | resolved. A trigger in the migration allows
    // only pending -> resolved, pending -> awaiting_team, awaiting_team ->
    // resolved, the place stamp, redaction, and (0054) a recorded move of a
    // resolved sighting's cat; nothing else updates or deletes a sighting.
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Deletion unlinks a sighting from its spotter rather than removing it, so
    // the cat keeps its history (cat-record-data-spine.md §8.5). These columns
    // record that it happened, and deviceId is cleared in the same statement.
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
    redactionReason: text("redaction_reason"),
    // Where the spot is, stamped when it resolves. Null = not yet stamped;
    // 'off' = in no named area. onIsland is whether it is on Syros at all.
    areaKey: text("area_key"),
    onIsland: boolean("on_island"),
  },
  (t) => [
    // Deletion finds a person's sightings synchronously, while they wait.
    index("sightings_device_idx")
      .on(t.deviceId)
      .where(sql`${t.deviceId} is not null`),
    // A merge's scan of the merged-away cat's sightings, and the deferred
    // check that none is left on it (which-cat-is-which.md §9.2).
    index("sightings_cat_idx")
      .on(t.catId)
      .where(sql`${t.catId} is not null`),
    check(
      "sightings_attribution_ck",
      sql`${t.deviceId} is not null or ${t.redactedAt} is not null`,
    ),
  ],
);

export type Sighting = typeof sightingsTable.$inferSelect;
