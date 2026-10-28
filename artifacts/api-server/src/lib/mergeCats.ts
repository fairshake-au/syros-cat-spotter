import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  catIdentityTable,
  catsTable,
  db,
  duplicateDecisionsTable,
  notificationsTable,
  sightingMovesTable,
  sightingsTable,
} from "@workspace/db";
import { actingRole, can, type CapabilityHolder } from "./capabilities";
import { catTarget } from "./capabilityTargets";
import { canonicalCatOf, mergeRecord, type MergeRecord } from "./catIdentity";
import { newestActiveOwnerHomed } from "./claiming";
import { countingPhones } from "./countingPhone";
import { DELETED_PREFIX } from "./deviceAuth";
import { lockPhonesFirst, writeMovedObservation } from "./movedStatements";
import { rebaselineNews } from "./news/nightly";
import type { DbOrTx } from "./observations";
import { POINTS_DUPLICATE } from "./points";
import { TEAM_DESK_DEVICE } from "./teamDesk";
import { athensDay, weekStartAthens } from "./weeks";

/**
 * The team's "these two records are the same cat" (which-cat-is-which.md §4,
 * §9.7 merge and undo; SYC-59 PR 4.1). Mimi is merged into Agatha: one
 * `cat_identity` row says "Mimi is Agatha", which every reader follows
 * (lib/catIdentity.ts, §9.3), and every resolved sighting of Mimi is filed
 * under Agatha by a `merged` move. Nothing is copied or deleted: Mimi's
 * statements count for Agatha through the merge row, so a merge's moves copy
 * no statements (§9.5), and an undo is another row.
 *
 * **One transaction each, READ COMMITTED** (the database default, never
 * raised): the deferred "no sighting left" check on `cat_identity` (migration
 * 0053) takes the merged-away cat FOR UPDATE at commit and must see a resolve
 * that committed meanwhile, which a snapshot taken at the start would hide.
 *
 * **Locks, in this order** (§9.7), the order deleting a person and moving a
 * sighting take them, so none of them waits in a circle:
 * 1. each phone involved, in device order: its badges lock and credentials
 *    row (`lockPhonesFirst`). The phones are the spotters of the sightings
 *    that move, and, on a merge, the phones it pays (their points change);
 * 2. each spotter's `sighting-answers` lock on both cats (the answers route's
 *    lock), so a late answer waits and then lands where the sighting is;
 * 3. the sightings that move, `FOR UPDATE`, in id order;
 * 4. the cats, `FOR UPDATE`, in id order; then what the screen expected is
 *    read again (counts, owners, names, the merges standing);
 * 5. the statements carrying those sightings' ids, `FOR UPDATE`.
 *
 * A refusal ({@link MergeRefused}) is thrown inside the transaction, so
 * nothing written stays.
 */

export type MergeRefusalCode =
  | "NOT_AUTHORISED"
  | "NOT_FOUND"
  | "SAME_CAT"
  | "ALREADY_MERGED"
  | "TWO_OWNERS"
  | "OWNER_MUST_STAY"
  | "NAME_PENDING_MUST_GO"
  | "STALE"
  | "ALREADY_UNDONE"
  | "UNDO_LATER_MERGE_FIRST"
  | "NOT_TO_MOVE";

export class MergeRefused extends Error {
  constructor(
    readonly code: MergeRefusalCode,
    message: string,
    readonly extra: { catId?: number; current?: { sightingId: number; catId: number | null }[] } = {},
  ) {
    super(message);
    this.name = "MergeRefused";
  }
}

