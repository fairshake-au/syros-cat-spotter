import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  boolean,
  uuid,
  text,
  bigint,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { ISLAND_ROLES } from "./people";

const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(", "));

/** Why a sighting moved (which-cat-is-which.md §9.1). The last two only follow a merge or its undo. */
export const MOVE_REASONS = [
  "different_markings",
  "two_cats",
  "wrong_pick",
  "other",
  "merged",
  "merge_undone",
] as const;

/** Which screen the move came from. */
export const MOVE_SOURCES = ["cat_page", "matched_by_hand", "report", "game", "merge", "undo"] as const;

/**
 * The mover's role when moving (§9.1: staff | management), never looked up
 * at read time. These are the island-wide roles, so the list is people.ts's
 * (the one list of team roles rule, SYC-53).
 */
const MOVE_ROLES = ISLAND_ROLES;

/**
 * One row per sighting moved from one cat to another (which-cat-is-which.md
 * §9.1). A sighting's cat changes only with a row here written in the same
 * transaction: the sightings trigger in migration 0054 checks the row named
 * by the transaction-local setting `app.sighting_move_id` (or, for a merge's
 * moves, `app.cat_merge_id`) has `txid = txid_current()` and matches.
 *
 * Add-only: a trigger refuses delete, truncate and every update except
 * redaction (clearing who moved it and stamping `redacted_at`).
 */
export const sightingMovesTable = pgTable(
  "sighting_moves",
  {
    id: serial("id").primaryKey(),
    // The spot moved, with all its photos.
    sightingId: integer("sighting_id").notNull(),
    // Canonical ids at the time.
    fromCatId: integer("from_cat_id").notNull(),
    toCatId: integer("to_cat_id").notNull(),
    madeNewCat: boolean("made_new_cat").notNull().default(false),
    letSpottersName: boolean("let_spotters_name").notNull().default(false),
    // Set when a merge or its undo made this move (a cat_identity row).
    mergeId: integer("merge_id"),
    // The moves saved together (a multi-select, a merge).
    batchId: uuid("batch_id").notNull(),
    reason: text("reason").notNull(),
    reasonText: text("reason_text"),
    source: text("source").notNull(),
    // Null only once redacted.
    movedByAccountId: text("moved_by_account_id"),
    roleAtTime: text("role_at_time").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // The transaction that wrote the row (§9.4). Not xmin: that is another
    // type, and differs inside a savepoint.
    txid: bigint("txid", { mode: "number" })
      .notNull()
      .default(sql`txid_current()`),
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
  },
  (t) => [
    index("sighting_moves_sighting_idx").on(t.sightingId, t.id),
    index("sighting_moves_merge_idx").on(t.mergeId),
    check("sighting_moves_cats_ck", sql`${t.fromCatId} <> ${t.toCatId}`),
    check(
      "sighting_moves_spotters_name_ck",
      sql`not ${t.letSpottersName} or ${t.madeNewCat}`,
    ),
    check(
      "sighting_moves_merge_ck",
      sql`(${t.reason} in ('merged', 'merge_undone')) = (${t.mergeId} is not null)`,
    ),
    check(
      "sighting_moves_mover_ck",
      sql`${t.movedByAccountId} is not null or ${t.redactedAt} is not null`,
    ),
    check("sighting_moves_reason_ck", sql`${t.reason} in (${sqlList(MOVE_REASONS)})`),
    check("sighting_moves_source_ck", sql`${t.source} in (${sqlList(MOVE_SOURCES)})`),
    check("sighting_moves_role_ck", sql`${t.roleAtTime} in (${sqlList(MOVE_ROLES)})`),
  ],
);

/**
 * The follows and unfollows a merge copied onto the survivor
 * (which-cat-is-which.md §9.7 merge step 4): one row per row actually
 * inserted, so an undo removes only those still there with the same
 * `created_at`. In the deletion sweep (§9.11) by device id.
 */
export const mergeFollowChangesTable = pgTable(
  "merge_follow_changes",
  {
    id: serial("id").primaryKey(),
    mergeId: integer("merge_id").notNull(),
    deviceId: text("device_id").notNull(),
    // follow | unfollow
    kind: text("kind").notNull(),
    // The copied cat_subscriptions / cat_unfollows row's created_at.
    rowCreatedAt: timestamp("row_created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("merge_follow_changes_merge_idx").on(t.mergeId),
    index("merge_follow_changes_device_idx").on(t.deviceId),
    check("merge_follow_changes_kind_ck", sql`${t.kind} in ('follow', 'unfollow')`),
  ],
);

export type SightingMove = typeof sightingMovesTable.$inferSelect;
export type MergeFollowChange = typeof mergeFollowChangesTable.$inferSelect;
