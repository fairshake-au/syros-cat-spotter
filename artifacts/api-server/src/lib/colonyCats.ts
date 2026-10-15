import { catsTable, coloniesTable, db, foldName, photosTable } from "@workspace/db";
import { asc, eq, inArray, or, sql } from "drizzle-orm";
import { actingRole, can } from "./capabilities";
import { catTarget } from "./capabilityTargets";
import { currentColonyOf } from "./colonyMembership";
import { ObservationRefused, writeObservation } from "./observations";
import { SYR_RE, syrNumber, teamPhotoUrl } from "./teamCatView";

// Putting cats in colonies, moving them and taking them out (SYC-209 PR 2.2;
// spec §2.8, §11.5). A cat's colony is never a column: each change is one
// signed `colony` statement, and `currentColonyOf` (lib/colonyMembership.ts)
// says which one stands. Nothing here touches life status, sterilisation or
// "last seen": a `colony` statement feeds none of those resolvers.
//
// Called with NO colony target, on purpose (plan Decision 1A): until PR 4.1,
// `can(person, "assign_cat_to_colony")` means "the team".

type Person = { id: string; scopes: { role: string; colonyId: number | null }[] };

/** The most cats one "Add the ticked cats" may carry. */
export const ADD_CATS_MAX = 100;

export type PlaceCatsOutcome =
  | {
      kind: "done";
      /** Ids of the statements written, one per cat that changed. */
      written: number[];
      /** Cats that needed nothing: already there, or (take out) no longer there. */
      skipped: number;
    }
  | { kind: "no_colony" }
  | { kind: "no_cat"; catIds: number[] };

/**
 * Puts each cat in `colonyId`, or in no colony (`null`: "take out"), by
 * writing one `colony` statement per cat, all in ONE transaction: if any
 * cat is missing, or the colony is, nothing is written.
 *
 * - The colony must exist (the value check in writeObservation only checks
 *   the shape).
 * - A cat already in that colony, or (for a take-out) in none, is skipped:
 *   no pointless statement.
 * - `onlyFrom`: a take-out from a colony page says which colony it is
 *   taking the cat out of; a cat that is in a different colony now (moved
 *   since the page was drawn) is skipped, never taken out of the wrong one.
 * - `roleAtTime` comes from `actingRole`, never typed by hand.
 * - The cats are locked in id order first, so two people changing the same
 *   cat queue up and each sees what the other left.
 */
export async function placeCats(
  person: Person,
  colonyId: number | null,
  rawCatIds: readonly number[],
  opts: { onlyFrom?: number } = {},
): Promise<PlaceCatsOutcome> {
  if (!can(person, "assign_cat_to_colony")) {
    throw new ObservationRefused("NOT_AUTHORISED", "Not authorised");
  }
  const catIds = [...new Set(rawCatIds)].sort((a, b) => a - b);

  return db.transaction(async (tx): Promise<PlaceCatsOutcome> => {
    if (colonyId !== null) {
      const [colony] = await tx
        .select({ id: coloniesTable.id })
        .from(coloniesTable)
        .where(eq(coloniesTable.id, colonyId));
      if (!colony) return { kind: "no_colony" };
    }

    const locked = await tx
      .select({ id: catsTable.id })
      .from(catsTable)
      .where(inArray(catsTable.id, catIds))
      .orderBy(asc(catsTable.id))
      .for("update");
    const found = new Set(locked.map((c) => c.id));
    const missing = catIds.filter((id) => !found.has(id));
    if (missing.length > 0) return { kind: "no_cat", catIds: missing };

    const now = await currentColonyOf(catIds, tx);
    const written: number[] = [];
    let skipped = 0;
    for (const catId of catIds) {
      const inNow = now.get(catId) ?? null;
      const stale = opts.onlyFrom !== undefined && inNow !== opts.onlyFrom;
      if (stale || inNow === colonyId) {
        skipped++;
        continue;
      }
      const row = await writeObservation(tx, {
        catId,
        kind: "colony",
        value: { colonyId },
        accountId: person.id,
        roleAtTime: actingRole(person, "assign_cat_to_colony", await catTarget(catId, tx)),
        observedAt: new Date(),
      });
      written.push(row.id);
    }
    return { kind: "done", written, skipped };
  });
}

// ── Finding cats to add ────────────────────────────────────────────────────

export const ADD_SEARCH_LIMIT = 30;
const SEARCH_MAX = 100;

export interface CatToAdd {
  id: number;
  syr: string;
  name: string;
  thumbnailUrl: string | null;
  /** The colony the cat is in now, by name, or null for "no colony". */
  colony: { id: number; name: string } | null;
}

/**
 * Cats whose name contains `rawQuery` once folded, or whose SYR number it is,
 * best matches first, at most 30. The folded name is the database's own
 * generated column (cats.normalised_name), so no name is folded in
 * JavaScript. Each carries the colony it is in now.
 */
export async function searchCatsToAdd(rawQuery: string): Promise<CatToAdd[]> {
  const q = foldName(rawQuery.slice(0, SEARCH_MAX));
  if (q === "") return [];
  const syr = SYR_RE.exec(q);
  const syrId = syr ? Number(syr[1]) : null;

  // strpos, not LIKE: a % or _ typed into the box means itself.
  const rows = await db
    .select({
      id: catsTable.id,
      name: catsTable.name,
      photoPublicId: photosTable.publicId,
    })
    .from(catsTable)
    .leftJoin(photosTable, eq(photosTable.id, catsTable.primaryPhotoId))
    .where(
      or(
        sql`strpos(${catsTable.normalisedName}, ${q}) > 0`,
        syrId !== null ? eq(catsTable.id, syrId) : undefined,
      ),
    )
    .orderBy(
      sql`(case
        when ${syrId !== null ? sql`${catsTable.id} = ${syrId}` : sql`false`} then 0
        when ${catsTable.normalisedName} = ${q} then 1
        when strpos(${catsTable.normalisedName}, ${q}) = 1 then 2
        else 3 end)`,
      asc(catsTable.name),
      asc(catsTable.id),
    )
    .limit(ADD_SEARCH_LIMIT);
  if (rows.length === 0) return [];

  const inColony = await currentColonyOf(rows.map((r) => r.id));
  const names = await colonyNames([...new Set(inColony.values())]);
  return rows.map((r) => {
    const cid = inColony.get(r.id);
    return {
      id: r.id,
      syr: syrNumber(r.id),
      name: r.name,
      thumbnailUrl: r.photoPublicId ? teamPhotoUrl(r.photoPublicId) : null,
      colony: cid !== undefined && names.has(cid) ? { id: cid, name: names.get(cid)! } : null,
    };
  });
}

/** One colony's id and name, or null. */
export async function colonyRef(id: number): Promise<{ id: number; name: string } | null> {
  const [row] = await db
    .select({ id: coloniesTable.id, name: coloniesTable.name })
    .from(coloniesTable)
    .where(eq(coloniesTable.id, id));
  return row ?? null;
}

/** Colony names by id. */
export async function colonyNames(ids: readonly number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ id: coloniesTable.id, name: coloniesTable.name })
    .from(coloniesTable)
    .where(inArray(coloniesTable.id, [...ids]));
  for (const r of rows) out.set(r.id, r.name);
  return out;
}

/** Every colony by name, for the cat page's "Colony" list. */
export async function allColonyChoices(): Promise<{ id: number; name: string }[]> {
  return db
    .select({ id: coloniesTable.id, name: coloniesTable.name })
    .from(coloniesTable)
    .orderBy(asc(coloniesTable.normalisedName), asc(coloniesTable.id));
}