/** The words for each refusal (spec §4.1, §4.5, §6). */
export const MERGE_WORDS = {
  notFound: "That cat or merge doesn't exist.",
  sameCat: "Those are the same record already.",
  alreadyMerged: (name: string) => `${name} is already part of another cat. Open that cat instead.`,
  twoOwners: "Both cats have an owner. Remove one owner first.",
  ownerMustStay: (name: string) => `${name} has an owner, so ${name}'s record stays. Switch which record stays.`,
  namePendingMustGo: (name: string) => `${name}'s name is still waiting for a spotter, so it can't stay over a named record. Name ${name} first, or switch which record stays.`,
  stale: "Someone changed this a moment ago.",
  alreadyUndone: "This merge has been undone already.",
  undoLaterFirst: (middle: string, last: string) => `Undo ${middle}'s merge into ${last} first.`,
  notToMove: "Only sightings filed under the cat since the merge, or moved by it, can be ticked.",
  merged: (from: string, to: string) => `${from} and ${to} turned out to be the same cat. You now follow ${to}.`,
  duplicatePoints: (from: string, to: string) =>
    `You spotted that ${from} and ${to} are the same cat. Syros Cats agreed. +${POINTS_DUPLICATE} points.`,
} as const;

export interface MergeInput {
  survivorId: number;
  mergedId: number;
  /** What the screen showed: [the survivor's resolved sightings, the merged-away cat's]. */
  expectedSightingCounts: [number, number];
  reasonText: string;
  survivorChosen: "default" | "switched";
}

export interface MergeDone {
  mergeId: number;
  survivorId: number;
  mergedId: number;
  batchId: string;
  moved: number[];
  /** Phones that now follow the survivor because of the merge. */
  followsAdded: string[];
  /** Phones paid for reporting the pair (§3.4). */
  paid: string[];
}

export interface UndoInput {
  reasonText: string;
  /** Post-merge sightings, and ones moved again since, ticked as Mimi's (§4.4). */
  alsoMoveSightingIds: number[];
}

export interface UndoDone {
  undoId: number;
  mergeId: number;
  catId: number;
  survivorId: number;
  batchId: string;
  movedBack: number[];
  alsoMoved: number[];
  followsRemoved: number;
}

type Person = CapabilityHolder & { id: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type MergeOutcome = ({ ok: true } & MergeDone) | { ok: false; refused: MergeRefused };
export type UndoOutcome = ({ ok: true } & UndoDone) | { ok: false; refused: MergeRefused };

/** The route's call: the merge in its own transaction. */
export async function mergeCats(person: Person, input: MergeInput): Promise<MergeOutcome> {
  try {
    return { ok: true, ...(await db.transaction((tx) => mergeCatsIn(tx, person, input))) };
  } catch (err) {
    if (err instanceof MergeRefused) return { ok: false, refused: err };
    throw err;
  }
}

/** The route's call: the undo in its own transaction. */
export async function undoMerge(person: Person, mergeId: number, input: UndoInput): Promise<UndoOutcome> {
  try {
    return { ok: true, ...(await db.transaction((tx) => undoMergeIn(tx, person, mergeId, input))) };
  } catch (err) {
    if (err instanceof MergeRefused) return { ok: false, refused: err };
    throw err;
  }
}

const idList = (ids: readonly number[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);
const pairOf = (a: number, b: number) => ({ low: Math.min(a, b), high: Math.max(a, b) });

/** A phone the merge may tell or pay: never a deleted phone's leftover row, never the team desk. */
const isPerson = (d: string | null): d is string => d !== null && !d.startsWith(DELETED_PREFIX) && d !== TEAM_DESK_DEVICE;

async function resolvedSightings(tx: DbOrTx, catId: number) {
  return tx
    .select({ id: sightingsTable.id, deviceId: sightingsTable.deviceId })
    .from(sightingsTable)
    .where(and(eq(sightingsTable.catId, catId), eq(sightingsTable.status, "resolved")))
    .orderBy(asc(sightingsTable.id));
}

/** Phones with a "same cat" answer about this pair, from "Are these the same cat?", dated before `before`. */
async function reportersOf(tx: DbOrTx, pair: { low: number; high: number }, before: Date | null): Promise<string[]> {
  const r = await tx.execute<{ device_id: string }>(sql`
    select distinct device_id from duplicate_reports
     where cat_low = ${pair.low} and cat_high = ${pair.high}
       and source = 'spotter_question' and says = 'same'
       and device_id is not null
       and (${before}::timestamptz is null or created_at < ${before}::timestamptz)`);
  return r.rows.map((row) => row.device_id).filter(isPerson);
}

/** Does the cat have an owner: the owner link, or an owner's "has a home" still standing (one deletion unlinked)? */
async function hasOwner(tx: DbOrTx, cat: { id: number; ownerDeviceId: string | null }): Promise<boolean> {
  return cat.ownerDeviceId !== null || (await newestActiveOwnerHomed(tx, cat.id, null)) !== null;
}

/**
 * D7: the record that stays by default is the earlier one, unless its name
 * is still pending and the other's isn't, in which case the named one.
 */
function defaultSurvivor(
  a: { id: number; createdAt: Date; namePending: boolean },
  b: { id: number; createdAt: Date; namePending: boolean },
): number {
  const [earlier, later] = a.createdAt.getTime() < b.createdAt.getTime() || (a.createdAt.getTime() === b.createdAt.getTime() && a.id < b.id) ? [a, b] : [b, a];
  return earlier.namePending && !later.namePending ? later.id : earlier.id;
}

/** Each spotter's answers lock on each of these cats (lock 2), devices then cats in order. */
async function lockAnswers(tx: DbOrTx, devices: readonly string[], catIds: readonly number[]): Promise<void> {
  const cats = [...new Set(catIds)].sort((a, b) => a - b);
  for (const device of [...new Set(devices)].sort()) {
    for (const catId of cats) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sighting-answers:${device}`}), ${catId})`);
    }
  }
}

