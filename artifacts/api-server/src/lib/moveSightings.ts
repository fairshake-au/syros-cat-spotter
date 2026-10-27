import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  catsTable,
  db,
  observationsTable,
  photosTable,
  sightingMatchesTable,
  sightingMovesTable,
  sightingPhotosTable,
  sightingsTable,
  vetVisitPhotosTable,
  welfareReportsTable,
  type Observation,
} from "@workspace/db";
import { actingRole, can, type CapabilityHolder } from "./capabilities";
import { catTarget } from "./capabilityTargets";
import { canonicalCatOf, catsFeeding, observationCatIn } from "./catIdentity";
import { BLANK_NAME_BODY, catNamed, isUniqueViolation, NAME_TAKEN_WORDS, OFFENSIVE_NAME_WORDS } from "./catNames";
import { lockSpottersFirst, writeMovedObservation } from "./movedStatements";
import { rebaselineNews } from "./news/nightly";
import { writeObservation, type DbOrTx } from "./observations";
import { TEAM_DESK_DEVICE } from "./teamDesk";
import { syrNumber } from "./teamCatView";
import { NEW_CAT_NAME_MAX, newCatNameProblem } from "./vetVisits";
import { moveReportStateIn } from "./welfareActions";
import { kickRow } from "./mail/outbox";

/**
 * The team's "move this sighting to the right cat" (which-cat-is-which.md
 * §5, §9.7 move; SYC-150 PR 3.2). One or more sightings, all filed under one
 * cat, go to another cat or to a new one, in ONE transaction: everything in
 * a move is saved together, or none of it is (§6).
 *
 * **Locks, in this order** (§9.7), the order deleting a person takes them,
 * so a move and a deletion queue up and never wait in a circle:
 * 1. each spotter's badges lock and credentials row (`lockSpottersFirst`),
 *    before anything touches a sighting;
 * 2. each spotter's `sighting-answers` lock, on the cat the sightings leave
 *    and the cat they join, the lock the answers route takes, so an answer
 *    sent meanwhile waits and then goes to the cat the sighting is under;
 * 3. the sightings, `FOR UPDATE`, in id order, then their device, cat and
 *    status are read again: what the screen expected must still be true;
 * 4. the two cats, `FOR UPDATE`, in id order;
 * 5. the statements carrying those sightings' ids, `FOR UPDATE`.
 *
 * **Steps** (§9.7): resolve the cats canonically and check §6; make the new
 * cat if asked; for each sighting, oldest first, a move row (one batch id),
 * the setting, the sighting's cat and its statements (`writeMovedObservation`);
 * the old cat's main photo and map spot; follows; the report; the news
 * baselines; the match records' team step, in the same transaction.
 *
 * A refusal ({@link MoveRefused}) is thrown inside the transaction, so it
 * rolls back whatever was written.
 */

export const MOVE_REASONS_FROM_SCREEN = ["different_markings", "two_cats", "wrong_pick", "other"] as const;
export const MOVE_SOURCES_FROM_SCREEN = ["cat_page", "matched_by_hand", "report", "game"] as const;

export interface MoveInput {
  sightingIds: number[];
  /** The cat the screen showed them filed under. */
  expectedCatId: number;
  toCatId?: number;
  newCat?: { name?: string; letSpottersName: boolean };
  /** The old cat's new main photo, when one of the moved photos is its main photo; 0 = "No photo for now". */
  newMainPhotoId?: number;
  reason: (typeof MOVE_REASONS_FROM_SCREEN)[number];
  reasonText?: string;
  source: (typeof MOVE_SOURCES_FROM_SCREEN)[number];
  /** With `source: "report"`: the "That's a different cat" report's public id. */
  reportId?: string;
}

export type MoveRefusalCode =
  | "NOT_AUTHORISED"
  | "NOT_FOUND"
  | "NOT_RESOLVED"
  | "SAME_CAT"
  | "MOVED_ALREADY"
  | "MERGE_INSTEAD"
  | "ALREADY_ITS_OWN_CAT"
  | "MAIN_PHOTO_NEEDED"
  | "EMPTY_NAME"
  | "OFFENSIVE_NAME"
  | "SYR_SHAPED_NAME"
  | "NAME_TAKEN"
  | "REPORT_NOT_FOUND";

/** Where each sighting is filed now, for "Someone changed this a moment ago". */
export interface SightingNow {
  sightingId: number;
  catId: number | null;
  status: string;
}

