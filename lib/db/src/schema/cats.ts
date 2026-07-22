import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  serial,
  integer,
  doublePrecision,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const catsTable = pgTable(
  "cats",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    primaryPhotoId: integer("primary_photo_id").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    discovererDeviceId: text("discoverer_device_id").notNull(),
    ownerDeviceId: text("owner_device_id"),
    ownerName: text("owner_name"),
    homeDescription: text("home_description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Case-insensitive uniqueness for cat names across the catalog.
    uniqueIndex("cats_name_lower_unique").on(sql`lower(${table.name})`),
  ],
);

export type Cat = typeof catsTable.$inferSelect;