/**
 * Merge Mimi (`mergedId`) into Agatha (`survivorId`), inside a transaction
 * the caller holds (the route opens one; a test holds one open to race it).
 * Throws {@link MergeRefused}.
 */
export async function mergeCatsIn(tx: Tx, person: Person, input: MergeInput): Promise<MergeDone> {
  if (!can(person, "merge_cats")) throw new MergeRefused("NOT_AUTHORISED", "Not authorised");
  const { survivorId, mergedId } = input;
  if (survivorId === mergedId) throw new MergeRefused("SAME_CAT", MERGE_WORDS.sameCat);

  // 1. Both canonically (§9.7 merge step 1), before the locks; read again under them.
  await refuseUnlessStandingAlone(tx, survivorId, mergedId);
  const pair = pairOf(survivorId, mergedId);

  // Who the merge touches, as far as can be told before the locks: the
  // spotters of the sightings that move, and the phones it may pay.
  const before = await resolvedSightings(tx, mergedId);
  const spotters = before.map((s) => s.deviceId);
  const reporters = await reportersOf(tx, pair, null);

  // Lock 1: every one of those phones, in device order.
  const locked = new Set(await lockPhonesFirst(tx, [...spotters, ...reporters]));
  // Lock 2: the spotters' answers locks, on both cats.
  await lockAnswers(tx, spotters.filter((d): d is string => d !== null), [survivorId, mergedId]);
  // Lock 3: the sightings that move, in id order.
  if (before.length > 0) {
    await tx.execute(sql`select id from sightings where id in (${idList(before.map((s) => s.id))}) order by id for update`);
  }
  // Lock 4: the two cats, in id order, then everything read again.
  await tx.execute(sql`select id from cats where id in (${idList([pair.low, pair.high])}) order by id for update`);
  await refuseUnlessStandingAlone(tx, survivorId, mergedId);
  const cats = await tx.select().from(catsTable).where(inArray(catsTable.id, [survivorId, mergedId]));
  const survivor = cats.find((c) => c.id === survivorId);
  const merged = cats.find((c) => c.id === mergedId);
  if (!survivor || !merged) throw new MergeRefused("NOT_FOUND", MERGE_WORDS.notFound);

  // What the screen showed must still be true (§6, §9.7 merge step 1).
  const sightings = await resolvedSightings(tx, mergedId);
  const [survivorCount] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(sightingsTable)
    .where(and(eq(sightingsTable.catId, survivorId), eq(sightingsTable.status, "resolved")));
  if (
    survivorCount!.n !== input.expectedSightingCounts[0] ||
    sightings.length !== input.expectedSightingCounts[1] ||
    sightings.some((s) => !before.some((b) => b.id === s.id))
  ) {
    throw new MergeRefused("STALE", MERGE_WORDS.stale);
  }

  // Lock 5: the statements carrying those sightings' ids.
  if (sightings.length > 0) {
    await tx.execute(sql`select id from observations where sighting_id in (${idList(sightings.map((s) => s.id))}) order by id for update`);
  }

  // Owners never move (§4.1); a pending name never stays over a named record.
  const survivorOwned = await hasOwner(tx, survivor);
  const mergedOwned = await hasOwner(tx, merged);
  if (survivorOwned && mergedOwned) throw new MergeRefused("TWO_OWNERS", MERGE_WORDS.twoOwners);
  if (mergedOwned) throw new MergeRefused("OWNER_MUST_STAY", MERGE_WORDS.ownerMustStay(merged.name), { catId: mergedId });
  if (survivor.namePending && !merged.namePending) {
    throw new MergeRefused("NAME_PENDING_MUST_GO", MERGE_WORDS.namePendingMustGo(survivor.name), { catId: survivorId });
  }

  const role = actingRole(person, "merge_cats", await catTarget(survivorId, tx));

  // 2. The merge row and the setting (§9.4). Which record stays is written as
  // what it was, worked out here, never as the screen said.
  const [mergeRow] = await tx
    .insert(catIdentityTable)
    .values({
      catId: mergedId,
      canonicalCatId: survivorId,
      reason: "merge",
      reasonText: input.reasonText,
      byAccountId: person.id,
      roleAtTime: role,
      survivorChosen: defaultSurvivor(survivor, merged) === survivorId ? "default" : "switched",
    })
    .returning({ id: catIdentityTable.id, createdAt: catIdentityTable.createdAt });
  const mergeId = mergeRow!.id;
  await tx.execute(sql`select set_config('app.cat_merge_id', ${String(mergeId)}, true)`);

  // 3. Every resolved sighting of Mimi is filed under Agatha, one `merged`
  // move each, one batch. No statements are copied (§9.5).
  const batchId = randomUUID();
  for (const s of sightings) {
    await tx.insert(sightingMovesTable).values({
      sightingId: s.id,
      fromCatId: mergedId,
      toCatId: survivorId,
      mergeId,
      batchId,
      reason: "merged",
      source: "merge",
      movedByAccountId: person.id,
      roleAtTime: role,
    });
    await tx.update(sightingsTable).set({ catId: survivorId }).where(eq(sightingsTable.id, s.id));
  }

  // 4. Follows and unfollows carry over, each row actually written recorded
  // so an undo can take back exactly those (§9.7 merge step 4).
  const followsAdded = await carryFollows(tx, mergeId, mergedId, survivorId);

  // 5. Owners are never copied (§4.1): nothing to do.

  // 6. The decision, then points to each counting phone that said "same cat"
  // about this pair before the merge, once per phone and pair, ever (§3.4, §9.8).
  await tx.insert(duplicateDecisionsTable).values({ catLow: pair.low, catHigh: pair.high, decision: "merged", mergeId, byAccountId: person.id });
  const paid = await payReporters(tx, {
    pair,
    survivorId,
    reporters: (await reportersOf(tx, pair, mergeRow!.createdAt)).filter((d) => locked.has(d)),
    at: mergeRow!.createdAt,
  });

  // 7. A merge is a correction, never news (§9.12).
  await rebaselineNews([mergedId, survivorId], tx);

  // 8. The in-app lines (D4, D10). Never pushed: nothing here calls the push sender.
  const followers = await followersToTell(tx, mergedId, survivorId);
  const lines = [
    ...followers.map((deviceId) => ({ deviceId, kind: "merged", message: MERGE_WORDS.merged(merged.name, survivor.name) })),
    ...paid.map((deviceId) => ({ deviceId, kind: "duplicate_points", message: MERGE_WORDS.duplicatePoints(merged.name, survivor.name) })),
  ];
  if (lines.length > 0) await tx.insert(notificationsTable).values(lines);

  return { mergeId, survivorId, mergedId, batchId, moved: sightings.map((s) => s.id), followsAdded, paid };
}

