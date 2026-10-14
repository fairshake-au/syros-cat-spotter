import { and, eq, inArray, sql } from "drizzle-orm";
import { catsTable, db, observationsTable, type Observation } from "@workspace/db";
import { can, type Capability } from "./capabilities";
import {
  ObservationRefused,
  writeObservation,
  type ObservationKind,
} from "./observations";
import { resolveSterilised } from "./resolve";
import { catNamed, isBlankName, isUniqueViolation } from "./catNames";
import { containsOffensiveLanguage } from "./moderation";
import { TEAM_ROLES } from "./teamRoles";

// The team's corrections (SYC-43 part 2 plan, PR 4; spec §3.3, §4.5). One
// function per kind of write, shared by the JSON routes (routes/observations.ts,
// data spine PR 8) and the dashboard's forms (routes/teamCorrections.ts), so a
// form and the JSON route can never write different rows for the same input
// (test P4-6).
//
// Every write here **appends** a signed observation through writeObservation
// (roleAtTime "staff", accountId = the person's people.id). Nothing in
// `observations` is ever updated or deleted. The one column written is
// `cats.name`, on a rename, in the same transaction as its `name` observation
// (Decision 5).
//
// Refusals are thrown as ObservationRefused with a stable code. Callers map:
//   NOT_AUTHORISED     → the uniform 401 (never says why)
//   NOT_FOUND          → 404
//   ALREADY_SUPERSEDED → 409, "Someone already corrected this."
//   anything else      → 400

type Person = { id: string; scopes: { role: string; colonyId: number | null }[] };

/** The two kinds a direct team statement may set (§4.5, §3.5). A staff
 * ear-tip correction ("that's not a clip") only ever happens through
 * supersede, never through a fresh statement. */
export const DIRECT_KINDS = ["life_status", "sterilised"] as const;
export type DirectKind = (typeof DIRECT_KINDS)[number];

/** Which capability gates writing or superseding a given kind. `ear_tip` has
 * no capability of its own — a clipped-tip correction feeds sterilised, so
 * it is gated the same way sterilised itself is. Any other kind (note,
 * colony, name, …) has no team capability here and is refused. */
export function capabilityFor(kind: string): Capability | null {
  if (kind === "life_status") return "set_life_status";
  if (kind === "sterilised" || kind === "ear_tip") return "set_sterilisation";
  return null;
}

/** Every capability a supersede could ever require, for the pre-lookup gate
 * in supersedeStatement — see its doc comment. */
export const SUPERSEDE_CAPABILITIES: readonly Capability[] = [
  "set_life_status",
  "set_sterilisation",
];

const notAuthorised = () =>
  new ObservationRefused("NOT_AUTHORISED", "Not authorised");
const notFound = () => new ObservationRefused("NOT_FOUND", "Not found");

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Locks one observation for the rest of the transaction and returns it,
 * refusing NOT_FOUND if there is no such row and ALREADY_SUPERSEDED if
 * something already points at it. The ONE place this shape lives: marking a
 * statement wrong (supersedeStatement) and re-tying a welfare report to
 * another cat (lib/welfareTie.ts) both go through it.
 *
 * A second, concurrent caller against the same id blocks on the `for update`
 * until this transaction commits or rolls back, instead of both passing the
 * "already superseded?" check before either INSERT lands. A partial unique
 * index on supersedes_id is the later backstop (SYC-199).
 *
 * Everything reads through `tx`, never the global `db` (pre-merge review of
 * #99: a second pool connection taken inside a transaction can exhaust the
 * pool).
 */
export async function lockActiveObservation(tx: Tx, id: number): Promise<Observation> {
  const locked = await tx.execute<{ id: number }>(
    sql`select id from observations where id = ${id} for update`,
  );
  if (locked.rows.length === 0) throw notFound();

  const [original] = await tx
    .select()
    .from(observationsTable)
    .where(eq(observationsTable.id, id));
  if (!original) throw notFound();

  const [alreadySuperseded] = await tx
    .select({ id: observationsTable.id })
    .from(observationsTable)
    .where(eq(observationsTable.supersedesId, id));
  if (alreadySuperseded) {
    throw new ObservationRefused("ALREADY_SUPERSEDED", "Already superseded");
  }
  return original;
}

