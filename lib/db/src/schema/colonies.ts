import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  uniqueIndex,
  uuid,
  check,
} from "drizzle-orm/pg-core";
// people.ts imports this file too. Every reference to peopleTable below is
// lazy (`() => peopleTable.id`), so the import cycle is safe.
import { peopleTable } from "./people";

/**
 * Colonies, named the way Syros Cats already name them: a place plus the cat
 * guardian who looks after it, e.g. "Vaporia — Eleni's"
 * (cat-record-data-spine.md §10.5). Renamable at any time; everything refers
 * to a colony by id, and earlier names are kept in colony_name_history.
 *
 * A cat joins a colony through a `colony` observation, not a column here.
 */
export const coloniesTable = pgTable(
  "colonies",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    // NFC, accent- and case-folded (§10.3).
    normalisedName: text("normalised_name").notNull(),
    // Free text, not a link to a person: most guardians have no account.
    guardianName: text("guardian_name"),
    // Approximate centre, team-only. Never published (§6.2).
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("colonies_normalised_name_unique").on(t.normalisedName)],
);

/**
 * One row per name a colony had before its current one.
 *
 * Add-only (SYC-209 PR 1.1): a trigger in the migration refuses delete,
 * TRUNCATE and every update except a first redaction, which replaces `name`
 * and `normalised_name` with "(name removed)" and stamps `redacted_at` with a
 * reason (feeding-sites-and-colonies.md §7.4: an old colony name can hold a
 * guardian's name).
 */
export const colonyNameHistoryTable = pgTable("colony_name_history", {
  id: serial("id").primaryKey(),
  colonyId: integer("colony_id")
    .notNull()
    .references(() => coloniesTable.id),
  name: text("name").notNull(),
  normalisedName: text("normalised_name").notNull(),
  replacedAt: timestamp("replaced_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  replacedBy: text("replaced_by"),
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
  redactionReason: text("redaction_reason"),
});

/**
 * Feeding sites. Private unless Syros Cats make one public, one at a time,
 * with who and when recorded. Public endpoints filter `isPublic = true` in
 * the query, never in a serialiser (§10.5).
 *
 * The columns after `createdAt` are SYC-209 PR 1.1's
 * (cat-record-data-spine.md §10.5, feeding-sites-and-colonies.md §11.1).
 * `madePublicBy` is a link to people (PR 1.2; it was text until then).
 */
export const feedingSitesTable = pgTable(
  "feeding_sites",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    colonyId: integer("colony_id").references(() => coloniesTable.id),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    isPublic: boolean("is_public").notNull().default(false),
    madePublicBy: uuid("made_public_by").references(() => peopleTable.id),
    madePublicAt: timestamp("made_public_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // What the public sees. Required before isPublic can be true. Never the
    // internal name, and never a guardian's name (§6.7).
    publicLabel: text("public_label"),
    // The optional "how to find it" line. Words only; a hint, not a position.
    directions: text("directions"),
    // A random 128-bit value, null until first made public, never derived
    // from `id`. Superseded codes go to feeding_site_old_codes; a trigger
    // refuses a code that is in both tables.
    publicId: text("public_id").unique("feeding_sites_public_id_unique"),
    // Team-only: where the site last stood in public, used to decide whether
    // a re-publish needs a new code. Both or neither.
    lastPublicLat: doublePrecision("last_public_lat"),
    lastPublicLng: doublePrecision("last_public_lng"),
    // The last value of the "the cat guardian knows" tick box (§4.3).
    guardianAware: boolean("guardian_aware"),
    // SYC-705: true when the point is only roughly right (a drop on the map
    // rather than a surveyed spot), so the dashboard map can draw it as such.
    positionApproximate: boolean("position_approximate")
      .notNull()
      .default(false),
    // Set when retired, cleared when brought back. Never public while set.
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    retiredBy: uuid("retired_by").references(() => peopleTable.id),
    // The version every write is conditional on (§11.2).
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "feeding_sites_public_needs_label_ck",
      sql`not ${t.isPublic} or (${t.publicLabel} is not null and ${t.publicId} is not null)`,
    ),
    check(
      "feeding_sites_retired_never_public_ck",
      sql`not (${t.isPublic} and ${t.retiredAt} is not null)`,
    ),
    check(
      "feeding_sites_last_public_pair_ck",
      sql`(${t.lastPublicLat} is null) = (${t.lastPublicLng} is null)`,
    ),
  ],
);

export type Colony = typeof coloniesTable.$inferSelect;
export type ColonyNameHistory = typeof colonyNameHistoryTable.$inferSelect;
export type FeedingSite = typeof feedingSitesTable.$inferSelect;