/**
 * Both cats exist and stand alone: neither is merged into another now (the
 * screen showed two cats; if either has gone, the screen is out of date).
 */
async function refuseUnlessStandingAlone(tx: DbOrTx, survivorId: number, mergedId: number): Promise<void> {
  const canonical = await canonicalCatOf([survivorId, mergedId], {}, tx);
  const exists = await tx.select({ id: catsTable.id, name: catsTable.name }).from(catsTable).where(inArray(catsTable.id, [survivorId, mergedId]));
  for (const id of [mergedId, survivorId]) {
    const cat = exists.find((c) => c.id === id);
    const c = canonical.get(id);
    if (!cat || c == null) throw new MergeRefused("NOT_FOUND", MERGE_WORDS.notFound);
    if (c !== id) throw new MergeRefused("ALREADY_MERGED", MERGE_WORDS.alreadyMerged(cat.name), { catId: c });
  }
}

/**
 * §9.7 merge step 4: each follower of Mimi follows Agatha, unless they had
 * unfollowed Agatha (unfollows win); each phone that unfollowed Mimi is
 * recorded as having unfollowed Agatha too, unless it follows Agatha. A
 * deleted phone's leftover row and the team desk are skipped. Only rows
 * actually written are recorded in `merge_follow_changes`, with their
 * `created_at`, so an undo removes only those still the same.
 */
