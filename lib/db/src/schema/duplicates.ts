import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  real,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";

const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(", "));

export const DUPLICATE_REPORT_SOURCES = [
  "spotter_question",
  "new_cat_check",
  "sweep",
  "game",
  "team",
] as const;
export const DUPLICATE_SAYS = ["same", "different", "not_sure"] as const;
export const DUPLICATE_DECISIONS = ["merged", "different", "not_sure", "merge_undone"] as const;

/**
 * Evidence that two cat records may be the same cat (which-cat-is-which.md
 * §9.6). Team-only: no public route reads it. Add-only: a trigger in
 * migration 0054 refuses delete, truncate and every update except redaction
 * (the device cleared, `redacted_at` stamped), as for a deleted spotter.
 */
export const duplicateReportsTable = pgTable(
  "duplicate_reports",
  {
    id: serial("id").primaryKey(),
    // Canonical ids at the time, low < high.
    catLow: integer("cat_low").notNull(),
    catHigh: integer("cat_high").notNull(),
    source: text("source").notNull(),
    says: text("says").notNull(),
    // Spotter sources; null once redacted.
    deviceId: text("device_id"),
    // spotter_question, new_cat_check
    sightingId: integer("sighting_id"),
    // sweep, new_cat_check: fingerprint likeness
    score: real("score"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
  },
  (t) => [
    index("duplicate_reports_pair_idx").on(t.catLow, t.catHigh),
    // Deletion finds a spotter's reports synchronously, while they wait.
    index("duplicate_reports_device_idx")
      .on(t.deviceId)
      .where(sql`${t.deviceId} is not null`),
    check("duplicate_reports_pair_ck", sql`${t.catLow} < ${t.catHigh}`),
    check(
      "duplicate_reports_source_ck",
      sql`${t.source} in (${sqlList(DUPLICATE_REPORT_SOURCES)})`,
    ),
    check("duplicate_reports_says_ck", sql`${t.says} in (${sqlList(DUPLICATE_SAYS)})`),
  ],
);

/**
 * The team's decisions about a pair (§9.6). A pair's state is its newest
 * decision. Add-only, redaction only (who decided cleared, §9.11).
 */
export const duplicateDecisionsTable = pgTable(
  "duplicate_decisions",
  {
    id: serial("id").primaryKey(),
    catLow: integer("cat_low").notNull(),
    catHigh: integer("cat_high").notNull(),
    decision: text("decision").notNull(),
    // With merged, merge_undone: the cat_identity row.
    mergeId: integer("merge_id"),
    note: text("note"),
    byAccountId: text("by_account_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
  },
  (t) => [
    index("duplicate_decisions_pair_idx").on(t.catLow, t.catHigh, t.id),
    check("duplicate_decisions_pair_ck", sql`${t.catLow} < ${t.catHigh}`),
    check(
      "duplicate_decisions_decision_ck",
      sql`${t.decision} in (${sqlList(DUPLICATE_DECISIONS)})`,
    ),
    check(
      "duplicate_decisions_merge_ck",
      sql`(${t.decision} in ('merged', 'merge_undone')) = (${t.mergeId} is not null)`,
    ),
    check(
      "duplicate_decisions_by_ck",
      sql`${t.byAccountId} is not null or ${t.redactedAt} is not null`,
    ),
  ],
);

/**
 * "Checked, it's new": about one cat, so its own add-only table (§9.6).
 * Redaction only, as for decisions.
 */
export const newCatChecksTable = pgTable(
  "new_cat_checks",
  {
    id: serial("id").primaryKey(),
    catId: integer("cat_id").notNull(),
    byAccountId: text("by_account_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
  },
  (t) => [
    index("new_cat_checks_cat_idx").on(t.catId, t.id),
    check(
      "new_cat_checks_by_ck",
      sql`${t.byAccountId} is not null or ${t.redactedAt} is not null`,
    ),
  ],
);

export type DuplicateReport = typeof duplicateReportsTable.$inferSelect;
export type DuplicateDecision = typeof duplicateDecisionsTable.$inferSelect;
export type NewCatCheck = typeof newCatChecksTable.$inferSelect;
