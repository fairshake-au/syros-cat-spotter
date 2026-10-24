import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  catsTable,
  coloniesTable,
  db,
  feedingSitesTable,
  foldName,
  foldedNameEquals,
  observationsTable,
  peopleTable,
  photosTable,
  vetBatchesTable,
  vetVisitPhotosTable,
  type Observation,
} from "@workspace/db";
import { getGuidance } from "@workspace/welfare-guidance";
import { actingRole, can } from "./capabilities";
import { catTarget } from "./capabilityTargets";
import { commitStatement, inStatementTransaction, type PendingNews, type Tx } from "./commitStatement";
import { loadCatRecords, ObservationRefused, writeObservation, type VetVisitValue } from "./observations";
import { areaByKey } from "./areas/namedAreas";
import { BLANK_NAME_BODY, isBlankName, isUniqueViolation, NAME_TAKEN_WORDS, OFFENSIVE_NAME_WORDS } from "./catNames";
import { containsOffensiveLanguage } from "./moderation";
import { syrNumber } from "./teamCatView";
import { TEAM_DESK_DEVICE } from "./teamDesk";
import { authorityLevel, standingRows, supersedeChains, type Vaccine } from "./resolve";
import { lockActiveObservation } from "./teamCorrections";
import { athensToday } from "./athensTime";
import { readVisitForm, type VisitField } from "./teamPages/vetVisitForm";
import { getBatch, type BatchCat } from "./vetBatches";

// Logging a vet visit, and undoing one (SYC-396 PR 3.1a; plan Task 3.1.1;
// team-dashboard-redesign.md §8.3, Decisions 4–7 and D8).
//
// A visit is one `vet_visit` observation. In the SAME transaction it writes
// what the visit settled: a `sterilised` statement if Sterilised was ticked,
// and a `vaccinated` statement if Vaccinated was. Each carries the visit's
// id (`vetVisitId`), so undoing the visit finds and retracts them all.
//
// D8: a cat guardian's standing "not sterilised" outranks the team (Decision
// G), so a plain team "yes" would change nothing. The visit's "yes" therefore
// SUPERSEDES each such row, with the reason "vet visit on 13 Aug 2026", and
// the guardian changes list shows it as overruled. Undoing the visit retracts
// that row, and the resolver's restore rule (PR 3.0) stands hers up again.
//
// Undo does not go through supersedeStatement: that path refuses rows that
// came from a visit (Decision 7) and has no capability for these kinds. It
// checks `log_vet_visit` itself and locks each row with lockActiveObservation.

type Person = { id: string; scopes: { role: string; colonyId: number | null }[] };

export interface VisitInput {
  catId: number;
  /** YYYY-MM-DD, the visit's day on Syros. Not in the future. */
  date: string;
  value: VetVisitValue;
}

export interface SavedVisit {
  visitId: number;
  /** One `sterilised` row per overruled guardian row, or one plain row; none if not ticked. */
  sterilisedIds: number[];
  vaccinatedId: number | null;
  /** The rows the visit's "yes" marked wrong (D8). */
  overruled: number[];
}

export interface VisitLine {
  visitId: number;
  /** When the visit was (ISO): the row's observedAt. */
  date: string;
  did: VetVisitValue["did"];
  vaccines?: Vaccine[];
  treatedNote?: string;
  clinicName: string;
  /** Only with `costs: true`. */
  costEur?: number | null;
  /** Only with `costs: true`. */
  paidBy?: VetVisitValue["paidBy"];
  /** Why a sterilisation's cost wasn't the standard price. Only with `costs: true`. */
  costReason?: string;
  note?: string;
  /** The photos kept with the visit, oldest first. Only with `costs: true` (the team's page). */
  photos?: { publicId: string }[];
  /** Who logged it: their name, with "(left)" if they have. */
  by: string;
}

/** The reason a visit's sterilisation statement carries. */
export const VISIT_REASON = "vet visit";

/** Refused when the visit has already been undone. */
export const ALREADY_UNDONE = "This visit was already undone.";

const notAuthorised = () => new ObservationRefused("NOT_AUTHORISED", "Not authorised");
const notFound = () => new ObservationRefused("NOT_FOUND", "Not found");

const CLINICS = new Map(getGuidance("en").vets.map((c) => [c.id, c.name]));