async function carryFollows(tx: DbOrTx, mergeId: number, mergedId: number, survivorId: number): Promise<string[]> {
  // Recorded in the same statement, so `row_created_at` keeps the row's
  // exact time (microseconds; a JavaScript date would round it, and the
  // undo's "same created_at" would never match).
  const follows = await tx.execute<{ device_id: string }>(sql`
    with added as (
      insert into cat_subscriptions (device_id, cat_id)
      select f.device_id, ${survivorId}
        from cat_subscriptions f
       where f.cat_id = ${mergedId}
         and f.device_id not like ${DELETED_PREFIX + "%"}
         and f.device_id <> ${TEAM_DESK_DEVICE}
         and not exists (select 1 from cat_unfollows u where u.device_id = f.device_id and u.cat_id = ${survivorId})
       order by f.device_id
      on conflict do nothing
      returning device_id, created_at)
    insert into merge_follow_changes (merge_id, device_id, kind, row_created_at)
    select ${mergeId}, device_id, 'follow', created_at from added
    returning device_id`);
  await tx.execute(sql`
    with added as (
      insert into cat_unfollows (device_id, cat_id)
      select u.device_id, ${survivorId}
        from cat_unfollows u
       where u.cat_id = ${mergedId}
         and u.device_id not like ${DELETED_PREFIX + "%"}
         and u.device_id <> ${TEAM_DESK_DEVICE}
         and not exists (select 1 from cat_subscriptions s where s.device_id = u.device_id and s.cat_id = ${survivorId})
       order by u.device_id
      on conflict do nothing
      returning device_id, created_at)
    insert into merge_follow_changes (merge_id, device_id, kind, row_created_at)
    select ${mergeId}, device_id, 'unfollow', created_at from added`);
  return follows.rows.map((r) => r.device_id).sort();
}

/** Mimi's followers who now follow Agatha (D4: "You now follow Agatha"). */
async function followersToTell(tx: DbOrTx, mergedId: number, survivorId: number): Promise<string[]> {
  const r = await tx.execute<{ device_id: string }>(sql`
    select f.device_id from cat_subscriptions f
      join cat_subscriptions s on s.device_id = f.device_id and s.cat_id = ${survivorId}
     where f.cat_id = ${mergedId}
     order by f.device_id`);
  return r.rows.map((row) => row.device_id).filter(isPerson);
}

/**
 * §9.8: 10 points to each counting phone (lib/countingPhone.ts) among the
 * reporters, once per phone and pair, ever: a ledger row with the pair
 * (`duplicate_cat_low/high`, `source = 'duplicate'`), unique per phone and
 * pair, so undoing and making the merge again never pays twice; and
 * `profiles.points` up by the same, under the badges lock taken first. The
 * row carries the survivor's cat and the merge's Athens day and week: it
 * counts on the week board, never as an active week or a spotted cat.
 */
