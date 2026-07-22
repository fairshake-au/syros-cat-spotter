import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const profilesTable = pgTable(
  "profiles",
  {
    deviceId: text("device_id").primaryKey(),
    // Unique public username chosen at first launch (case-insensitive unique).
    username: text("username"),
    nickname: text("nickname"),
    points: integer("points").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("profiles_username_lower_idx").on(sql`lower(${t.username})`),
  ],
);

export type Profile = typeof profilesTable.$inferSelect;
