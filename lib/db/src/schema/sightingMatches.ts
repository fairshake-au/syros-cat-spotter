import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  check,
} from "drizzle-orm/pg-core";
import { sightingsTable } from "./sightings";

/** How the spotter's choice was made, as the server decided it (§4.6). */
export const MATCH_CHOICES = [
  "suggested",
  "hand_pick",
  "new_cat",
  // Resolved before match records existed (SYC-119 Decision 1): the server
  // has no stored set to compare with, so it doesn't guess.
  "unlabelled",
] as const;

/** Which screen a hand pick came from. The phone's word, about its own screen. */
export const PICKED_FROM = ["nearby", "search", "name_prompt"] as const;

/** Why the matcher missed a hand-picked cat (§4.6). */
export const MISS_KINDS = [
  // Compared, but scored too low to be suggested.
  "matcher_miss",
  // Never compared: outside the 500 m the matcher looked at.
  "distance_miss",
] as const;

export type SuggestedMatch = { catId: number; rank: number; score: number };

const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(", "));

/**
 * What the matcher compared and suggested for a sighting, and what the spotter
 * chose (SYC-151; choose-a-different-cat.md §4.6, option C). Team-only: no
 * public route reads this table, so it can't reach a public payload (filtered
 * in the query, not the serialiser). Linked to the sighting, never to a
 * device, so deleting a person needs nothing extra here.
 */
export const sightingMatchesTable = pgTable(
  "sighting_matches",
  {
    sightingId: integer("sighting_id")
      .primaryKey()
      .references(() => sightingsTable.id, { onDelete: "cascade" }),
    // Null only on a row created at resolve for a sighting from before match
    // records existed.
    comparedCatIds: integer("compared_cat_ids").array(),
    suggested: jsonb("suggested").$type<SuggestedMatch[]>(),
    matcherFailed: boolean("matcher_failed").notNull().default(false),
    // When the compared and suggested sets were last written. The dedupe-hit
    // path re-runs matching and overwrites them, because the phone shows the
    // latest response.
    matchedAt: timestamp("matched_at", { withTimezone: true }),
    choice: text("choice"),
    chosenCatId: integer("chosen_cat_id"),
    suggestedRank: integer("suggested_rank"),
    pickedFrom: text("picked_from"),
    missKind: text("miss_kind"),
    openedPicker: boolean("opened_picker"),
    // With a new cat: was a colour filter on in the picker when the spotter
    // chose new (spec §4.6)? A choice from a filtered list is weaker evidence
    // the cat is new. Set by SYC-119 Slice C once the filter exists; null
    // until then.
    colourFilterOn: boolean("colour_filter_on"),
    chosenAt: timestamp("chosen_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "sighting_matches_choice_ck",
      sql`${t.choice} IS NULL OR ${t.choice} IN (${sqlList(MATCH_CHOICES)})`,
    ),
    check(
      "sighting_matches_picked_from_ck",
      sql`${t.pickedFrom} IS NULL OR ${t.pickedFrom} IN (${sqlList(PICKED_FROM)})`,
    ),
    check(
      "sighting_matches_miss_kind_ck",
      sql`${t.missKind} IS NULL OR ${t.missKind} IN (${sqlList(MISS_KINDS)})`,
    ),
    // A label comes with a time, and a suggestion with its rank.
    check(
      "sighting_matches_chosen_ck",
      sql`(${t.choice} IS NULL) = (${t.chosenAt} IS NULL)`,
    ),
    check(
      "sighting_matches_rank_ck",
      sql`(${t.choice} = 'suggested') = (${t.suggestedRank} IS NOT NULL)`,
    ),
  ],
);

export type SightingMatch = typeof sightingMatchesTable.$inferSelect;