async function payReporters(
  tx: DbOrTx,
  input: { pair: { low: number; high: number }; survivorId: number; reporters: string[]; at: Date },
): Promise<string[]> {
  const counting = await countingPhones(input.reporters, {}, tx);
  const paid: string[] = [];
  for (const deviceId of [...counting].sort()) {
    const row = await tx.execute<{ id: number }>(sql`
      insert into points_ledger
        (device_id, sighting_id, duplicate_cat_low, duplicate_cat_high, cat_id, points, athens_day, week_start, earned_at, source)
      values
        (${deviceId}, null, ${input.pair.low}, ${input.pair.high}, ${input.survivorId}, ${POINTS_DUPLICATE},
         ${athensDay(input.at)}::date, ${weekStartAthens(input.at)}::date, ${input.at}, 'duplicate')
      on conflict (device_id, duplicate_cat_low, duplicate_cat_high) do nothing
      returning id`);
    if (row.rows.length === 0) continue;
    await tx.execute(sql`
      insert into profiles (device_id, points) values (${deviceId}, ${POINTS_DUPLICATE})
      on conflict (device_id) do update set points = profiles.points + ${POINTS_DUPLICATE}`);
    paid.push(deviceId);
  }
  return paid;
}

/**
 * Undo merge `mergeId` (§4.4, §9.7 undo), inside a transaction the caller
 * holds. Throws {@link MergeRefused}.
 *
 * - Refused while the merge's survivor is itself merged away (§4.5: merges
 *   are undone newest first, `UNDO_LATER_MERGE_FIRST`).
 * - Every sighting whose newest move is this merge's `merged` move goes back
 *   (`merge_undone`), with any late answer (§9.5). Ticked sightings (filed
 *   under the survivor since the merge, or moved by it and moved again since)
 *   go to Mimi as ordinary moves, statements and all.
 * - Follows and unfollows the merge added go, unless changed since.
 * - Points stay (§3.4). The pair is marked `merge_undone`.
 */
