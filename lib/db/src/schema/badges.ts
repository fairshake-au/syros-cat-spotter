import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  date,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Every points award, one row per resolved sighting. The week board reads
// this and nothing else, so a week's result never moves once it is written.
export const pointsLedgerTable = pgTable(
  "points_ledger",
  {
    id: serial("id").primaryKey(),
    // Null once deletion has unlinked the spotter.
    deviceId: text("device_id"),
    sightingId: integer("sighting_id").notNull().unique(),
    catId: integer("cat_id").notNull(),
    points: integer("points").notNull(),
    athensDay: date("athens_day", { mode: "string" }).notNull(),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    earnedAt: timestamp("earned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // live | history
    source: text("source").notNull(),
  },
  (t) => [
    // A spotter earns for a cat once a day.
    uniqueIndex("points_ledger_once_a_day_uq")
      .on(t.deviceId, t.catId, t.athensDay)
      .where(sql`${t.points} > 0`),
    index("points_ledger_week_device_idx").on(t.weekStart, t.deviceId),
  ],
);

export const spotterBadgesTable = pgTable(
  "spotter_badges",
  {
    deviceId: text("device_id").notNull(),
    badgeId: text("badge_id").notNull(),
    earnedAt: timestamp("earned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // live | history | week
    source: text("source").notNull(),
    // Null shows the badge as "New".
    seenAt: timestamp("seen_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.badgeId] })],
);

export const badgeMomentsTable = pgTable("badge_moments", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  // badges | week_result | history
  kind: text("kind").notNull(),
  badgeIds: text("badge_ids").array().notNull(),
  weekStart: date("week_start", { mode: "string" }),
  place: integer("place"),
  weekPoints: integer("week_points"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  celebratedAt: timestamp("celebrated_at", { withTimezone: true }),
});

export const weeklyClosesTable = pgTable("weekly_closes", {
  weekStart: date("week_start", { mode: "string" }).primaryKey(),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull(),
  pushedAt: timestamp("pushed_at", { withTimezone: true }),
});

export const weeklyResultsTable = pgTable(
  "weekly_results",
  {
    id: serial("id").primaryKey(),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    place: integer("place").notNull(),
    // Null once deletion has unlinked the spotter.
    deviceId: text("device_id"),
    // Null renders "a spotter".
    displayName: text("display_name"),
    points: integer("points").notNull(),
  },
  (t) => [
    uniqueIndex("weekly_results_week_device_uq").on(t.weekStart, t.deviceId),
  ],
);

// One row per backfill version, so the history backfill runs once.
export const badgeBackfillRunsTable = pgTable("badge_backfill_runs", {
  version: integer("version").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  spotters: integer("spotters"),
});