/** The one clinic list's name for an id (Decision 16), or the id if it has gone. */
export function clinicName(id: string): string {
  return CLINICS.get(id) ?? id;
}

/** "13 Aug 2026", the cat page's own date words. */
export function visitDay(at: Date | string): string {
  return new Date(at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Athens",
  });
}

/** The reason on each guardian statement a visit overrules (D8). */
export const overruleReason = (at: Date | string) => `vet visit on ${visitDay(at)}`;

/**
 * When a visit dated `date` was: midday UTC of that day (afternoon on Syros),
 * or now if that is still to come today, as every team form dates a
 * statement (routes/teamCorrections.ts `observedAtFor`). A date after today
 * on Syros is refused.
 */
function visitAt(date: string, now: Date): Date {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const midday = new Date(`${date}T12:00:00Z`);
  if (!ok || Number.isNaN(midday.getTime()) || midday.toISOString().slice(0, 10) !== date || date < "2000-01-01") {
    throw new ObservationRefused("MALFORMED_VALUE", "The visit needs a date");
  }
  if (date > athensToday(now)) {
    throw new ObservationRefused("FUTURE_OBSERVED_AT", "The date can't be in the future.");
  }
  return midday.getTime() > now.getTime() ? now : midday;
}

const isSterilisedNo = (o: Observation) =>
  typeof o.value === "object" && o.value !== null && (o.value as { sterilised?: unknown }).sterilised === false;

const isVisitRow = (o: Observation) =>
  typeof o.value === "object" && o.value !== null && typeof (o.value as { vetVisitId?: unknown }).vetVisitId === "number";

/**
 * The cat's "not sterilised" statements that outrank the team (a cat
 * guardian's, and later an owner's or a vet's) and that this visit's "yes"
 * must mark wrong (D8): every such row that stands, AND every such row held
 * down only by other visits' statements. Each visit then overrules her "no"
 * on its own, so undoing one visit of two never stands her "no" back up while
 * the other visit still says Sterilised (adversarial review F1). A row a
 * correction (anything not from a visit) held down is left alone.
 */
export function notSterilisedToOverrule(observations: readonly Observation[]): Observation[] {
  const chains = supersedeChains(observations, "sterilised");
  const sterilised = observations.filter((o) => o.kind === "sterilised");
  return sterilised.filter((o) => {
    if (o.redactedAt || !isSterilisedNo(o) || authorityLevel(o) <= 1 || chains.retracted.has(o.id)) return false;
    // What holds it down now: superseders that aren't themselves retracted.
    const holding = observations.filter((s) => s.supersedesId === o.id && !chains.retracted.has(s.id));
    return holding.every((s) => s.kind === "sterilised" && isVisitRow(s));
  });
}

async function lockCat(tx: Tx, catId: number): Promise<void> {
  const locked = await tx.execute<{ id: number }>(sql`select id from cats where id = ${catId} for update`);
  if (locked.rows.length === 0) throw notFound();
}

/**
 * Logs a visit, in one transaction: the cat is locked, then the visit row,
 * then a `sterilised` row (if ticked) that supersedes each standing
 * higher-authority "not sterilised" (D8), else a plain one, then a
 * `vaccinated` row (if ticked). Every row is dated to the visit. A
 * sterilisation that makes the cat Confirmed for the first time sends its
 * news once the transaction commits (commitStatement).
 *
 * Needs `log_vet_visit`; ticking Vaccinated needs `set_vaccination` too, so a
 * visit never steps around the vaccination rule.
 */
export async function logVetVisit(person: Person, input: VisitInput, now = new Date()): Promise<SavedVisit> {
  const observedAt = checkVisit(person, input, now);
  return inStatementTransaction(async (tx, news) => {
    await lockCat(tx, input.catId);
    return writeVisit(tx, news, person, input, observedAt, now);
  });
}

/** The checks every visit passes before any write: the capabilities, and its date. */
function checkVisit(person: Person, input: VisitInput, now: Date): Date {
  if (!can(person, "log_vet_visit")) throw notAuthorised();
  const did = Array.isArray(input.value?.did) ? input.value.did : [];
  if (did.includes("vaccinated") && !can(person, "set_vaccination")) throw notAuthorised();
  return visitAt(input.date, now);
}