export async function undoMergeIn(tx: Tx, person: Person, mergeId: number, input: UndoInput): Promise<UndoDone> {
  if (!can(person, "merge_cats")) throw new MergeRefused("NOT_AUTHORISED", "Not authorised");
  const merge = await mergeRecord(mergeId, tx);
  if (!merge) throw new MergeRefused("NOT_FOUND", MERGE_WORDS.notFound);
  const mimi = merge.catId;
  const agatha = merge.canonicalCatId;

  // Who the undo touches, before the locks: the merge's own sightings still
  // standing where it filed them, and the ticked ones.
  const ownBefore = await ownMoves(tx, merge);
  const ticked = [...new Set(input.alsoMoveSightingIds)].filter((id) => !ownBefore.includes(id)).sort((a, b) => a - b);
  const all = [...ownBefore, ...ticked].sort((a, b) => a - b);
  const before = all.length === 0 ? [] : await tx.select().from(sightingsTable).where(inArray(sightingsTable.id, all));
  if (before.length !== all.length) throw new MergeRefused("NOT_TO_MOVE", MERGE_WORDS.notToMove);

  // Lock 1: the spotters, in device order (deletion's order).
  const spotters = (await lockPhonesFirst(tx, before.map((s) => s.deviceId))).filter(Boolean);
  // Lock 2: their answers locks, on every cat a sighting leaves or joins.
  const fromCats = [...new Set(before.map((s) => s.catId).filter((c): c is number => c !== null))];
  await lockAnswers(tx, spotters, [mimi, agatha, ...fromCats]);
  // Lock 3: the sightings, in id order, then as they are now.
  if (all.length > 0) await tx.execute(sql`select id from sightings where id in (${idList(all)}) order by id for update`);
  const now = all.length === 0 ? [] : await tx.select().from(sightingsTable).where(inArray(sightingsTable.id, all));
  const current = now.map((s) => ({ sightingId: s.id, catId: s.catId }));
  // Lock 4: the cats, in id order, then the merge read again.
  const catIds = [...new Set([mimi, agatha, ...now.map((s) => s.catId).filter((c): c is number => c !== null)])].sort((a, b) => a - b);
  await tx.execute(sql`select id from cats where id in (${idList(catIds)}) order by id for update`);
  const fresh = await mergeRecord(mergeId, tx);
  if (!fresh) throw new MergeRefused("NOT_FOUND", MERGE_WORDS.notFound);
  if (fresh.undoneBy !== null) throw new MergeRefused("ALREADY_UNDONE", MERGE_WORDS.alreadyUndone);

  // §4.5: newest first. While Agatha is part of Dora, Mimi's merge waits.
  const agathaNow = (await canonicalCatOf([agatha], {}, tx)).get(agatha);
  if (agathaNow !== agatha) {
    const names = await tx
      .select({ id: catsTable.id, name: catsTable.name })
      .from(catsTable)
      .where(inArray(catsTable.id, [agatha, ...(agathaNow == null ? [] : [agathaNow])]));
    const nameOf = (id: number | null | undefined) => names.find((n) => n.id === id)?.name ?? "this cat";
    throw new MergeRefused("UNDO_LATER_MERGE_FIRST", MERGE_WORDS.undoLaterFirst(nameOf(agatha), nameOf(agathaNow)), {
      catId: agathaNow ?? undefined,
    });
  }

  // What the screen listed must still be true.
  const own = await ownMoves(tx, fresh);
  if (own.length !== ownBefore.length || own.some((id) => !ownBefore.includes(id))) {
    throw new MergeRefused("STALE", MERGE_WORDS.stale, { current });
  }
  for (const s of now.filter((x) => own.includes(x.id))) {
    if (s.status !== "resolved" || s.catId !== agatha) throw new MergeRefused("STALE", MERGE_WORDS.stale, { current });
  }
  const movedByMerge = new Set(await movedByThisMerge(tx, mergeId, ticked));
  const tickedNow = now.filter((x) => ticked.includes(x.id));
  const tickedCanonical = await canonicalCatOf(tickedNow.map((s) => s.catId).filter((c): c is number => c !== null), {}, tx);
  for (const s of tickedNow) {
    const where = s.catId === null ? null : tickedCanonical.get(s.catId);
    const sinceMerge = s.createdAt.getTime() > merge.createdAt.getTime() && where === agatha;
    if (s.status !== "resolved" || s.catId === null || where == null || where === mimi || !(sinceMerge || movedByMerge.has(s.id))) {
      throw new MergeRefused("NOT_TO_MOVE", MERGE_WORDS.notToMove, { current });
    }
  }

  // Lock 5: the statements carrying those sightings' ids.
  if (all.length > 0) await tx.execute(sql`select id from observations where sighting_id in (${idList(all)}) order by id for update`);

  const role = actingRole(person, "merge_cats", await catTarget(mimi, tx));

  // The undo row and the setting.
  const [undo] = await tx
    .insert(catIdentityTable)
    .values({
      catId: mimi,
      canonicalCatId: mimi,
      supersedesId: mergeId,
      reason: "undo",
      reasonText: input.reasonText,
      byAccountId: person.id,
      roleAtTime: role,
    })
    .returning({ id: catIdentityTable.id });
  const undoId = undo!.id;
  await tx.execute(sql`select set_config('app.cat_merge_id', ${String(undoId)}, true)`);

  // The merge's own moves go back, each with its late answers (§9.5).
  const batchId = randomUUID();
  for (const sightingId of own) {
    const [move] = await tx
      .insert(sightingMovesTable)
      .values({
        sightingId,
        fromCatId: agatha,
        toCatId: mimi,
        mergeId: undoId,
        batchId,
        reason: "merge_undone",
        source: "undo",
        movedByAccountId: person.id,
        roleAtTime: role,
      })
      .returning({ id: sightingMovesTable.id });
    await tx.execute(sql`select set_config('app.sighting_move_id', ${String(move!.id)}, true)`);
    await tx.update(sightingsTable).set({ catId: mimi }).where(eq(sightingsTable.id, sightingId));
    await writeMovedObservation(tx, move!.id);
  }

  // Ticked sightings: ordinary moves to Mimi, in the same batch.
  for (const s of [...tickedNow].sort((a, b) => a.id - b.id)) {
    const [move] = await tx
      .insert(sightingMovesTable)
      .values({
        sightingId: s.id,
        fromCatId: s.catId!,
        toCatId: mimi,
        batchId,
        reason: "other",
        reasonText: input.reasonText,
        source: "undo",
        movedByAccountId: person.id,
        roleAtTime: role,
      })
      .returning({ id: sightingMovesTable.id });
    await tx.execute(sql`select set_config('app.sighting_move_id', ${String(move!.id)}, true)`);
    await tx.update(sightingsTable).set({ catId: mimi }).where(eq(sightingsTable.id, s.id));
    await writeMovedObservation(tx, move!.id);
  }

  // Follows and unfollows the merge added, if still exactly as it left them.
  const followsRemoved = await takeBackFollows(tx, mergeId, agatha);

  await tx.insert(duplicateDecisionsTable).values({
    catLow: Math.min(mimi, agatha),
    catHigh: Math.max(mimi, agatha),
    decision: "merge_undone",
    mergeId: undoId,
    byAccountId: person.id,
  });

  // Never news (§9.12).
  await rebaselineNews(catIds, tx);

  return { undoId, mergeId, catId: mimi, survivorId: agatha, batchId, movedBack: own, alsoMoved: tickedNow.map((s) => s.id).sort((a, b) => a - b), followsRemoved };
}

