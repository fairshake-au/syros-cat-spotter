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
});

export type Sighting = typeof sightingsTable.$inferSelect;