/** At most this many visits in one round (plan PR 3.2). */
export const ROUND_MAX = 40;

/**
 * The visit's rows, inside the caller's transaction, with its cat already
 * locked: the visit, then its `sterilised` row(s) (D8) and `vaccinated` row.
 */
async function writeVisit(
  tx: Tx,
  news: PendingNews[],
  person: Person,
  input: VisitInput,
  observedAt: Date,
  now: Date,
): Promise<SavedVisit> {
  const did = Array.isArray(input.value?.did) ? input.value.did : [];
  const target = await catTarget(input.catId, tx);
  const roleAtTime = actingRole(person, "log_vet_visit", target);
  const base = { catId: input.catId, accountId: person.id, roleAtTime, observedAt };

  const visit = await commitStatement(tx, { ...base, kind: "vet_visit", value: input.value }, news, now);
  const clinic = clinicName(input.value.clinicId);

  const sterilisedIds: number[] = [];
  const overruled: number[] = [];
  if (did.includes("sterilised")) {
    const value = { sterilised: true, clinic, vetVisitId: visit.id, reason: VISIT_REASON };
    const observations = (await loadCatRecords([input.catId], tx)).get(input.catId)?.observations ?? [];
    const above = notSterilisedToOverrule(observations);
    if (above.length === 0) {
      sterilisedIds.push((await commitStatement(tx, { ...base, kind: "sterilised", value, fromVisit: true }, news, now)).id);
    }
    const displaced = supersedeChains(observations, "sterilised").displaced;
    for (const guardianNo of above) {
      // Held to the end of the transaction: a second visit or a correction
      // of the same statement queues behind this one. A row only other
      // visits hold down isn't "active", so it is locked plainly.
      if (displaced.has(guardianNo.id)) {
        await tx.execute(sql`select id from observations where id = ${guardianNo.id} for update`);
      } else {
        await lockActiveObservation(tx, guardianNo.id);
      }
      const row = await commitStatement(
        tx,
        {
          ...base,
          kind: "sterilised",
          value,
          fromVisit: true,
          supersedesId: guardianNo.id,
          supersedeReason: overruleReason(observedAt),
        },
        news,
        now,
      );
      sterilisedIds.push(row.id);
      overruled.push(guardianNo.id);
    }
  }

  let vaccinatedId: number | null = null;
  if (did.includes("vaccinated")) {
    const value = { vaccines: input.value.vaccines, clinic, vetVisitId: visit.id };
    vaccinatedId = (await commitStatement(tx, { ...base, kind: "vaccinated", value, fromVisit: true }, news, now)).id;
  }

  return { visitId: visit.id, sterilisedIds, vaccinatedId, overruled };
}

/**
 * Undoes a visit, in one transaction: each `sterilised` and `vaccinated` row
 * of the same cat whose value names this visit, and then the visit itself,
 * is superseded by `{ retracted: true, reason }`. A row the visit's "yes"
 * replaced (a cat guardian's "no", D8) stands again by the resolver's
 * restore rule. If any of them is already superseded the whole undo rolls
 * back, refused `ALREADY_SUPERSEDED` with {@link ALREADY_UNDONE}.
 */
export async function undoVetVisit(
  person: Person,
  visitId: number,
  reason: string,
  now = new Date(),
): Promise<{ retracted: number[] }> {
  if (!can(person, "log_vet_visit")) throw notAuthorised();

  return inStatementTransaction(async (tx, news: PendingNews[]) => {
    const [peek] = await tx
      .select({ catId: observationsTable.catId, kind: observationsTable.kind })
      .from(observationsTable)
      .where(eq(observationsTable.id, visitId));
    if (!peek || peek.kind !== "vet_visit") throw notFound();
    // The cat, then the rows: the order every cat-first path takes.
    await lockCat(tx, peek.catId);
    const target = await catTarget(peek.catId, tx);
    const roleAtTime = actingRole(person, "log_vet_visit", target);

    const already = () => new ObservationRefused("ALREADY_SUPERSEDED", ALREADY_UNDONE);
    const lock = async (id: number) => {
      try {
        return await lockActiveObservation(tx, id);
      } catch (err) {
        if (err instanceof ObservationRefused && err.code === "ALREADY_SUPERSEDED") throw already();
        throw err;
      }
    };
    const visit = await lock(visitId);

    const linked = await tx
      .select()
      .from(observationsTable)
      .where(
        and(
          eq(observationsTable.catId, visit.catId),
          inArray(observationsTable.kind, ["sterilised", "vaccinated"]),
          sql`${observationsTable.value}->>'vetVisitId' = ${String(visitId)}`,
        ),
      )
      .orderBy(observationsTable.id);

    const retracted: number[] = [];
    for (const row of [...linked, visit]) {
      await lock(row.id);
      const written = await commitStatement(
        tx,
        {
          catId: row.catId,
          kind: row.kind as "sterilised" | "vaccinated" | "vet_visit",
          value: { retracted: true, reason },
          accountId: person.id,
          roleAtTime,
          // A retraction asserts nothing, so nothing about it is dated by the team.
          observedAt: now,
          supersedesId: row.id,
          supersedeReason: reason,
          fromVisitUndo: true,
        },
        news,
        now,
      );
      retracted.push(written.id);
    }
    return { retracted };
  });
}