/**
 * The sightings this merge filed under the survivor that are still there
 * as it left them (§9.7 undo: "every sighting whose newest move row is this
 * merge's `merged` move"): moved by this merge, filed under the survivor
 * now, and moved since only by later merges and their undos (Agatha merged
 * into Dora and undone again puts them back where this merge left them;
 * §4.5). A sighting the team moved since, even back again, is not: it is
 * listed for ticking instead.
 */
async function ownMoves(tx: DbOrTx, merge: MergeRecord): Promise<number[]> {
  const r = await tx.execute<{ sighting_id: number }>(sql`
    select m.sighting_id from sighting_moves m
      join sightings s on s.id = m.sighting_id
     where m.merge_id = ${merge.id}
       and m.reason = 'merged'
       and s.cat_id = m.to_cat_id
       and not exists (select 1 from sighting_moves later
                        where later.sighting_id = m.sighting_id
                          and later.id > m.id
                          and later.merge_id is null)
     order by m.sighting_id`);
  return r.rows.map((row) => Number(row.sighting_id));
}

/** Which of these sightings this merge moved (and something moved again since). */
async function movedByThisMerge(tx: DbOrTx, mergeId: number, sightingIds: readonly number[]): Promise<number[]> {
  if (sightingIds.length === 0) return [];
  const rows = await tx
    .select({ sightingId: sightingMovesTable.sightingId })
    .from(sightingMovesTable)
    .where(and(eq(sightingMovesTable.mergeId, mergeId), eq(sightingMovesTable.reason, "merged"), inArray(sightingMovesTable.sightingId, [...sightingIds])));
  return rows.map((r) => r.sightingId);
}

/**
 * §9.7 undo: the follow and unfollow rows the merge wrote go, only where
 * the row is still there with the same `created_at`. A row someone removed
 * and made again after the merge is theirs, and stays.
 */
async function takeBackFollows(tx: DbOrTx, mergeId: number, survivorId: number): Promise<number> {
  const follows = await tx.execute(sql`
    delete from cat_subscriptions s
     using merge_follow_changes c
     where c.merge_id = ${mergeId} and c.kind = 'follow'
       and s.device_id = c.device_id and s.cat_id = ${survivorId} and s.created_at = c.row_created_at
    returning s.device_id`);
  const unfollows = await tx.execute(sql`
    delete from cat_unfollows s
     using merge_follow_changes c
     where c.merge_id = ${mergeId} and c.kind = 'unfollow'
       and s.device_id = c.device_id and s.cat_id = ${survivorId} and s.created_at = c.row_created_at
    returning s.device_id`);
  return follows.rows.length + unfollows.rows.length;
}
