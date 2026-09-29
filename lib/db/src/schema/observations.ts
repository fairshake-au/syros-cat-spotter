import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  serial,
  integer,
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
    check(
      "observations_attribution_ck",
      sql`${t.redactedAt} is not null or (${t.deviceId} is null) <> (${t.accountId} is null)`,
    ),
  ],
);

/**
 * Which cat record is canonical for which (§10.3). A merge is a row and an
 * unmerge is another row that supersedes it, because merging cannot repoint
 * observations.catId without breaking the append-only rule.
 */
export const catIdentityTable = pgTable("cat_identity", {
  id: serial("id").primaryKey(),
  catId: integer("cat_id").notNull(),
  canonicalCatId: integer("canonical_cat_id").notNull(),
  reason: text("reason"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  supersedesId: integer("supersedes_id"),
});

export type Observation = typeof observationsTable.$inferSelect;
export type NewObservation = typeof observationsTable.$inferInsert;
export type CatIdentity = typeof catIdentityTable.$inferSelect;