// ── A fresh statement: life status or sterilisation ───────────────────────

export interface TeamStatementInput {
  catId: number;
  kind: DirectKind;
  /** The kind's value, without the reason (it is added here). */
  value: Record<string, unknown>;
  reason: string;
  /** When it was true. Defaults to now. */
  observedAt?: Date;
}

/**
 * A fresh team statement of life status or sterilisation, with a reason
 * (§4.5, §3.5). There is no "reason" column for a plain statement (only a
 * supersede carries `supersedeReason`), so the reason travels inside the
 * value, exactly as `sterilised`'s own example in the spec carries extra
 * context fields (§10.1).
 *
 * Checks, in this order (PR 8's order, kept so the JSON route answers
 * exactly as before): the capability for the kind, then that the cat exists.
 */
export async function recordTeamStatement(
  person: Person,
  input: TeamStatementInput,
): Promise<Observation> {
  const capability = capabilityFor(input.kind);
  if (!capability || !can(person, capability)) throw notAuthorised();

  const [cat] = await db
    .select({ id: catsTable.id })
    .from(catsTable)
    .where(eq(catsTable.id, input.catId));
  if (!cat) throw notFound();

  return db.transaction(async (tx) =>
    writeObservation(tx, {
      catId: input.catId,
      kind: input.kind,
      value: { ...input.value, reason: input.reason },
      accountId: person.id,
      roleAtTime: "staff",
      observedAt: input.observedAt ?? new Date(),
    }),
  );
}

// ── Marking a statement wrong ─────────────────────────────────────────────

export interface SupersedeInput {
  /** The observation being marked wrong. */
  id: number;
  /** Any valid value for the kind being superseded; writeObservation's own
   * validation is the authority on the shape. */
  value: Record<string, unknown>;
  reason: string;
  observedAt?: Date;
}

/**
 * Marks one observation wrong, with a reason, by writing a new one of the
 * same kind that points at it (§4.5). A staff "that's not a clip" is exactly
 * this, applied to a spotter's `ear_tip { clipped: true }` with a new
 * `{ clipped: false }`.
 *
 * Authorisation runs in two steps (review of #68, "authz-ordering-leak"):
 *
 * 1. Before touching the database at all: does the person hold *any*
 *    capability a supersede could ever require? If not, NOT_AUTHORISED
 *    straight away, so they learn nothing about whether the target exists or
 *    has already been corrected.
 * 2. Only then is the row locked, loaded, and checked for existence /
 *    already-superseded / the exact capability its kind needs, all inside one
 *    transaction, so a concurrent supersede against the same target can't
 *    race past the already-superseded check ("double-supersede-race").
 */
export async function supersedeStatement(
  person: Person,
  input: SupersedeInput,
): Promise<{ row: Observation; original: Observation }> {
  if (!SUPERSEDE_CAPABILITIES.some((c) => can(person, c))) throw notAuthorised();

  return db.transaction(async (tx) => {
    const original = await lockActiveObservation(tx, input.id);

    const capability = capabilityFor(original.kind);
    if (!capability || !can(person, capability)) throw notAuthorised();

    const row = await writeObservation(tx, {
      catId: original.catId,
      kind: original.kind as ObservationKind,
      value: input.value,
      accountId: person.id,
      roleAtTime: "staff",
      observedAt: input.observedAt ?? new Date(),
      supersedesId: original.id,
      supersedeReason: input.reason,
    });
    return { row, original };
  });
}

/** The cat a statement is about, or null if there is no such statement. */
export async function catIdOfStatement(id: number): Promise<number | null> {
  const [row] = await db
    .select({ catId: observationsTable.catId })
    .from(observationsTable)
    .where(eq(observationsTable.id, id));
  return row?.catId ?? null;
}