/**
 * The cat's standing visits, newest first (§7.3). `costs: false` leaves the
 * cost and who paid out entirely, not as empty keys, so nothing downstream
 * can print them by accident (§8.4: the team only, `view_vet_costs`).
 */
export async function visitsFor(catId: number, opts: { costs: boolean }): Promise<VisitLine[]> {
  const rows = await db
    .select()
    .from(observationsTable)
    .where(and(eq(observationsTable.catId, catId), eq(observationsTable.kind, "vet_visit")));
  const standing = standingRows(rows, "vet_visit")
    .filter((o) => !o.redactedAt)
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime() || b.id - a.id);

  const ids = [...new Set(standing.map((o) => o.accountId).filter((a): a is string => typeof a === "string" && /^[0-9a-f-]{36}$/i.test(a)))];
  const people = ids.length
    ? await db
        .select({ id: peopleTable.id, name: peopleTable.name, leftAt: peopleTable.leftAt })
        .from(peopleTable)
        .where(inArray(peopleTable.id, ids))
    : [];
  const nameOf = new Map(people.map((p) => [p.id, p.leftAt ? `${p.name} (left)` : p.name]));

  // One query for every visit's kept photos (never one per visit).
  const photosOf = new Map<number, { publicId: string }[]>();
  if (opts.costs && standing.length > 0) {
    const kept = await db
      .select({ visitId: vetVisitPhotosTable.visitId, publicId: photosTable.publicId })
      .from(vetVisitPhotosTable)
      .innerJoin(photosTable, eq(photosTable.id, vetVisitPhotosTable.photoId))
      .where(
        and(
          inArray(vetVisitPhotosTable.visitId, standing.map((o) => o.id)),
          eq(vetVisitPhotosTable.catId, catId),
          isNull(photosTable.removedAt),
        ),
      )
      .orderBy(vetVisitPhotosTable.photoId);
    for (const k of kept) photosOf.set(k.visitId, [...(photosOf.get(k.visitId) ?? []), { publicId: k.publicId }]);
  }

  return standing.map((o) => {
    const v = o.value as VetVisitValue;
    const line: VisitLine = {
      visitId: o.id,
      date: o.observedAt.toISOString(),
      did: v.did,
      clinicName: clinicName(v.clinicId),
      by: (o.accountId && nameOf.get(o.accountId)) || "Syros Cats",
    };
    if (v.vaccines) line.vaccines = v.vaccines;
    if (v.treatedNote) line.treatedNote = v.treatedNote;
    if (v.note) line.note = v.note;
    if (opts.costs) {
      line.costEur = v.costEur;
      line.paidBy = v.paidBy;
      if (v.costReason) line.costReason = v.costReason;
      const photos = photosOf.get(o.id);
      if (photos) line.photos = photos;
    }
    return line;
  });
}

/** The answer to a second save of the same batch (plan Review Focus 2). */
export const ALREADY_SAVED = "This batch was already saved.";

/** One thing that stops a batch saving: the entry it is about (null: the whole batch), the field, and what to say. */
export type BatchProblem = { batchCatId: number | null; field: string; words: string };

/** The device a cat Syros Cats created is "discovered" by (SYC-677 Task 9; lib/teamDesk.ts). */
export { TEAM_DESK_DEVICE };

