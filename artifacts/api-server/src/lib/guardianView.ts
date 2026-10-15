import { db, peopleTable, personScopesTable, scopeInForce } from "@workspace/db";
import { and, inArray, isNull, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { capabilitiesOf, type CapabilityHolder } from "./capabilities";

// What a person may SEE on the Colonies and Feeding sites pages (SYC-209 PR
// 4.1; feeding-sites spec §7.3). A cat guardian sees only her own colonies
// and their sites; anything else is absent, as if it didn't exist. The team
// sees the whole island.
//
// **The one filter.** Every read of sites or colonies in lib/teamSites.ts,
// lib/teamColonies.ts, lib/colonyCats.ts and lib/teamSiteWrites.ts takes a
// `Visible`, and narrows its SQL with `colonyFilter` or `covers`. A
// `Visible` can only be made here, from the person (`visibleColonyIds`): it
// is a branded type, so a route can't hand a query "everything" by
// accident, and a forgotten argument is a type error, not a leak.
// guardianView.source.test.ts fails if a reading function in those modules
// doesn't take one, or if anything else builds one.
//
// **Is this viewer island-wide?** `isIslandWide(person)` (or
// `visible.ids === null`) is THE question for anything only the team may
// see. Later team-only features (for example the map-company links the
// team will get on dashboard pages, Linear SYC-362) must gate on it, so a
// cat guardian's pages stay free of them.

declare const VISIBLE: unique symbol;

/**
 * Which colonies a person may see. `ids: null` means every colony (an
 * island-wide holder of `view_exact_location`, the team); otherwise exactly
 * these colony ids (a cat guardian's placements). An empty list sees nothing.
 */
export interface Visible {
  readonly [VISIBLE]: true;
  readonly ids: readonly number[] | null;
}

/**
 * Built from `capabilitiesOf(person)`'s colony ids for `view_exact_location`
 * (roles PR 0.5). `null` ("all") ONLY for an island-wide holder. Anything
 * else (no grant, or a shape this code doesn't know) sees nothing: fails
 * closed. Never the "for any colony?" check, which is the sign-in door's alone.
 */
export function visibleColonyIds(person: CapabilityHolder): Visible {
  const grant = capabilitiesOf(person).find((c) => c.capability === "view_exact_location");
  let ids: readonly number[] | null;
  if (!grant) ids = [];
  else if (grant.where === "island") ids = null;
  else if (Array.isArray(grant.where)) ids = Object.freeze([...grant.where]);
  else ids = [];
  return Object.freeze({ ids }) as unknown as Visible;
}

/** Is this person island-wide (the team)? The gate for anything only the team may see. */
export function isIslandWide(person: CapabilityHolder): boolean {
  return visibleColonyIds(person).ids === null;
}

/** May this viewer enter the Colonies and Feeding sites pages at all? */
export function seesAny(visible: Visible): boolean {
  return visible.ids === null || visible.ids.length > 0;
}

/** Does this viewer see this colony? A site or cat in no colony: only the team. */
export function covers(visible: Visible, colonyId: number | null | undefined): boolean {
  if (visible.ids === null) return true;
  return typeof colonyId === "number" && visible.ids.includes(colonyId);
}

/**
 * The SQL that narrows a query to the colonies this viewer sees, on a
 * colony-id column. Nothing for the team; `false` for someone who sees
 * nothing; otherwise `column in (…)`, which also leaves out every row whose
 * colony is null.
 */
export function colonyFilter(column: AnyColumn, visible: Visible): SQL | undefined {
  if (visible.ids === null) return undefined;
  if (visible.ids.length === 0) return sql`false`;
  return inArray(column, [...visible.ids]);
}

/** How a guardian's page names anyone who isn't on her own colonies. */
export const SYROS_CATS = "Syros Cats";

/**
 * Turns person ids into the names a viewer may read in a history or the
 * "Recently changed" strip (spec §7.3: "no other person's name beyond her
 * colony's").
 *
 * - The team: "Maria", "Maria (left)" for someone who has left (SYC-43 part
 *   2, Decision 7), "the system" for no person, and "someone no longer on
 *   the team list" for an id that isn't on it.
 * - A cat guardian: the name of someone placed on one of her own colonies
 *   now (herself included); everyone and everything else is "Syros Cats",
 *   the way the roles plan's guardian pages name the team.
 */
export async function nameLabeller(
  visible: Visible,
  personIds: readonly (string | null)[],
): Promise<(personId: string | null) => string> {
  const ids = [...new Set(personIds.filter((p): p is string => p !== null))];
  if (visible.ids === null) {
    const rows =
      ids.length === 0
        ? []
        : await db
            .select({ id: peopleTable.id, name: peopleTable.name, leftAt: peopleTable.leftAt })
            .from(peopleTable)
            .where(inArray(peopleTable.id, ids));
    const names = new Map(rows.map((r) => [r.id, r.leftAt !== null ? `${r.name} (left)` : r.name]));
    return (p) =>
      p === null ? "the system" : (names.get(p) ?? "someone no longer on the team list");
  }
  const rows =
    ids.length === 0 || visible.ids.length === 0
      ? []
      : await db
          .selectDistinct({ id: peopleTable.id, name: peopleTable.name })
          .from(personScopesTable)
          .innerJoin(peopleTable, sql`${peopleTable.id} = ${personScopesTable.personId}`)
          .where(
            and(
              inArray(personScopesTable.colonyId, [...visible.ids]),
              inArray(peopleTable.id, ids),
              scopeInForce(),
              isNull(peopleTable.leftAt),
            ),
          );
  const names = new Map(rows.map((r) => [r.id, r.name]));
  return (p) => (p === null ? SYROS_CATS : (names.get(p) ?? SYROS_CATS));
}

/**
 * The language a Colonies or Feeding sites page is drawn in: English for the
 * team (spec Decision 9), the person's own for a cat guardian (which still
 * falls back to English until that language is live, strings/index.ts).
 */
export function pageLangFor(person: CapabilityHolder & { language?: string | null }): string {
  return isIslandWide(person) ? "en" : (person.language ?? "en");
}
