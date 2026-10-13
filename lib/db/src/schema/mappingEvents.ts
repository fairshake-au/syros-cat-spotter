import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { feedingSitesTable } from "./colonies";
import { peopleTable } from "./people";

// SYC-209 PR 1.1: the feeding-site and colony history, superseded public
// codes, and the site-page read log (feeding-sites-and-colonies.md §8, §11.1;
// cat-record-data-spine.md §10.5). The triggers that make the history
// add-only live in the migration, as the schema code can't express them.

const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(", "));

/** What a history row is about. */
export const MAPPING_SUBJECT_KINDS = ["site", "colony"] as const;
export type MappingSubjectKind = (typeof MAPPING_SUBJECT_KINDS)[number];

/**
 * Every kind of change the history records (spec §8), plus `existing` (the
 * migration's one row per site that predates the history), the three
 * automatic make-private kinds (§4.5, §4.7) and `guardian_forgotten` (§7.4).
 */
export const MAPPING_EVENT_KINDS = [
  "existing",
  "created",
  "seeded",
  "renamed",
  "notes_edited",
  "directions_edited",
  "colony_changed",
  "moved",
  "made_public",
  "made_private",
  "made_private_moved",
  "made_private_colony_changed",
  "made_private_guardian_changed",
  "label_changed",
  "retired",
  "restored",
  "colony_created",
  "colony_renamed",
  "guardian_changed",
  "colony_notes_changed",
  "colony_centre_changed",
  "guardian_forgotten",
] as const;
export type MappingEventKind = (typeof MAPPING_EVENT_KINDS)[number];

/**
 * The app's own authors of a history row: the first load of sites, and the
 * migration's "existing" rows. Every other row is signed by a person.
 */
export const MAPPING_SYSTEM_ACTORS = ["system:seed", "system:migration"] as const;
export type MappingSystemActor = (typeof MAPPING_SYSTEM_ACTORS)[number];

/** Why a public code was superseded. */
export const OLD_CODE_REASONS = ["moved", "retired"] as const;

/**
 * Superseded public codes. Team-only: kept so the history can show them and
 * so the public lookup can refuse them. A code is never in this table and in
 * feeding_sites.public_id at once (a trigger refuses either direction).
 */
export const feedingSiteOldCodesTable = pgTable(
  "feeding_site_old_codes",
  {
    id: serial("id").primaryKey(),
    siteId: integer("site_id")
      .notNull()
      .references(() => feedingSitesTable.id),
    publicId: text("public_id")
      .notNull()
      .unique("feeding_site_old_codes_public_id_unique"),
    retiredAt: timestamp("retired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reason: text("reason").notNull(),
  },
  (t) => [
    check(
      "feeding_site_old_codes_reason_ck",
      sql`${t.reason} in (${sqlList(OLD_CODE_REASONS)})`,
    ),
  ],
);

/**
 * Every change to a site or a colony, one row each, written in the same
 * transaction as the change (spec §8). Add-only: a trigger refuses delete,
 * TRUNCATE, an insert that arrives redacted, and every update except a first
 * redaction that blanks `before`, `after` and `note` (spec §7.4, SYC-256).
 *
 * Write through `recordMappingEvent(tx, …)` (lib/db/src/mappingEvents.ts),
 * never directly. It holds exact positions, so it is as sensitive as the
 * sites: team-only, never in a public payload, a log line or an email.
 */
export const mappingEventsTable = pgTable(
  "mapping_events",
  {
    id: serial("id").primaryKey(),
    subjectKind: text("subject_kind").notNull(),
    subjectId: integer("subject_id").notNull(),
    kind: text("kind").notNull(),
    // Who did it: a person (strict link; people who leave are marked left,
    // never deleted), or one of MAPPING_SYSTEM_ACTORS. Exactly one is set.
    personId: uuid("person_id").references(() => peopleTable.id),
    actorSystem: text("actor_system"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    before: jsonb("before"),
    after: jsonb("after"),
    note: text("note"),
    guardianAware: boolean("guardian_aware"),
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
    redactionReason: text("redaction_reason"),
  },
  (t) => [
    index("mapping_events_subject_idx").on(t.subjectKind, t.subjectId, t.id.desc()),
    check(
      "mapping_events_subject_kind_ck",
      sql`${t.subjectKind} in (${sqlList(MAPPING_SUBJECT_KINDS)})`,
    ),
    check("mapping_events_kind_ck", sql`${t.kind} in (${sqlList(MAPPING_EVENT_KINDS)})`),
    check(
      "mapping_events_actor_system_ck",
      sql`${t.actorSystem} in (${sqlList(MAPPING_SYSTEM_ACTORS)})`,
    ),
    check("mapping_events_one_actor_ck", sql`(${t.personId} is null) <> (${t.actorSystem} is null)`),
  ],
);

/**
 * Who opened a site's page, and when (spec §8, "Who looked"). No position.
 * Site pages only, not the list or the map.
 */
export const sitePageReadsTable = pgTable("site_page_reads", {
  id: serial("id").primaryKey(),
  personId: uuid("person_id")
    .notNull()
    .references(() => peopleTable.id),
  siteId: integer("site_id")
    .notNull()
    .references(() => feedingSitesTable.id),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export type FeedingSiteOldCode = typeof feedingSiteOldCodesTable.$inferSelect;
export type MappingEvent = typeof mappingEventsTable.$inferSelect;
export type SitePageRead = typeof sitePageReadsTable.$inferSelect;
