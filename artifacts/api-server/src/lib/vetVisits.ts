import { and, eq, inArray, sql } from "drizzle-orm";
import { db, observationsTable, peopleTable, type Observation } from "@workspace/db";
import { getGuidance } from "@workspace/welfare-guidance";
import { actingRole, can } from "./capabilities";
import { catTarget } from "./capabilityTargets";
import { commitStatement, inStatementTransaction, type PendingNews, type Tx } from "./commitStatement";
import { loadCatRecords, ObservationRefused, type VetVisitValue } from "./observations";
import { authorityLevel, standingRows, type Vaccine } from "./resolve";
import { lockActiveObservation } from "./teamCorrections";
import { athensToday } from "./athensTime";

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

/**
 * The cat's standing "not sterilised" statements that outrank the team
 * (a cat guardian's, and later an owner's or a vet's): the rows a visit's
 * "yes" has to mark wrong to count (D8). Standing by the resolver's own rule.
 */
export function standingNotSterilisedAboveTeam(observations: readonly Observation[]): Observation[] {
  return standingRows(observations, "sterilised").filter(
    (o) => !o.redactedAt && isSterilisedNo(o) && authorityLevel(o) > 1,
  );
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
  if (!can(person, "log_vet_visit")) throw notAuthorised();
  const did = Array.isArray(input.value?.did) ? input.value.did : [];
  if (did.includes("vaccinated") && !can(person, "set_vaccination")) throw notAuthorised();
  const observedAt = visitAt(input.date, now);

  return inStatementTransaction(async (tx, news) => {
    await lockCat(tx, input.catId);
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
      const above = standingNotSterilisedAboveTeam(observations);
      if (above.length === 0) {
        sterilisedIds.push((await commitStatement(tx, { ...base, kind: "sterilised", value, fromVisit: true }, news, now)).id);
      }
      for (const guardianNo of above) {
        // Held to the end of the transaction: a second visit or a correction
        // of the same statement queues behind this one.
        await lockActiveObservation(tx, guardianNo.id);
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
  });
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
    }
    return line;
  });
}