export class MoveRefused extends Error {
  constructor(
    readonly code: MoveRefusalCode,
    message: string,
    readonly extra: { current?: SightingNow[]; cat?: { id: number; name: string } } = {},
  ) {
    super(message);
    this.name = "MoveRefused";
  }
}

/** The words for each refusal (spec §5.3, §6; the name refusals are the resolve route's). */
export const MOVE_WORDS = {
  notResolved: "This spot isn't matched to a cat yet. A spot still waiting for its spotter, or for Syros Cats to match it, gets matched, not moved.",
  sameCat: "That's the cat it's filed under already.",
  changed: "Someone changed this a moment ago.",
  mergeInstead: (from: string, to: string) =>
    `This is everything ${from} has, so ${from} and ${to} are the same cat. Merge ${from} into ${to}?`,
  alreadyItsOwnCat: (from: string) => `This is everything ${from} has, so it isn't a new cat: ${from} already is a cat of her own.`,
  mainPhotoNeeded: (from: string) => `This is ${from}'s main photo. Choose ${from}'s new main photo, or "No photo for now".`,
  notAPhotoOf: (from: string) => `Choose one of ${from}'s other photos, or "No photo for now".`,
  notFound: "That sighting or cat doesn't exist.",
  reportNotFound: "That report doesn't exist, or isn't a \"That's a different cat\" report.",
} as const;

export interface MoveDone {
  batchId: string;
  fromCatId: number;
  toCatId: number;
  madeNewCat: boolean;
  moves: { sightingId: number; moveId: number }[];
  /** An email closing the report queued, to send after the commit. */
  queued: number | null;
}

export type MoveOutcome = ({ ok: true } & MoveDone) | { ok: false; refused: MoveRefused };

