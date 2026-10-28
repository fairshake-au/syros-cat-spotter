import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  serial,
  integer,
  bigint,
  jsonb,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";

/**
 * Every statement anybody makes about a cat, append-only
 * (cat-record-data-spine.md §10.1). A cat's status is derived from these by
 * the resolver; nothing stores a status column.
 *
 * Rows are never updated or deleted. The one exception is redaction (§8.5):
 * stamping `redactedAt`, clearing the author, and emptying a note's text. A
 * trigger in the migration enforces exactly that.
 */
export const observationsTable = pgTable(
  "observations",
  {
    id: serial("id").primaryKey(),
    catId: integer("cat_id").notNull(),

    // Open vocabulary. Phase 1: life_status, sterilised, ear_tip,
    // food_and_water, note, name, colony, welfare_report, welfare_outcome.
    kind: text("kind").notNull(),
    value: jsonb("value").notNull(),

    // Exactly one of deviceId / accountId is set, until redaction clears both.
    deviceId: text("device_id"),
    accountId: text("account_id"),
    // The observer's role when writing. Never looked up at read time.
    // public | guardian | volunteer | vet | staff | admin | system
    roleAtTime: text("role_at_time").notNull().default("public"),
    // none | guardian_of_this_cat | owner_of_this_cat
    authorityScope: text("authority_scope").notNull().default("none"),

    // volunteered | prompted | machine | import | legacy
    provenance: text("provenance").notNull().default("volunteered"),
    suggestedValue: jsonb("suggested_value"),
    suggestionSource: text("suggestion_source"),

    sightingId: integer("sighting_id"),
    photoId: integer("photo_id"),
    importRecordId: integer("import_record_id"),

    // When the thing was true, not when the row was written.
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    supersedesId: integer("supersedes_id"),
    supersedeReason: text("supersede_reason"),
    // Set only on a statement a move copied or withdrew (which-cat-is-which.md
    // §9.5). No foreign key. The observations trigger allows it only with the
    // move named by `app.sighting_move_id` in this transaction.
    sightingMoveId: integer("sighting_move_id"),

    redactedAt: timestamp("redacted_at", { withTimezone: true }),
    redactionReason: text("redaction_reason"),
  },
  (t) => [
    index("observations_cat_kind_idx").on(t.catId, t.kind, t.observedAt),
    index("observations_kind_idx").on(t.kind),
    // Deletion (§8.5) finds a person's rows synchronously, while they wait.
    index("observations_device_idx")
      .on(t.deviceId)
      .where(sql`${t.deviceId} is not null`),
    index("observations_account_idx")
      .on(t.accountId)
      .where(sql`${t.accountId} is not null`),
    // The team's "Recent changes by cat guardians" (SYC-431; SYC-209 PR 4.3):
    // a cat guardian's statements, newest first, and the rows that mark one wrong.
    index("observations_guardian_recent_idx")
      .on(t.createdAt.desc(), t.id.desc())
      .where(sql`${t.roleAtTime} = 'guardian'`),
    index("observations_supersedes_idx")
      .on(t.supersedesId)
      .where(sql`${t.supersedesId} is not null`),
    // "Which cats has any statement ever put in colony N" (SYC-307: the one
    // colony page and the trapping plan read only that colony's rows).
    index("observations_colony_idx")
      .on(sql`(${t.value}->>'colonyId')`, t.catId)
      .where(sql`${t.kind} = 'colony'`),
    check(
      "observations_attribution_ck",
      sql`${t.redactedAt} is not null or (${t.deviceId} is null) <> (${t.accountId} is null)`,
    ),
  ],
);

/**
 * Which cat record is canonical for which (§10.3). A merge is a row and an
 * unmerge is another row that supersedes it, because merging cannot repoint
 * observations.catId without breaking the append-only rule. Add-only: since
 * migration 0054 a trigger allows only redaction (by_account_id cleared,
 * redacted_at stamped), and a check deferred to commit refuses a merge while
 * a resolved sighting still names the merged-away cat.
 */
export const catIdentityTable = pgTable(
  "cat_identity",
  {
    id: serial("id").primaryKey(),
    catId: integer("cat_id").notNull(),
    canonicalCatId: integer("canonical_cat_id").notNull(),
    reason: text("reason"),
    // Untyped, from before merges were built. New rows use byAccountId.
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    supersedesId: integer("supersedes_id"),
    // which-cat-is-which.md §9.2: what the merge screen records.
    reasonText: text("reason_text"),
    // Null only once redacted, on rows the merge route writes.
    byAccountId: text("by_account_id"),
    roleAtTime: text("role_at_time"),
    // default | switched
    survivorChosen: text("survivor_chosen"),
    // The transaction that wrote the row (§9.4): the sightings trigger checks
    // a merge's moves against it. Not xmin: that is another type, and
    // differs inside a savepoint.
    txid: bigint("txid", { mode: "number" })
      .notNull()
      .default(sql`txid_current()`),
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
  },
  (t) => [
    index("cat_identity_canonical_idx").on(t.canonicalCatId),
    index("cat_identity_cat_idx").on(t.catId),
    check(
      "cat_identity_survivor_chosen_ck",
      sql`${t.survivorChosen} is null or ${t.survivorChosen} in ('default', 'switched')`,
    ),
  ],
);

export type Observation = typeof observationsTable.$inferSelect;
export type NewObservation = typeof observationsTable.$inferInsert;
export type CatIdentity = typeof catIdentityTable.$inferSelect;
