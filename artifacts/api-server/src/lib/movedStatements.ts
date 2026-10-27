import { observationsTable, sightingMovesTable, sightingsTable, type Observation, type SightingMove } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { catsFeeding } from "./catIdentity";
import type { DbOrTx } from "./observations";

/**
 * What a move does to the statements made about the moved sighting
 * (which-cat-is-which.md §5.7, §9.5). The only code that writes
 * `observations.sighting_move_id`: movedStatementsGuard.test.ts fails on any
 * other source file naming the column.
 *
 * - **The spotter's rows are copied** onto the cat the sighting moved to.
 *   The copy takes every column of the original except `cat_id` (the new
 *   cat), `supersedes_id` (the original), `supersede_reason = 'moved'`,
 *   `sighting_move_id` and `created_at` (now: the copy was entered now, so a
 *   look at the record as it stood before the move doesn't see it). It is
 *   still the spotter's answer, in their name and role, never the mover's:
 *   putting it in a team member's name would turn a spotter's guess into a
 *   team statement. A deleted spotter's row is copied as it is, with nobody
 *   on it.
 * - **Everyone else's rows are withdrawn**, not copied: a `{ retracted: true }`
 *   of the same kind on the original row's own cat, superseding it, in the
 *   mover's name, carrying the sighting's id and the original's
 *   `observed_at`, so it is never evidence of life. That person judged the
 *   photo as if it were the old cat.
 *
 * Only rows that still stand are touched (nothing supersedes them yet), and
 * only on the cats whose records count for the cat the sighting left. A row
 * that asserts nothing itself (a retraction, a claim withdrawn) is left
 * alone: what it took down stays down.
 *
 * The old cat stops counting a copied row because `loadCatRecords` lists the
 * copy among its rows as `elsewhere` (it replaces one of them).
 *
 * Locks: the spotter's badges lock and credentials row first (the order a
 * deletion takes them, §9.7), then the rows. So a deletion of the spotter
 * either finishes first, and the copy carries no device, or waits for the
 * move, and then clears the copy too (spec test 6).
 *
 * Must run in the transaction that wrote the move row and set
 * `app.sighting_move_id` to it: the observations trigger refuses the rows
 * otherwise. A merge's moves copy nothing (§9.5), so a merge or undo move is
 * refused here; the undo's late answers are PR 4.1's.
 */

/** A move this can't write statements for (a bug in the caller, never a person's mistake). */
export class MoveStatementsRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoveStatementsRefused";
  }
}

export interface MovedStatements {
  copied: Observation[];
  withdrawn: Observation[];
}

/** A statement a move wrote: a spotter's answer copied, or someone's withdrawn (it carries the move's id). */
export function isMovedStatement(o: Observation): boolean {
  return o.sightingMoveId != null;
}

/** A value that asserts nothing itself: a retraction or a claim withdrawn. */
function assertsNothing(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v["retracted"] === true || v["withdrawn"] === true;
}

/** The spotter's own answer: a public row from the sighting's own phone (both null once deleted). */
function isSpotters(o: Observation, spotter: string | null): boolean {
  return o.roleAtTime === "public" && o.accountId === null && o.deviceId === spotter;
}

export async function writeMovedObservation(tx: DbOrTx, moveId: number): Promise<MovedStatements> {
  const [move] = await tx.select().from(sightingMovesTable).where(eq(sightingMovesTable.id, moveId));
  if (!move) throw new MoveStatementsRefused(`no move ${moveId}`);
  if (move.mergeId !== null) throw new MoveStatementsRefused("a merge's moves copy no statements");
  if (move.movedByAccountId === null) throw new MoveStatementsRefused("the move names nobody");

  const spotter = await lockSpotter(tx, move);

  // The rows of this sighting that still stand, locked.
  await tx.execute(sql`select id from observations where sighting_id = ${move.sightingId} order by id for update`);
  const ofSighting = await tx.select().from(observationsTable).where(eq(observationsTable.sightingId, move.sightingId));
  const ids = ofSighting.map((o) => o.id);
  const replaced = new Set(
    ids.length === 0
      ? []
      : (
          await tx
            .select({ supersedesId: observationsTable.supersedesId })
            .from(observationsTable)
            .where(inArray(observationsTable.supersedesId, ids))
        ).map((r) => r.supersedesId),
  );
  const fromCats = new Set((await catsFeeding([move.fromCatId], {}, tx)).get(move.fromCatId)?.ids ?? [move.fromCatId]);
  const standing = ofSighting
    .filter((o) => !replaced.has(o.id) && fromCats.has(o.catId) && !assertsNothing(o.value))
    .sort((a, b) => a.id - b.id);

  const copied: Observation[] = [];
  const withdrawn: Observation[] = [];
  for (const o of standing) {
    if (isSpotters(o, spotter)) {
      const [row] = await tx
        .insert(observationsTable)
        .values({
          catId: move.toCatId,
          kind: o.kind,
          value: o.value as object,
          deviceId: o.deviceId,
          accountId: o.accountId,
          roleAtTime: o.roleAtTime,
          authorityScope: o.authorityScope,
          provenance: o.provenance,
          suggestedValue: o.suggestedValue as object | null,
          suggestionSource: o.suggestionSource,
          sightingId: o.sightingId,
          photoId: o.photoId,
          importRecordId: o.importRecordId,
          observedAt: o.observedAt,
          supersedesId: o.id,
          supersedeReason: "moved",
          sightingMoveId: move.id,
          redactedAt: o.redactedAt,
          redactionReason: o.redactionReason,
        })
        .returning();
      copied.push(row!);
    } else {
      const [row] = await tx
        .insert(observationsTable)
        .values({
          catId: o.catId,
          kind: o.kind,
          value: { retracted: true },
          accountId: move.movedByAccountId,
          roleAtTime: move.roleAtTime,
          sightingId: move.sightingId,
          observedAt: o.observedAt,
          supersedesId: o.id,
          supersedeReason: "moved",
          sightingMoveId: move.id,
        })
        .returning();
      withdrawn.push(row!);
    }
  }
  return { copied, withdrawn };
}

/**
 * The spotter's phone, read under its badges lock and credentials row (the
 * order deletion takes them, so nothing waits in a circle). Read again after
 * the lock: a deletion that got there first has cleared it. Null for a
 * sighting with nobody on it.
 */
async function lockSpotter(tx: DbOrTx, move: SightingMove): Promise<string | null> {
  const before = await deviceOf(tx, move.sightingId);
  if (before === null) return null;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"badges:" + before}))`);
  await tx.execute(sql`select device_id from device_credentials where device_id = ${before} for share`);
  return deviceOf(tx, move.sightingId);
}

async function deviceOf(tx: DbOrTx, sightingId: number): Promise<string | null> {
  const [s] = await tx.select({ deviceId: sightingsTable.deviceId }).from(sightingsTable).where(eq(sightingsTable.id, sightingId));
  if (!s) throw new MoveStatementsRefused(`no sighting ${sightingId}`);
  return s.deviceId;
}
