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
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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

/**
 * The bell's entries. `kind 'cat'` is news about a cat (`cat_update_id` set,
 * the words come from the cat update). `kind 'week_result'` (SYC-706) is a
 * spotter's place in last week's top three: no cat, its words in `message`,
 * which never names an area or a place. `merged` (a followed cat was merged
 * into another) and `duplicate_points` (points for finding a duplicate) are
 * shaped like `week_result`: no cat update, the words in `message`
 * (which-cat-is-which.md D4, D10). Neither is ever pushed.
 */
export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  catUpdateId: integer("cat_update_id"),
  kind: text("kind").notNull().default("cat"),
  message: text("message"),
  // A week_result's place (1-3) and points, so the app can say it in the
  // spotter's language; null for cat news. The stored message stays for old builds.
  place: integer("place"),
  weekPoints: integer("week_points"),
  // A `merged` or `duplicate_points` line's two cats (SYC-59 PR 4.3): the one
  // that stays and the one that went into it, so the app can word the line in
  // the spotter's language and open the survivor. Null for cat news and
  // weekly results, and for lines written before these columns existed.
  survivorCatId: integer("survivor_cat_id"),
  mergedCatId: integer("merged_cat_id"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  check(
    "notifications_kind_ck",
    sql`(${t.kind} = 'cat' and ${t.catUpdateId} is not null)
      or (${t.kind} in ('week_result', 'merged', 'duplicate_points') and ${t.catUpdateId} is null and ${t.message} is not null)`,
  ),
]);

export const pushTokensTable = pgTable("push_tokens", {
  deviceId: text("device_id").primaryKey(),
  token: text("token").notNull(),
  // The app language the phone last registered with (en, el or fr); null for
  // old app builds, which are sent English.
  language: text("language"),
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