type Person = CapabilityHolder & { id: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The route's call: the move in its own transaction, then the match records' team step. */
export async function moveSightings(person: Person, input: MoveInput): Promise<MoveOutcome> {
  let done: MoveDone;
  try {
    done = await db.transaction((tx) => moveSightingsIn(tx, person, input));
  } catch (err) {
    if (err instanceof MoveRefused) return { ok: false, refused: err };
    // Two new cats given one name at once: the loser is told, as at resolve.
    if (isUniqueViolation(err) && input.newCat?.name) {
      return { ok: false, refused: await nameTaken(input.newCat.name.trim()) };
    }
    throw err;
  }
  if (done.queued !== null) kickRow(done.queued);
  return { ok: true, ...done };
}

/**
 * The move's work inside a transaction the caller holds (the route opens one;
 * a test holds one open to race it). Throws {@link MoveRefused}.
 */
export async function moveSightingsIn(tx: Tx, person: Person, input: MoveInput): Promise<MoveDone> {
  if (!can(person, "move_sighting")) throw new MoveRefused("NOT_AUTHORISED", "Not authorised");
  const sightingIds = [...new Set(input.sightingIds)].sort((a, b) => a - b);
  // The role written on the move is the one that holds move_sighting where
  // the sightings are filed (island-wide today, so any team role's).
  const target = await catTarget(input.expectedCatId, tx);
  const role = actingRole(person, "move_sighting", target);

  // A new cat's typed name: the checks a cat's first name always gets
  // (vetVisits.ts, the resolve route's words), before any lock.
  const typedName = input.newCat?.name === undefined ? null : input.newCat.name.trim().slice(0, NEW_CAT_NAME_MAX);
  if (typedName !== null) refuseBadName(typedName);
  if (input.newCat && !input.newCat.letSpottersName && typedName === null) refuseBadName("");
  if (input.newCat && input.newCat.letSpottersName && typedName !== null) {
    throw new Error("moveSightingsIn: a typed name and \"Let spotters name it\" both");
  }

  // Where the sightings go, as far as can be told before the locks (it is
  // checked again under them).
  const toBefore = input.toCatId === undefined ? null : await canonicalOrRefuse(tx, input.toCatId);

  // 1. Each spotter's badges lock, before anything else (§9.7 lock 1).
  const devices = await lockSpottersFirst(tx, sightingIds);
  if (devices.size !== sightingIds.length) throw new MoveRefused("NOT_FOUND", MOVE_WORDS.notFound);

  // 2. Each spotter's answers lock, on both cats, in a fixed order.
  const spotters = [...new Set([...devices.values()].filter((d): d is string => d !== null))].sort();
  const answerCats = [...new Set([input.expectedCatId, ...(toBefore === null ? [] : [toBefore])])].sort((a, b) => a - b);
  for (const device of spotters) {
    for (const catId of answerCats) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sighting-answers:${device}`}), ${catId})`);
    }
  }

  // 3. The sightings, in id order, and what they are now.
  await tx.execute(sql`select id from sightings where id in (${idList(sightingIds)}) order by id for update`);
  const sightings = await tx.select().from(sightingsTable).where(inArray(sightingsTable.id, sightingIds));
  const current = sightings.map((s) => ({ sightingId: s.id, catId: s.catId, status: s.status }));
  if (sightings.some((s) => s.status !== "resolved" || s.catId === null)) {
    throw new MoveRefused("NOT_RESOLVED", MOVE_WORDS.notResolved, { current });
  }
  if (sightings.some((s) => s.catId !== input.expectedCatId)) {
    throw new MoveRefused("MOVED_ALREADY", MOVE_WORDS.changed, { current });
  }
  const fromCatId = input.expectedCatId;

  // 4. The two cats, in id order, then their canonical cats again: a merge
  //    finished meanwhile means the screen is out of date.
  const fromCanonical = (await canonicalCatOf([fromCatId], {}, tx)).get(fromCatId);
  if (toBefore !== null && toBefore === fromCanonical) throw new MoveRefused("SAME_CAT", MOVE_WORDS.sameCat);
  const catIds = [fromCatId, ...(toBefore === null ? [] : [toBefore])].sort((a, b) => a - b);
  await tx.execute(sql`select id from cats where id in (${idList(catIds)}) order by id for update`);
  if (toBefore !== null && (await canonicalOrRefuse(tx, input.toCatId!)) !== toBefore) {
    throw new MoveRefused("MOVED_ALREADY", MOVE_WORDS.changed, { current });
  }
  const [from] = await tx.select().from(catsTable).where(eq(catsTable.id, fromCatId));
  if (!from) throw new MoveRefused("NOT_FOUND", MOVE_WORDS.notFound);

  // 5. The statements carrying those sightings' ids.
  await tx.execute(sql`select id from observations where sighting_id in (${idList(sightingIds)}) order by id for update`);

  const movedPhotos = await photosOfSightings(tx, sightingIds);
  const mainMoves = from.primaryPhotoId > 0 && movedPhotos.has(from.primaryPhotoId);

  // Oldest first: on "It's a new cat" the oldest starts it (§5.5).
  const ordered = [...sightings].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
  const first = ordered[0]!;

  // The first sighting the cat had (its map spot came from it, D6).
  const [earliest] = await tx
    .select({ id: sightingsTable.id })
    .from(sightingsTable)
    .where(and(eq(sightingsTable.catId, fromCatId), eq(sightingsTable.status, "resolved")))
    .orderBy(asc(sightingsTable.createdAt), asc(sightingsTable.id))
    .limit(1);

  // Make the new cat, if asked (§9.7 move step 2).
  let toCatId: number;
  const madeNewCat = toBefore === null;
  if (madeNewCat) {
    if (typedName !== null) {
      const taken = await catNamed(typedName);
      if (taken) throw await nameTaken(typedName);
    }
    toCatId = await makeNewCat(tx, person, role, first, typedName);
  } else {
    toCatId = toBefore;
  }

  // The moves, one batch (§9.7 move steps 3–5).
  const batchId = randomUUID();
  const moves: MoveDone["moves"] = [];
  for (const s of ordered) {
    const startsCat = madeNewCat && s.id === first.id;
    const [move] = await tx
      .insert(sightingMovesTable)
      .values({
        sightingId: s.id,
        fromCatId,
        toCatId,
        // Only on the move that started the cat: hasMetCat's naming
        // exception (D3) reads it from the sighting's newest move.
        madeNewCat: startsCat,
        letSpottersName: startsCat && input.newCat?.letSpottersName === true,
        batchId,
        reason: input.reason,
        reasonText: input.reasonText ?? null,
        source: input.source,
        movedByAccountId: person.id,
        roleAtTime: role,
      })
      .returning({ id: sightingMovesTable.id });
    await tx.execute(sql`select set_config('app.sighting_move_id', ${String(move!.id)}, true)`);
    await tx.update(sightingsTable).set({ catId: toCatId }).where(eq(sightingsTable.id, s.id));
    await writeMovedObservation(tx, move!.id);
    moves.push({ sightingId: s.id, moveId: move!.id });
  }

  // §5.3 (D1): moving everything the cat has means the two are one cat.
  // Asked once the statements have moved, of what still stands on the old
  // cat: a team answer about the moving photo (no sighting id of its own)
  // has gone with it (review of #386, R4). A refusal here rolls the whole
  // move back.
  if (await nothingLeft(tx, fromCatId)) {
    if (toBefore === null) throw new MoveRefused("ALREADY_ITS_OWN_CAT", MOVE_WORDS.alreadyItsOwnCat(from.name));
    const [to] = await tx.select({ name: catsTable.name }).from(catsTable).where(eq(catsTable.id, toBefore));
    throw new MoveRefused("MERGE_INSTEAD", MOVE_WORDS.mergeInstead(from.name, to!.name), {
      cat: { id: toBefore, name: to!.name },
    });
  }

  // The old cat's main photo is moving: the team member chooses its next one
  // (§5.2), never the app.
  if (mainMoves) {
    if (input.newMainPhotoId === undefined) throw new MoveRefused("MAIN_PHOTO_NEEDED", MOVE_WORDS.mainPhotoNeeded(from.name));
    if (input.newMainPhotoId !== 0 && !(await isPhotoStaying(tx, fromCatId, input.newMainPhotoId))) {
      throw new MoveRefused("MAIN_PHOTO_NEEDED", MOVE_WORDS.notAPhotoOf(from.name));
    }
  }

  // The old cat (§9.7 move step 6).
  await retractReadingsOfMovedPhotos(tx, person, role, fromCatId, movedPhotos);
  if (mainMoves) {
    await tx.update(catsTable).set({ primaryPhotoId: input.newMainPhotoId! }).where(eq(catsTable.id, fromCatId));
  }
  if (earliest && sightingIds.includes(earliest.id)) {
    // D6: its map spot moves to its earliest remaining sighting; its name
    // and discoverer stay.
    const [remaining] = await tx
      .select({ lat: sightingsTable.lat, lng: sightingsTable.lng })
      .from(sightingsTable)
      .where(and(eq(sightingsTable.catId, fromCatId), eq(sightingsTable.status, "resolved")))
      .orderBy(asc(sightingsTable.createdAt), asc(sightingsTable.id))
      .limit(1);
    if (remaining) await tx.update(catsTable).set({ lat: remaining.lat, lng: remaining.lng }).where(eq(catsTable.id, fromCatId));
  }

  // Follows (§5.9, step 7): each spotter follows the right cat, as a match
  // would have, unless they unfollowed it; they keep following the old one.
  for (const device of spotters) {
    if (device === TEAM_DESK_DEVICE) continue;
    await tx.execute(sql`
      insert into cat_subscriptions (device_id, cat_id)
      select ${device}, ${toCatId}
      where not exists (select 1 from cat_unfollows where device_id = ${device} and cat_id = ${toCatId})
      on conflict do nothing`);
  }

  // The "That's a different cat" report the move came from closes as done.
  const queued = input.source === "report" ? await closeReport(tx, person, input.reportId) : null;

  // The match records' team step (§9.7 move step 8).
  await fillTeamStep(tx, person, { madeNewCat, toCatId, moves });

  // A move is a correction, never news (§9.12).
  await rebaselineNews([fromCatId, toCatId], tx);

  return { batchId, fromCatId, toCatId, madeNewCat, moves, queued };
}

