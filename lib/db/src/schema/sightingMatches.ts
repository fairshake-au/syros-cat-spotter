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

/**
 * Which screen a pick came from. The phone's word, about its own screen.
 * `cat_page` (SYC-569 D3) is kept on suggested picks too; the others only on
 * hand picks and unlabelled rows.
 */
export const PICKED_FROM = ["nearby", "search", "name_prompt", "cat_page"] as const;

/**
 * What the team did, once (cat-record-data-spine.md, the match record's
 * step 3). On a sent_to_team choice: matched | made_new_cat. On a hand pick
 * or an unlabelled one: looks_right | different_cat | new_cat | hidden. A move
 * from any screen fills it if it is still empty (which-cat-is-which.md §9.7,
 * move step 8).
 */
export const TEAM_ACTIONS = [
  "matched",
  "made_new_cat",
  "looks_right",
  "different_cat",
  "new_cat",
  "hidden",
] as const;

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
    /** SYC-415 §6.2/§8: the matcher said no photo in the spot shows a cat. Null before SYC-415 or when the matcher failed. */
    noCatInAnyPhoto: boolean("no_cat_in_any_photo"),
    /** SYC-415 §4.5: the matcher said the spot's photos look like more than one cat. Null before SYC-415 or when the matcher failed. */
    mixedCats: boolean("mixed_cats"),
    // Step 3: what the team did, written once (only while teamAt is null).
    teamAction: text("team_action"),
    // The cat the team chose at this step.
    teamCatId: integer("team_cat_id"),
    teamByAccountId: text("team_by_account_id"),
    teamAt: timestamp("team_at", { withTimezone: true }),
    // Deleting the account that took the team step clears teamByAccountId
    // and stamps this.
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
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
    check(
      "sighting_matches_team_action_ck",
      sql`${t.teamAction} IS NULL OR ${t.teamAction} IN (${sqlList(TEAM_ACTIONS)})`,
    ),
    // The step's action and time come together, with its author until the
    // author is redacted.
    check(
      "sighting_matches_team_step_ck",
      sql`(${t.teamAction} IS NULL) = (${t.teamAt} IS NULL)
        AND (${t.teamAction} IS NOT NULL OR ${t.teamByAccountId} IS NULL)
        AND (${t.teamAction} IS NULL OR ${t.teamByAccountId} IS NOT NULL OR ${t.redactedAt} IS NOT NULL)`,
    ),
    // A cat comes with the actions that choose one, and only with them.
    check(
      "sighting_matches_team_cat_ck",
      sql`(${t.teamCatId} IS NOT NULL) = coalesce(${t.teamAction} IN ('matched', 'made_new_cat', 'different_cat', 'new_cat'), false)`,
    ),
  ],
);

export type SightingMatch = typeof sightingMatchesTable.$inferSelect;
