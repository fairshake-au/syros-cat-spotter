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
 * - **A team answer that marked one of the spotter's answers wrong moves
 *   too** (Samuel's decision, 27 Oct 2026, review R3: "move the team's
 *   answer"): it is about the photo. The spotter's overruled answer is
 *   copied, then the team's is copied in its own author's name and role,
 *   superseding the spotter's copy, and withdrawn from the old cat. So on
 *   the new cat the team's answer still decides, and the spotter's never
 *   comes back on either cat. (The team's row carries no sighting id;
 *   migration 0053's insert rule lets a withdrawal replace a row that
 *   supersedes a row of the moved sighting, one hop, when that row has no
 *   sighting id and sits on the same cat as the row it superseded.)
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
 * Locks: the caller takes the spotter's badges lock (and credentials row)
 * before anything else in its transaction, before it touches the sighting,
 * as deletion does (§9.7 lock 1; `lockSpotterFirst`). Taken any later, a
 * move and a deletion could each hold what the other waits for. This
 * refuses to run without it (review of #380, finding 5). So a deletion of
 * the spotter either finishes first, and the copy carries no device, or
 * waits for the move, and then clears the copy too (spec test 6).
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

  // The rows of this sighting on the cats it leaves, locked, and every row
  // that supersedes one of them (the team's answers about the photo carry no
  // sighting id), locked too, and what supersedes those.
  await tx.execute(sql`select id from observations where sighting_id = ${move.sightingId} order by id for update`);
  const fromCats = new Set((await catsFeeding([move.fromCatId], {}, tx)).get(move.fromCatId)?.ids ?? [move.fromCatId]);
  const ofSighting = (await tx.select().from(observationsTable).where(eq(observationsTable.sightingId, move.sightingId))).filter(
    (o) => fromCats.has(o.catId),
  );
  const replacing = await supersedersOf(tx, ofSighting.map((o) => o.id));
  const overrulers = [...replacing.values()].flat().filter((t) => fromCats.has(t.catId) && !isSpotters(t, spotter) && !isMovedStatement(t));
  const replacingOverrulers = await supersedersOf(tx, overrulers.map((t) => t.id));
  const stands = (o: Observation, by: ReadonlyMap<number, Observation[]>) => (by.get(o.id) ?? []).length === 0;

  const copied: Observation[] = [];
  const withdrawn: Observation[] = [];
  const handled = new Set<number>();

  const copy = async (o: Observation, onto: { supersedesId: number; supersedeReason: string | null }) => {
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
        sightingId: move.sightingId,
        photoId: o.photoId,
        importRecordId: o.importRecordId,
        observedAt: o.observedAt,
        supersedesId: onto.supersedesId,
        supersedeReason: onto.supersedeReason,
        sightingMoveId: move.id,
        redactedAt: o.redactedAt,
        redactionReason: o.redactionReason,
      })
      .returning();
    copied.push(row!);
    return row!;
  };
  const withdraw = async (o: Observation) => {
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
    handled.add(o.id);
  };

  for (const o of [...ofSighting].sort((a, b) => a.id - b.id)) {
    if (!isSpotters(o, spotter) || assertsNothing(o.value)) continue;
    const by = replacing.get(o.id) ?? [];
    if (by.length === 0) {
      // The spotter's answer, standing: it goes with the photo.
      await copy(o, { supersedesId: o.id, supersedeReason: "moved" });
      continue;
    }
    // Overruled by the team (Samuel, 27 Oct 2026: "move the team's answer"):
    // the spotter's answer and the answer that overruled it both go, the
    // team's still in its own author's name and role and still overruling
    // the spotter's copy, so the spotter's answer doesn't come back on either
    // cat. Only when every row that replaced it is such an answer, standing.
    // Anything else (their own later change, an earlier move's copy, a
    // correction corrected since) is left as it is.
    const team = by.filter((t) => overrulers.includes(t));
    if (team.length !== by.length || !team.every((t) => stands(t, replacingOverrulers))) continue;
    const spottersCopy = await copy(o, { supersedesId: o.id, supersedeReason: "moved" });
    for (const t of team.sort((a, b) => a.id - b.id)) {
      await copy(t, { supersedesId: spottersCopy.id, supersedeReason: t.supersedeReason });
      await withdraw(t);
    }
  }

  // Everyone else's rows on the sighting, standing: withdrawn, not copied.
  for (const o of [...ofSighting].sort((a, b) => a.id - b.id)) {
    if (isSpotters(o, spotter) || handled.has(o.id) || assertsNothing(o.value) || !stands(o, replacing)) continue;
    await withdraw(o);
  }
  return { copied, withdrawn };
}