/** A new cat's name and description, at most (the sightings route's 60 for the name). */
export const NEW_CAT_NAME_MAX = 60;
export const NEW_CAT_DESCRIPTION_MAX = 300;

/** A batch with a new cat needs somewhere to put it. */
export const CHOOSE_PLACE = "Choose a colony or an area for this batch";
/** Its colony has no centre and no open feeding site to put a new cat at (Ruling R20). */
export const COLONY_HAS_NO_CENTRE =
  "This batch's colony has no centre or feeding sites on the map yet, so a new cat can't be placed. Choose an area for this batch instead.";

/** Fields that come from the batch, not the cat: said once, for the batch. */
const SHARED_FIELDS = new Set<VisitField>(["date", "clinicId", "vaccines"]);

/** "24 Oct", the same-day warning's date words. */
const shortDay = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Athens" });

/**
 * What is wrong with a new cat's name, before anything is read: the same
 * checks, and the same words, as a spotter naming a new cat
 * (routes/sightings.ts). Null: nothing (or no name: left for spotters).
 * Whether another cat already has it is asked separately, in the save's
 * transaction.
 */
export function newCatNameProblem(name: string | null): string | null {
  if (name === null) return null;
  if (isBlankName(name)) return BLANK_NAME_BODY.error;
  if (containsOffensiveLanguage(name)) return OFFENSIVE_NAME_WORDS;
  // A typed SYR number would read as another cat's number, and could take the
  // name a cat left for spotters needs.
  if (/^syr-?\d+$/i.test(foldName(name))) return SYR_SHAPED_NAME;
  return null;
}

/** A typed name that looks like a SYR number. */
export const SYR_SHAPED_NAME = "That looks like a cat's SYR number. Choose a name.";
/** A cat left for spotters couldn't take its SYR number as its name (another cat has it). */
export const SYR_NAME_CLASH = "Couldn't give this cat its SYR number. Try saving again.";

/** What is wrong with a new cat's description (it is public), or null. */
export function newCatDescriptionProblem(description: string): string | null {
  if (description.length > NEW_CAT_DESCRIPTION_MAX || description.includes(String.fromCharCode(0))) {
    return `A description can be up to ${NEW_CAT_DESCRIPTION_MAX} characters.`;
  }
  if (containsOffensiveLanguage(description)) return "The description contains offensive language";
  return null;
}

/** A new cat's name as it is stored: trimmed, at most NEW_CAT_NAME_MAX, or null for "Leave it for spotters". */
const storedName = (name: string | null) => (name === null ? null : name.trim().slice(0, NEW_CAT_NAME_MAX));

/**
 * Makes a batch's new cat (SYC-677 Task 9), inside the save's transaction,
 * before its visit:
 *
 * - its main photo is its first batch photo, which the caller then does NOT
 *   link in vet_visit_photos: being the cat's primary photo is what makes it
 *   public (teamOnlyPhotos.ts), so future photo searches can match it;
 * - it sits at `centre` (the colony's, else its open sites' midpoint, else the
 *   area's), never a typed position;
 * - Syros Cats is its discoverer (TEAM_DESK_DEVICE);
 * - named now: a team `name` statement, as a spotter naming a new cat writes
 *   one. Left for spotters: it is inserted under a temporary unique name, then
 *   takes its SYR number as its name with `name_pending` set;
 * - in the batch's colony: a `colony` statement.
 */
