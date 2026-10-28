import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// SYC-45 Slice 1 (docs/superpowers/plans/syc-344-email-capture.md, PR 1.1;
// email-capture.md §5.3): the nightly news check's own three tables. None
// holds an address. A device id could appear only in `caused_by_devices`,
// and Slice 1 (watch only) never writes one there, so there is nothing here
// for "Delete my data" to remove. Slice 3 starts filling it, and must clear
// it from "Delete my data" in the same PR.

// The last status the nightly check saw for each followed cat.
//
// WRITTEN ONLY BY THE NIGHTLY CHECK (artifacts/api-server/src/lib/news/
// nightly.ts) AND NEVER READ BY THE RESOLVER, THE CAT PAGE OR ANYTHING ELSE
// THAT SHOWS A CAT'S STATUS. It is a consumer-owned cache for spotting
// changes, not a source of truth about any cat (email-capture.md §5.3 and
// Risk 8; the data spine rejects a cached status column, and this is not
// that column). Deleting every row is safe: the next run re-seeds and sends
// nothing.
//
// `notified_sterilised_at` and `notified_homed_at` are set once and never
// cleared: a ratchet, so a status that flips back and forth is never
// announced twice (data spine §9, "nobody is told twice").
export const catNewsBaselineTable = pgTable("cat_news_baseline", {
  catId: integer("cat_id").primaryKey(),
  sterilisedConfirmed: boolean("sterilised_confirmed").notNull(),
  notifiedSterilisedAt: timestamp("notified_sterilised_at", { withTimezone: true }),
  notifiedHomedAt: timestamp("notified_homed_at", { withTimezone: true }),
  lifeStatus: text("life_status").notNull(),
  lastSightingAt: timestamp("last_sighting_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// Every change the check found: the evidence the two-week rule needs
// (email-capture.md §10.1 Risk 1), and what a person reviews.
//
// - `change`: sterilised | homed | seen_again.
// - `evidence_ids`: observation ids for sterilised and homed (from the
//   resolver's `supportingObservationIds`); sighting ids for seen_again.
// - `caused_by_devices`: the devices whose observations or sightings caused
//   it, used only to stop telling someone about their own spot (plan C13,
//   Slice 3), then cleared when the change is settled. Always null in watch
//   mode (Slice 1).
// - `state`: watched (watch mode) | held | sent | silenced | expired.
// - `silenced_reason`, only when silenced: import | legacy | old_news |
//   first_seen | deceased | bulk | moved | merged (which-cat-is-which.md §9.12).
export const catNewsChangesTable = pgTable(
  "cat_news_changes",
  {
    id: serial("id").primaryKey(),
    catId: integer("cat_id").notNull(),
    change: text("change").notNull(),
    evidenceIds: integer("evidence_ids").array().notNull(),
    causedByDevices: text("caused_by_devices").array(),
    foundAt: timestamp("found_at", { withTimezone: true }).notNull(),
    state: text("state").notNull(),
    silencedReason: text("silenced_reason"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedNote: text("reviewed_note"),
  },
  (t) => [
    index("cat_news_changes_found_idx").on(t.foundAt.desc()),
    check(
      "cat_news_changes_change_ck",
      sql`${t.change} IN ('sterilised', 'homed', 'seen_again')`,
    ),
    check(
      "cat_news_changes_state_ck",
      sql`${t.state} IN ('watched', 'held', 'sent', 'silenced', 'expired')`,
    ),
    check(
      "cat_news_changes_silenced_ck",
      sql`(${t.state} = 'silenced') = (${t.silencedReason} IS NOT NULL)`,
    ),
    check(
      "cat_news_changes_reason_ck",
      sql`${t.silencedReason} IS NULL OR ${t.silencedReason} IN ('import', 'legacy', 'old_news', 'first_seen', 'deceased', 'bulk', 'moved', 'merged')`,
    ),
  ],
);

// One row per Athens night, written only when the night's check FINISHES
// (in the same transaction as its baseline and change rows), so a run that
// crashes part-way claims nothing and the backup re-runs it.
export const catNewsRunsTable = pgTable("cat_news_runs", {
  athensDate: date("athens_date").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
  catsWalked: integer("cats_walked").notNull(),
  changesFound: integer("changes_found").notNull(),
  silencedBulk: boolean("silenced_bulk").notNull(),
});

export type CatNewsBaseline = typeof catNewsBaselineTable.$inferSelect;
export type CatNewsChange = typeof catNewsChangesTable.$inferSelect;
export type CatNewsRun = typeof catNewsRunsTable.$inferSelect;
