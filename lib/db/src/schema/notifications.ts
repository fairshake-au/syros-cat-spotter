import {
  pgTable,
  pgEnum,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  date,
  primaryKey,
} from "drizzle-orm/pg-core";

export const catUpdateTypeEnum = pgEnum("cat_update_type", [
  "sighting",
  "desexed",
  "adopted",
  "general",
]);

export const catSubscriptionsTable = pgTable(
  "cat_subscriptions",
  {
    deviceId: text("device_id").notNull(),
    catId: integer("cat_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.catId] })],
);

export const catUnfollowsTable = pgTable(
  "cat_unfollows",
  {
    deviceId: text("device_id").notNull(),
    catId: integer("cat_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.catId] })],
);

export const catUpdatesTable = pgTable("cat_updates", {
  id: serial("id").primaryKey(),
  catId: integer("cat_id").notNull(),
  updateType: catUpdateTypeEnum("update_type").notNull(),
  message: text("message").notNull(),
  triggerSightingId: integer("trigger_sighting_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  catUpdateId: integer("cat_update_id").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const pushTokensTable = pgTable("push_tokens", {
  deviceId: text("device_id").primaryKey(),
  token: text("token").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One row per evening sighting round-up (data-spine.md PR 9, spec §6.4.4,
 * Q4 = A). `round_up_date` is the Europe/Athens calendar date; inserting it
 * is the claim, so two drains can never send the same evening's round-up
 * twice. Holds no device id: what each person was sent is not recorded, so
 * there is nothing here for deletion (SYC-63) to remove.
 */
export const pushRoundupRunsTable = pgTable("push_roundup_runs", {
  roundUpDate: date("round_up_date").primaryKey(),
  // Sightings (cat_updates.created_at) in [window_start, window_end) are in it.
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  devices: integer("devices"),
});

export type CatSubscription = typeof catSubscriptionsTable.$inferSelect;
export type CatUnfollow = typeof catUnfollowsTable.$inferSelect;
export type CatUpdate = typeof catUpdatesTable.$inferSelect;
export type NotificationRow = typeof notificationsTable.$inferSelect;
export type PushToken = typeof pushTokensTable.$inferSelect;