async function createBatchCat(
  tx: Tx,
  person: Person,
  entry: BatchCat & { newCat: NonNullable<BatchCat["newCat"]> },
  place: { centre: { lat: number; lng: number }; colonyId: number | null },
  observedAt: Date,
): Promise<number> {
  const name = storedName(entry.newCat.name);
  const first = entry.photos[0];
  // Every batch cat has at least one photo (addCat refuses none); a cat
  // without one would go public with no photo, so this is a bug, not a case.
  if (!first) throw new Error("A batch's new cat has no photo");
  const [cat] = await tx
    .insert(catsTable)
    .values({
      name: name ?? `pending-${randomUUID()}`,
      description: entry.newCat.description.trim(),
      primaryPhotoId: first.photoId,
      lat: place.centre.lat,
      lng: place.centre.lng,
      discovererDeviceId: TEAM_DESK_DEVICE,
    })
    .returning({ id: catsTable.id, name: catsTable.name, normalisedName: catsTable.normalisedName });
  const target = { colonyId: place.colonyId };
  if (name === null) {
    await tx.update(catsTable).set({ name: syrNumber(cat!.id), namePending: true }).where(eq(catsTable.id, cat!.id));
  } else {
    await writeObservation(tx, {
      catId: cat!.id,
      kind: "name",
      value: { name: cat!.name, normalised: cat!.normalisedName },
      accountId: person.id,
      roleAtTime: actingRole(person, "rename_cat", target),
      observedAt,
    });
  }
  if (place.colonyId !== null) {
    await writeObservation(tx, {
      catId: cat!.id,
      kind: "colony",
      value: { colonyId: place.colonyId },
      accountId: person.id,
      roleAtTime: actingRole(person, "assign_cat_to_colony", target),
      observedAt,
    });
  }
  return cat!.id;
}

/**
 * Saves a vet visit batch (SYC-677 Task 4), in ONE transaction:
 *
 * 1. The batch row is locked (`for update`), so two saves of the same batch
 *    queue; the second then finds `saved_at` set and is told
 *    {@link ALREADY_SAVED}, writing nothing.
 * 2. Each cat is read through the single visit form's reader: the cat's own
 *    cost if typed, else the batch price when Sterilised is ticked; the cat's
 *    payer, else the batch's. "Checked only" is refused in a batch.
 * 3. An unconfirmed cat, the same cat twice, a cat that already has a visit on
 *    the batch's date (unless "also the same day" is ticked) are refused, each
 *    naming its entry. A new cat (Task 9) is refused for a blank, offensive or
 *    taken name (the sightings route's words), a name another new cat in the
 *    batch has, and a batch with no place to put it.
 * 4. The known cats are locked in ascending id order (cats are only ever
 *    locked after the batch, never before, so no deadlock). Each new cat is
 *    then made (createBatchCat; a new row nobody else can see yet), and each
 *    visit is written by writeVisit (D8 included). Every photo of the entry
 *    is linked to its visit in vet_visit_photos (Ruling R7; R4 relies on the
 *    link and the visit sharing this transaction), except a new cat's first
 *    photo, which is its public main photo.
 * 5. `saved_at` is set.
 *
 * Any problem: nothing is written. A name taken by another save meanwhile
 * (the unique index) rolls everything back and is named at its entry. Every
 * read inside the transaction goes through `tx`.
 */
export async function saveBatch(
  person: Person,
  batchId: number,
  now = new Date(),
): Promise<
  | { ok: true; visits: SavedVisit[]; newCats: { batchCatId: number; catId: number }[] }
  | { ok: false; problems: BatchProblem[] }