// ── "Looks right" on the Probably sterilised list ─────────────────────────

// Roles whose clipped-ear answer is the team's, not a spotter's: the one
// list, lib/teamRoles.ts (SYC-53 PR 0.2).

export const LOOKS_RIGHT_REASON = "Checked the photo on the Probably sterilised list";

/**
 * Decision 6 (Samuel, 5 Oct 2026), as settled on 6 Oct 2026 ("link, don't
 * count"): the team agrees with a spotter's clipped-ear answer by writing its
 * own `ear_tip { clipped: true }`, which takes the cat off the review list
 * (the list's rule, lib/likelyReview.ts) until a newer spotter answer
 * arrives.
 *
 * It **links** to the spotter's statement (`agreesWith`, inside the value)
 * rather than carrying the photo in `photo_id`. A photo-backed clipped answer
 * is what the resolver and `clippedTipSightings` count, so attaching the photo
 * would add a "sighting" every time someone agreed, and the public page would
 * change. Without it the resolver ignores the agreement entirely: the cat's
 * resolved answer is identical before and after (test P4-2).
 *
 * It copies the spotter's `sightingId` and `observedAt` for the same reason:
 * an ear-tip answer with no sighting counts as evidence the cat was alive
 * (loadCatRecords), so a fresh date here would move "last seen alive" to
 * the moment a team member looked at a photo.
 *
 * Returns "already" when the newest active clipped answer is no longer this
 * one (someone agreed or a newer answer arrived since the page was drawn), or
 * the cat is no longer at Likely (confirmed, or marked not clipped, since), and
 * writes nothing.
 */
export async function agreeWithClip(
  person: Person,
  observationId: number,
): Promise<Observation | "already"> {
  if (!can(person, "set_sterilisation")) throw notAuthorised();

  return db.transaction(async (tx) => {
    const locked = await tx.execute<{ id: number }>(
      sql`select id from observations where id = ${observationId} for update`,
    );
    if (locked.rows.length === 0) throw notFound();
    const [spotter] = await tx
      .select()
      .from(observationsTable)
      .where(eq(observationsTable.id, observationId));
    const value = spotter?.value as { clipped?: unknown; side?: unknown } | undefined;
    if (!spotter || spotter.kind !== "ear_tip" || value?.clipped !== true) {
      throw notFound();
    }
    // Agreeing with the team's own answer adds nothing.
    if (TEAM_ROLES.has(spotter.roleAtTime)) return "already";
    // Serialise every agreement about this cat, so two people tapping
    // "Looks right" on two of its answers can't both pass the check below.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('likely-review'), ${spotter.catId})`,
    );

    // Everything below reads through `tx`, never the global `db`: a second
    // pool connection taken while this transaction holds one (and others
    // queue on the advisory lock holding theirs) can exhaust the pool and
    // hang every request (pre-merge review of #99, S1).
    const catObservations = await tx
      .select()
      .from(observationsTable)
      .where(
        and(
          eq(observationsTable.catId, spotter.catId),
          inArray(observationsTable.kind, ["ear_tip", "sterilised"]),
        ),
      );
    const earTips = catObservations.filter((o) => o.kind === "ear_tip");
    if (newestActiveClip(earTips)?.id !== spotter.id) return "already";
    // A stale list page: the cat may have been confirmed, or marked not
    // clipped, since. Only a cat still at Likely is agreed with. The
    // sterilised answer needs only the cat's ear-tip and sterilised
    // statements (resolveSterilised; no imports exist in phase 1).
    if (resolveSterilised(catObservations, []).confidence !== "likely") return "already";

    return writeObservation(tx, {
      catId: spotter.catId,
      kind: "ear_tip",
      value: {
        clipped: true,
        ...(typeof value.side === "string" ? { side: value.side } : {}),
        agreesWith: spotter.id,
        reason: LOOKS_RIGHT_REASON,
      },
      accountId: person.id,
      roleAtTime: "staff",
      observedAt: spotter.observedAt,
      sightingId: spotter.sightingId,
    });
  });
}

