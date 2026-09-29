import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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

/** One row per name a colony had before its current one. */
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
});

/**
 * Feeding sites. Private unless Syros Cats make one public, one at a time,
 * with who and when recorded. Public endpoints filter `isPublic = true` in
 * the query, never in a serialiser (§10.5).
 */
export const feedingSitesTable = pgTable("feeding_sites", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  colonyId: integer("colony_id").references(() => coloniesTable.id),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  isPublic: boolean("is_public").notNull().default(false),
  madePublicBy: text("made_public_by"),
  madePublicAt: timestamp("made_public_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Colony = typeof coloniesTable.$inferSelect;
export type ColonyNameHistory = typeof colonyNameHistoryTable.$inferSelect;
export type FeedingSite = typeof feedingSitesTable.$inferSelect;