> {
  // The batch screen shows costs and searches by photo, so saving it needs both
  // capabilities as well as log_vet_visit, before any read or write.
  if (!can(person, "log_vet_visit") || !can(person, "view_vet_costs") || !can(person, "find_cat_from_photo")) {
    throw notAuthorised();
  }
  const costs = true;
  const vaccinate = can(person, "set_vaccination");
  // The entry whose new cat is being written: a unique violation is its name
  // (or, for a cat left for spotters, its SYR number).
  let making: { batchCatId: number; unnamed: boolean } | null = null;

  try {
    return await inStatementTransaction(async (tx, news) => {
      const [locked] = await tx
        .select({ id: vetBatchesTable.id, savedAt: vetBatchesTable.savedAt })
        .from(vetBatchesTable)
        .where(eq(vetBatchesTable.id, batchId))
        .for("update");
      if (!locked) throw notFound();
      if (locked.savedAt) return { ok: false as const, problems: [{ batchCatId: null, field: "batch", words: ALREADY_SAVED }] };

      const batch = (await getBatch(batchId, tx))!;
      const { shared } = batch;
      const problems: BatchProblem[] = [];
      const sharedSaid = new Set<string>();
      const add = (batchCatId: number | null, field: string, words: string) => {
        if (batchCatId === null) {
          if (sharedSaid.has(field)) return;
          sharedSaid.add(field);
        }
        problems.push({ batchCatId, field, words });
      };
      if (batch.cats.length === 0) add(null, "cats", "Add at least one cat.");

      const known = [...new Set(batch.cats.map((c) => c.catId).filter((id): id is number => id !== null))];
      const names = new Map(
        known.length
          ? (await tx.select({ id: catsTable.id, name: catsTable.name }).from(catsTable).where(inArray(catsTable.id, known))).map((c) => [c.id, c.name])
          : [],
      );
      const nameOf = (catId: number) => names.get(catId) ?? `Cat ${catId}`;
      // New cats' names, folded, by the first entry (1-based) that gave each.
      const newNames = new Map<string, number>();

      const ready: { entry: BatchCat; catId: number | null; input: VisitInput }[] = [];
      for (const [i, entry] of batch.cats.entries()) {
        let fine = true;
        if (entry.newCat) {
          const name = storedName(entry.newCat.name);
          const nameProblem = newCatNameProblem(name);
          const descriptionProblem = newCatDescriptionProblem(entry.newCat.description.trim());
          if (!entry.confirmed) {
            add(entry.id, "confirmed", "Confirm who this cat is.");
            fine = false;
          } else if (nameProblem) {
            add(entry.id, "newCat", nameProblem);
            fine = false;
          } else if (descriptionProblem) {
            add(entry.id, "newCatDescription", descriptionProblem);
            fine = false;
          } else if (name !== null) {
            const folded = foldName(name);
            const firstWith = newNames.get(folded);
            if (firstWith !== undefined) {
              add(entry.id, "newCat", `${NAME_TAKEN_WORDS}: entries ${firstWith} and ${i + 1} have the same name.`);
              fine = false;
            } else {
              newNames.set(folded, i + 1);
              const [holder] = await tx.select({ id: catsTable.id }).from(catsTable).where(foldedNameEquals(name));
              if (holder) {
                add(entry.id, "newCat", NAME_TAKEN_WORDS);
                fine = false;
              }
            }
          }
        } else if (!entry.confirmed || entry.catId === null) {
          add(entry.id, "confirmed", "Confirm who this cat is.");
          fine = false;
        } else {
          const others = batch.cats.flatMap((c, j) => (c.catId === entry.catId && !c.newCat ? [j + 1] : []));
          if (others.length > 1) {
            add(entry.id, "catId", `${nameOf(entry.catId)} is in this batch twice: entries ${others.join(" and ")}.`);
            fine = false;
          }
        }

        const checkedOnly = entry.did.includes("checked");
        if (checkedOnly) {
          add(entry.id, "did", "Tick Sterilised, Vaccinated or Treated.");
          fine = false;
        }
        const ownCost = entry.costEur.trim();
        const read = readVisitForm(
          {
            date: shared.date,
            did: entry.did,
            vaccines: shared.vaccines,
            vaccineOther: shared.vaccineOther,
            treatedNote: entry.treatedNote,
            clinicId: shared.clinicId ?? "",
            costEur: ownCost !== "" ? ownCost : entry.did.includes("sterilised") ? shared.priceEur : "",
            paidBy: entry.paidBy.trim() !== "" ? entry.paidBy : shared.paidBy,
            // Ruling R10: the cat's own note, else the batch's shared note.
            note: entry.note.trim() !== "" ? entry.note : shared.note,
            costReason: "",
          },
          { costs, vaccinate, now },
        );
        if (!read.ok) {
          for (const [field, words] of Object.entries(read.problems) as [VisitField, string][]) {
            if (field === "did" && checkedOnly) continue;
            add(SHARED_FIELDS.has(field) ? null : entry.id, field, words);
          }
          fine = false;
        }
        if (fine && read.ok && (entry.catId !== null || entry.newCat)) {
          ready.push({ entry, catId: entry.catId, input: { catId: entry.catId ?? 0, date: read.date, value: read.value } });
        }
      }

      // Where a new cat goes: the colony's centre (else its open sites' midpoint), else the area's. Never a typed position.
      let centre: { lat: number; lng: number } | null = null;
      if (batch.cats.some((c) => c.newCat)) {
        if (shared.colonyId !== null) {
          const [colony] = await tx
            .select({ lat: coloniesTable.lat, lng: coloniesTable.lng })
            .from(coloniesTable)
            .where(eq(coloniesTable.id, shared.colonyId));
          if (colony && colony.lat !== null && colony.lng !== null) centre = { lat: colony.lat, lng: colony.lng };
          else {
            // Ruling R20: no centre set, so the midpoint of its open feeding
            // sites, the same rule as colonyCentreStart (teamColonies.ts).
            const sites = await tx
              .select({ lat: feedingSitesTable.lat, lng: feedingSitesTable.lng })
              .from(feedingSitesTable)
              .where(and(eq(feedingSitesTable.colonyId, shared.colonyId), isNull(feedingSitesTable.retiredAt)));
            if (sites.length > 0) {
              centre = {
                lat: sites.reduce((a, b) => a + b.lat, 0) / sites.length,
                lng: sites.reduce((a, b) => a + b.lng, 0) / sites.length,
              };
            } else add(null, "place", COLONY_HAS_NO_CENTRE);
          }
        } else {
          const area = shared.areaKey !== null ? areaByKey(shared.areaKey) : undefined;
          if (area) centre = { lat: area.lat, lng: area.lng };
          else add(null, "place", CHOOSE_PLACE);
        }
      }
      if (problems.length) return { ok: false as const, problems };

      // Locked before the same-day check, so a visit saved elsewhere meanwhile can't slip past it.
      for (const id of [...known].sort((a, b) => a - b)) await lockCat(tx, id);

      const earlier = known.length
        ? await tx
            .select()
            .from(observationsTable)
            .where(and(inArray(observationsTable.catId, known), eq(observationsTable.kind, "vet_visit")))
        : [];
      for (const { entry, catId } of ready) {
        if (entry.alsoSameDay || catId === null) continue;
        const sameDay = standingRows(
          earlier.filter((o) => o.catId === catId),
          "vet_visit",
        ).some((o) => !o.redactedAt && athensToday(o.observedAt) === shared.date);
        if (sameDay) add(entry.id, "alsoSameDay", `${nameOf(catId)} already has a vet visit on ${shortDay(shared.date)}.`);
      }
      if (problems.length) return { ok: false as const, problems };

      const checked = ready.map((r) => ({ ...r, observedAt: checkVisit(person, r.input, now) }));
      // Making a cat names it and puts it in the colony: the capabilities those take, before any write.
      if (checked.some((r) => r.entry.newCat)) {
        const target = { colonyId: shared.colonyId };
        if (checked.some((r) => r.entry.newCat?.name != null) && !can(person, "rename_cat", target)) throw notAuthorised();
        if (shared.colonyId !== null && !can(person, "assign_cat_to_colony", target)) throw notAuthorised();
      }

      const newCats: { batchCatId: number; catId: number }[] = [];
      for (const r of checked) {
        if (!r.entry.newCat) continue;
        making = { batchCatId: r.entry.id, unnamed: r.entry.newCat.name === null };
        const catId = await createBatchCat(
          tx,
          person,
          r.entry as BatchCat & { newCat: NonNullable<BatchCat["newCat"]> },
          { centre: centre!, colonyId: shared.colonyId },
          r.observedAt,
        );
        making = null;
        r.catId = catId;
        r.input = { ...r.input, catId };
        newCats.push({ batchCatId: r.entry.id, catId });
      }

      const visits: SavedVisit[] = [];
      for (const { entry, catId, input, observedAt } of checked) {
        const saved = await writeVisit(tx, news, person, input, observedAt, now);
        visits.push(saved);
        // A new cat's first photo is its public main photo, so it is never a kept (team-only) one.
        const keep = entry.newCat ? entry.photos.slice(1) : entry.photos;
        if (keep.length) {
          await tx.insert(vetVisitPhotosTable).values(keep.map((p) => ({ photoId: p.photoId, visitId: saved.visitId, catId: catId! })));
        }
      }
      await tx.update(vetBatchesTable).set({ savedAt: now, updatedAt: now }).where(eq(vetBatchesTable.id, batchId));
      return { ok: true as const, visits, newCats };
    });
  } catch (err) {
    // Another save took the name between the check and the write: nothing was written.
    if (making !== null && isUniqueViolation(err)) {
      const { batchCatId, unnamed } = making;
      return { ok: false, problems: [{ batchCatId, field: "newCat", words: unnamed ? SYR_NAME_CLASH : NAME_TAKEN_WORDS }] };
    }
    throw err;
  }
}