const idList = (ids: readonly number[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

/** The cat this one now is; refused for a cat that doesn't exist or is in a merge loop. */
async function canonicalOrRefuse(tx: DbOrTx, catId: number): Promise<number> {
  const canonical = (await canonicalCatOf([catId], {}, tx)).get(catId);
  if (canonical == null) throw new MoveRefused("NOT_FOUND", MOVE_WORDS.notFound);
  const [cat] = await tx.select({ id: catsTable.id }).from(catsTable).where(eq(catsTable.id, canonical));
  if (!cat) throw new MoveRefused("NOT_FOUND", MOVE_WORDS.notFound);
  return canonical;
}

function refuseBadName(name: string): void {
  const problem = newCatNameProblem(name);
  if (problem === null) return;
  const code: MoveRefusalCode =
    problem === BLANK_NAME_BODY.error ? "EMPTY_NAME" : problem === OFFENSIVE_NAME_WORDS ? "OFFENSIVE_NAME" : "SYR_SHAPED_NAME";
  throw new MoveRefused(code, problem);
}

async function nameTaken(name: string): Promise<MoveRefused> {
  const holder = await catNamed(name);
  return new MoveRefused("NAME_TAKEN", NAME_TAKEN_WORDS, holder ? { cat: { id: holder.id, name: holder.name } } : {});
}

/** Every photo of these spots: each cover photo and its face and body photos (SYC-415). */
async function photosOfSightings(tx: DbOrTx, sightingIds: readonly number[]): Promise<Set<number>> {
  const covers = await tx.select({ id: sightingsTable.photoId }).from(sightingsTable).where(inArray(sightingsTable.id, [...sightingIds]));
  const extras = await tx
    .select({ id: sightingPhotosTable.photoId })
    .from(sightingPhotosTable)
    .where(inArray(sightingPhotosTable.sightingId, [...sightingIds]));
  return new Set([...covers, ...extras].map((p) => p.id).filter((id) => id > 0));
}

/**
 * "Nothing left" (§9.7 move step 1), asked after the moves: the cat has no
 * resolved sighting, vet-visit photo or welfare report, and no statement
 * still standing apart from its name and the machine's colour readings.
 * Statements carrying a sighting id are about that sighting (they went with
 * it, or were withdrawn when it went). Read over every cat merged into it.
 */
async function nothingLeft(tx: DbOrTx, fromCatId: number): Promise<boolean> {
  const [otherSighting] = await tx
    .select({ id: sightingsTable.id })
    .from(sightingsTable)
    .where(and(eq(sightingsTable.catId, fromCatId), eq(sightingsTable.status, "resolved")))
    .limit(1);
  if (otherSighting) return false;
  const feeding = await catsFeeding([fromCatId], {}, tx);
  const feedingIds = feeding.get(fromCatId)?.ids ?? [fromCatId];
  const [statement] = await tx
    .select({ id: observationsTable.id })
    .from(observationsTable)
    .where(
      and(
        observationCatIn(feeding.values()),
        isNull(observationsTable.sightingId),
        sql`${observationsTable.kind} <> 'name'`,
        sql`not (${observationsTable.kind} = 'coat' and ${observationsTable.provenance} = 'machine')`,
        sql`not exists (select 1 from observations later where later.supersedes_id = ${observationsTable.id})`,
      ),
    )
    .limit(1);
  if (statement) return false;
  const [visitPhoto] = await tx
    .select({ id: vetVisitPhotosTable.photoId })
    .from(vetVisitPhotosTable)
    .where(inArray(vetVisitPhotosTable.catId, feedingIds))
    .limit(1);
  if (visitPhoto) return false;
  // Welfare reports only: a "Report an issue" row is about a photo or a
  // name, not something recorded about the cat (the move may close it).
  const [report] = await tx
    .select({ id: welfareReportsTable.id })
    .from(welfareReportsTable)
    .where(and(inArray(welfareReportsTable.catId, feedingIds), eq(welfareReportsTable.kind, "welfare")))
    .limit(1);
  return !report;
}

/** A photo of one of the cat's resolved sightings (after the moves: one staying with it), not deleted for good. */
async function isPhotoStaying(tx: DbOrTx, catId: number, photoId: number): Promise<boolean> {
  const r = await tx.execute<{ ok: boolean }>(sql`
    select exists (
      select 1
        from sightings s
        left join sighting_photos sp on sp.sighting_id = s.id
        join photos p on p.id = ${photoId} and p.removed_at is null
       where s.cat_id = ${catId}
         and s.status = 'resolved'
         and (s.photo_id = ${photoId} or sp.photo_id = ${photoId})
    ) as ok`);
  return r.rows[0]?.ok === true;
}

/**
 * The machine's colour readings of the moved photos stop counting for the old
 * cat (§5.8, §9.7 move step 6): each standing one is marked wrong, by the
 * mover. They read another cat. With "No photo for now" that is the reading
 * of the main photo; a reading of a moved stand-in photo goes the same way.
 */
async function retractReadingsOfMovedPhotos(
  tx: DbOrTx,
  person: Person,
  role: string,
  fromCatId: number,
  movedPhotos: ReadonlySet<number>,
): Promise<void> {
  if (movedPhotos.size === 0) return;
  const feeding = await catsFeeding([fromCatId], {}, tx);
  const readings: Observation[] = await tx
    .select()
    .from(observationsTable)
    .where(
      and(
        observationCatIn(feeding.values()),
        eq(observationsTable.kind, "coat"),
        eq(observationsTable.provenance, "machine"),
        inArray(observationsTable.photoId, [...movedPhotos]),
        sql`not exists (select 1 from observations o2 where o2.supersedes_id = ${observationsTable.id})`,
        sql`coalesce((${observationsTable.value} ->> 'retracted')::boolean, false) = false`,
      ),
    )
    .orderBy(asc(observationsTable.id));
  for (const o of readings) {
    await writeObservation(tx, {
      catId: o.catId,
      kind: "coat",
      value: { retracted: true },
      accountId: person.id,
      roleAtTime: role,
      observedAt: new Date(),
      supersedesId: o.id,
      supersedeReason: "The photo was moved to another cat",
    });
  }
}

/**
 * "It's a new cat" (§5.5, §9.7 move step 2): from the oldest moved sighting,
 * its main photo (none if deleted for good) and its place; the spotter is its
 * discoverer, or none once deleted (the cat stamped redacted). A typed name
 * is the mover's `name` statement; "Let spotters name it" leaves its SYR
 * number with `name_pending`, as a vet batch's new cat (vetVisits.ts).
 */
async function makeNewCat(
  tx: DbOrTx,
  person: Person,
  role: string,
  first: typeof sightingsTable.$inferSelect,
  name: string | null,
): Promise<number> {
  const [cover] = await tx.select({ removedAt: photosTable.removedAt }).from(photosTable).where(eq(photosTable.id, first.photoId));
  const [cat] = await tx
    .insert(catsTable)
    .values({
      name: name ?? `pending-${randomUUID()}`,
      description: "",
      primaryPhotoId: cover && cover.removedAt === null ? first.photoId : 0,
      lat: first.lat,
      lng: first.lng,
      discovererDeviceId: first.deviceId,
      ...(first.deviceId === null ? { redactedAt: new Date(), redactionReason: first.redactionReason ?? "deleted by the person" } : {}),
    })
    .returning({ id: catsTable.id, name: catsTable.name, normalisedName: catsTable.normalisedName });
  if (name === null) {
    await tx.update(catsTable).set({ name: syrNumber(cat!.id), namePending: true }).where(eq(catsTable.id, cat!.id));
  } else {
    await writeObservation(tx, {
      catId: cat!.id,
      kind: "name",
      value: { name: cat!.name, normalised: cat!.normalisedName },
      accountId: person.id,
      roleAtTime: role,
      observedAt: new Date(),
    });
  }
  return cat!.id;
}

/**
 * Closes the "That's a different cat" report as done, if it is still open.
 * Returns the outcome email's outbox row, if closing queued one (an issue
 * report queues none today; welfareActions.ts), to send after the commit.
 */
async function closeReport(tx: Tx, person: Person, publicId: string | undefined): Promise<number | null> {
  if (!publicId) throw new MoveRefused("REPORT_NOT_FOUND", MOVE_WORDS.reportNotFound);
  const [report] = await tx
    .select({ state: welfareReportsTable.state })
    .from(welfareReportsTable)
    .where(
      and(
        eq(welfareReportsTable.publicId, publicId),
        eq(welfareReportsTable.kind, "content"),
        eq(welfareReportsTable.reason, "wrong_cat"),
        eq(welfareReportsTable.isDraft, false),
      ),
    )
    .for("update");
  if (!report) throw new MoveRefused("REPORT_NOT_FOUND", MOVE_WORDS.reportNotFound);
  // Closed by someone meanwhile: the move still stands, the report as it is.
  if (report.state !== "new" && report.state !== "looking") return null;
  const moved = await moveReportStateIn(tx, { publicId, from: report.state as "new" | "looking", to: "done", person });
  return moved.queued;
}

/**
 * The match record's team step (§9.7 move step 8): written once, if still
 * empty, on sightings that have a record. Inside the move's transaction
 * (the spec allows after the commit, best effort): so a deletion of the
 * team member can't land between the move and this write and leave their
 * id behind, and two moves can't fill it in the wrong order (review of
 * #386, R2).
 */
async function fillTeamStep(tx: DbOrTx, person: Person, done: Pick<MoveDone, "madeNewCat" | "toCatId" | "moves">): Promise<void> {
  await tx
    .update(sightingMatchesTable)
    .set({
      teamAction: done.madeNewCat ? "new_cat" : "different_cat",
      teamCatId: done.toCatId,
      teamByAccountId: person.id,
      teamAt: new Date(),
    })
    .where(
      and(
        inArray(sightingMatchesTable.sightingId, done.moves.map((m) => m.sightingId)),
        isNull(sightingMatchesTable.teamAction),
      ),
    );
}