/**
 * The newest active `ear_tip { clipped: true }` among `observations`, newest
 * by `createdAt` (then id). By createdAt, not observedAt: a team agreement
 * carries the spotter's own observedAt, so only the order they were recorded
 * in says which came last.
 */
export function newestActiveClip(observations: readonly Observation[]): Observation | null {
  const replaced = new Set(
    observations.map((o) => o.supersedesId).filter((id): id is number => id != null),
  );
  let newest: Observation | null = null;
  for (const o of observations) {
    if (o.kind !== "ear_tip" || replaced.has(o.id)) continue;
    const v = o.value as { clipped?: unknown; agreesWith?: unknown } | null;
    if (v?.clipped !== true) continue;
    // An agreement with an answer that has since been replaced (the spotter
    // changed it, or the team marked it wrong) agrees with nothing that
    // stands, so it doesn't keep the cat off the list (Opus review, S1).
    if (typeof v.agreesWith === "number" && replaced.has(v.agreesWith)) continue;
    if (
      !newest ||
      o.createdAt.getTime() > newest.createdAt.getTime() ||
      (o.createdAt.getTime() === newest.createdAt.getTime() && o.id > newest.id)
    ) {
      newest = o;
    }
  }
  return newest;
}

// ── Renaming a cat ────────────────────────────────────────────────────────

export const NAME_MAX = 60;

export type RenameOutcome =
  | { kind: "renamed"; name: string }
  | { kind: "unchanged" }
  | { kind: "blank" }
  | { kind: "offensive" }
  | { kind: "taken"; holder: { id: number; name: string } | null };

/**
 * Renames a cat (Decision 5, the routes/cats.ts pattern): `cats.name` and a
 * signed `name` observation, both in one transaction, or neither. A name
 * another cat already has once folded (SYC-101: accents, case, final sigma)
 * is refused, naming that cat. The name passes the app's name moderation
 * filter first, exactly as an owner's rename does. Respelling the cat's own
 * name (Mimi to MIMI) is allowed; the identical name is "unchanged" and
 * writes nothing.
 */
export async function renameCat(
  person: Person,
  input: { catId: number; name: string; reason: string },
): Promise<RenameOutcome> {
  if (!can(person, "rename_cat")) throw notAuthorised();

  const name = input.name.trim().slice(0, NAME_MAX);
  if (isBlankName(name)) return { kind: "blank" };
  if (containsOffensiveLanguage(name)) return { kind: "offensive" };

  const [cat] = await db
    .select({ id: catsTable.id, name: catsTable.name })
    .from(catsTable)
    .where(eq(catsTable.id, input.catId));
  if (!cat) throw notFound();
  if (cat.name === name) return { kind: "unchanged" };

  const holder = await catNamed(name);
  if (holder && holder.id !== cat.id) {
    return { kind: "taken", holder: { id: holder.id, name: holder.name } };
  }

  const renamed = await db
    .transaction(async (tx) => {
      const [row] = await tx
        .update(catsTable)
        .set({ name })
        .where(eq(catsTable.id, cat.id))
        .returning({ name: catsTable.name, normalisedName: catsTable.normalisedName });
      await writeObservation(tx, {
        catId: cat.id,
        kind: "name",
        value: { name: row!.name, normalised: row!.normalisedName, reason: input.reason },
        accountId: person.id,
        roleAtTime: "staff",
        observedAt: new Date(),
      });
      return row!.name;
    })
    .catch((err: unknown) => {
      if (isUniqueViolation(err)) return null;
      throw err;
    });
  if (renamed === null) {
    // Another cat took the name between the check above and this write.
    const taker = await catNamed(name);
    return { kind: "taken", holder: taker ? { id: taker.id, name: taker.name } : null };
  }
  return { kind: "renamed", name: renamed };
}