/** Every row superseding one of these, by the row it supersedes, locked. */
async function supersedersOf(tx: DbOrTx, ids: readonly number[]): Promise<Map<number, Observation[]>> {
  const out = new Map<number, Observation[]>();
  if (ids.length === 0) return out;
  await tx.execute(sql`select id from observations where supersedes_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) order by id for update`);
  const rows = await tx.select().from(observationsTable).where(inArray(observationsTable.supersedesId, [...ids]));
  for (const r of rows) out.set(r.supersedesId!, [...(out.get(r.supersedesId!) ?? []), r]);
  return out;
}

/**
 * The spotter's phone, which must already be under its badges lock in this
 * transaction (the caller took it first, `lockSpotterFirst`); refused
 * otherwise. Null for a sighting with nobody on it, which needs no lock.
 */
async function lockSpotter(tx: DbOrTx, move: SightingMove): Promise<string | null> {
  const device = await deviceOf(tx, move.sightingId);
  if (device === null) return null;
  if (!(await holdsBadgesLock(tx, device))) {
    throw new MoveStatementsRefused("take the spotter's badges lock before the move (lockSpotterFirst)");
  }
  return device;
}

/**
 * §9.7 lock 1, for a move's caller to run first in its transaction, before
 * it touches the sighting: the spotter's badges lock, then their credentials
 * row, the order deletion takes them. Returns the sighting's device as it
 * stands under the lock (null once a deletion that got there first cleared
 * it).
 */
export async function lockSpotterFirst(tx: DbOrTx, sightingId: number): Promise<string | null> {
  const before = await deviceOf(tx, sightingId);
  if (before === null) return null;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"badges:" + before}))`);
  await tx.execute(sql`select device_id from device_credentials where device_id = ${before} for share`);
  return deviceOf(tx, sightingId);
}

/**
 * {@link lockSpotterFirst} for several sightings at once (a split, or a
 * multi-select): every spotter's badges lock and credentials row, in device
 * order, so two moves sharing spotters queue rather than deadlock. Returns
 * each sighting's device as it stands under the locks (a device a deletion
 * cleared first is null; a device can only ever be cleared, never changed).
 */
export async function lockSpottersFirst(tx: DbOrTx, sightingIds: readonly number[]): Promise<Map<number, string | null>> {
  const ids = [...new Set(sightingIds)];
  if (ids.length === 0) return new Map();
  const before = await tx
    .select({ id: sightingsTable.id, deviceId: sightingsTable.deviceId })
    .from(sightingsTable)
    .where(inArray(sightingsTable.id, ids));
  const devices = [...new Set(before.map((s) => s.deviceId).filter((d): d is string => d !== null))].sort();
  for (const device of devices) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"badges:" + device}))`);
    await tx.execute(sql`select device_id from device_credentials where device_id = ${device} for share`);
  }
  const after = await tx
    .select({ id: sightingsTable.id, deviceId: sightingsTable.deviceId })
    .from(sightingsTable)
    .where(inArray(sightingsTable.id, ids));
  return new Map(after.map((s) => [s.id, s.deviceId]));
}

/** Does this transaction hold the device's badges lock? (pg_locks splits the 64-bit key into two halves.) */
async function holdsBadgesLock(tx: DbOrTx, device: string): Promise<boolean> {
  const r = await tx.execute<{ held: boolean }>(sql`
    select exists (
      select 1 from pg_locks l, (select hashtext(${"badges:" + device})::bigint as k) key
       where l.locktype = 'advisory'
         and l.pid = pg_backend_pid()
         and l.granted
         and l.objsubid = 1
         and l.classid::bigint = ((key.k >> 32) & 4294967295)
         and l.objid::bigint = (key.k & 4294967295)
    ) as held`);
  return r.rows[0]?.held === true;
}

async function deviceOf(tx: DbOrTx, sightingId: number): Promise<string | null> {
  const [s] = await tx.select({ deviceId: sightingsTable.deviceId }).from(sightingsTable).where(eq(sightingsTable.id, sightingId));
  if (!s) throw new MoveStatementsRefused(`no sighting ${sightingId}`);
  return s.deviceId;
}
