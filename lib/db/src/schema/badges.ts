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
  check,
} from "drizzle-orm/pg-core";

// Every points award: one row per resolved sighting, and one per phone and
// pair for finding a duplicate (which-cat-is-which.md §9.8). The week board
// reads this and nothing else, so a week's result never moves once it is
// written.
export const pointsLedgerTable = pgTable(
  "points_ledger",
  {
    id: serial("id").primaryKey(),
    // Null once deletion has unlinked the spotter.
    deviceId: text("device_id"),
    // A sighting's award. Null on a duplicate-finder award
    // (which-cat-is-which.md §9.8), which names its pair instead.
    sightingId: integer("sighting_id").unique(),
    // A duplicate-finder award's pair: canonical ids at the merge, low < high.
    duplicateCatLow: integer("duplicate_cat_low"),
    duplicateCatHigh: integer("duplicate_cat_high"),
    catId: integer("cat_id").notNull(),
    points: integer("points").notNull(),
    athensDay: date("athens_day", { mode: "string" }).notNull(),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    earnedAt: timestamp("earned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // live | history | duplicate
    source: text("source").notNull(),
  },
  (t) => [
    // A spotter earns for a cat once a day from sightings. A duplicate-finder
    // award for the same cat the same day is paid as well.
    uniqueIndex("points_ledger_once_a_day_uq")
      .on(t.deviceId, t.catId, t.athensDay)
      .where(sql`${t.sightingId} is not null and ${t.points} > 0`),
    index("points_ledger_week_device_idx").on(t.weekStart, t.deviceId),
    // A phone is paid once per pair, ever: undoing and re-making a merge
    // never pays twice.
    uniqueIndex("points_ledger_duplicate_pair_uq").on(
      t.deviceId,
      t.duplicateCatLow,
      t.duplicateCatHigh,
    ),
    // Either a sighting's award, or a duplicate-finder award with its pair.
    check(
      "points_ledger_award_ck",
      sql`(${t.sightingId} is not null and ${t.duplicateCatLow} is null and ${t.duplicateCatHigh} is null)
        or (${t.sightingId} is null and ${t.duplicateCatLow} is not null and ${t.duplicateCatHigh} is not null
          and ${t.duplicateCatLow} < ${t.duplicateCatHigh})`,
    ),
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
