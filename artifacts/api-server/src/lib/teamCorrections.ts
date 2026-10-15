import { and, desc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { catsTable, db, observationsTable, type Observation } from "@workspace/db";
import { actingRole, can, type Capability } from "./capabilities";
import { catTarget } from "./capabilityTargets";
import {
  isWithdrawal,
  loadCatRecords,
  normaliseColours,
  ObservationRefused,
  WITHDRAWN,
  writeObservation,
  type DbOrTx,
  type ObservationKind,
} from "./observations";
import { clearOwner, newestActiveOwnerHomed } from "./claiming";
import { isOwnerHomed } from "./teamCatView";
import {
  appearanceAuthorityLevel,
  resolveCoat,
  resolveMarkings,
  resolveSterilised,
  standingAboveTeam,
} from "./resolve";
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
// (roleAtTime from actingRole, accountId = the person's people.id). Nothing in
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

/** The kinds a direct team statement may set (§4.5, §3.5; SYC-2 PR 3.1 adds
 * colour and markings, spec §4.4). A staff ear-tip correction ("that's not a
 * clip") only ever happens through supersede, never through a fresh
 * statement. */
export const DIRECT_KINDS = ["life_status", "sterilised", "coat", "markings"] as const;
export type DirectKind = (typeof DIRECT_KINDS)[number];

/** Which capability gates writing or superseding a given kind. `ear_tip` has
 * no capability of its own — a clipped-tip correction feeds sterilised, so
 * it is gated the same way sterilised itself is. `colony` (SYC-209 PR 2.2)
 * is gated by `assign_cat_to_colony`. Any other kind (note, name, …) has no
 * team capability here and is refused. */
export function capabilityFor(kind: string): Capability | null {
  if (kind === "life_status") return "set_life_status";
  if (kind === "sterilised" || kind === "ear_tip") return "set_sterilisation";
  if (kind === "colony") return "assign_cat_to_colony";
  // SYC-2 PR 3.1 (spec §10.3): a colour or markings statement, including
  // marking one wrong ({ retracted: true }).
  if (kind === "coat" || kind === "markings") return "set_appearance";
  return null;
}

/** Every capability a supersede could ever require, for the pre-lookup gate
 * in supersedeStatement — see its doc comment. */
export const SUPERSEDE_CAPABILITIES: readonly Capability[] = [
  "set_life_status",
  "set_sterilisation",
  "assign_cat_to_colony",
  "set_appearance",
];

/**
 * What a cat's colony statements say once `original` is marked wrong (spec
 * §2.8): the colony of the newest of the OTHER active statements, or
 * `{ colonyId: null }` if there are none. "Newest" and "active" are the
 * rule in lib/colonyMembership.ts (latest `observedAt`, then the higher id;
 * not superseded, not redacted), so a cat's colony after "Mark wrong" is
 * exactly what `currentColonyOf` would have said had the wrong statement
 * never been made.
 *
 * Worked out here, on the server, inside the caller's transaction, and never
 * taken from a form or a JSON body: whoever marks a statement wrong chooses
 * nothing about where the cat goes instead.
 */
async function colonyAfterMarkingWrong(tx: Tx, original: Observation): Promise<{ colonyId: number | null }> {
  const replacer = alias(observationsTable, "replacer");
  const [next] = await tx
    .select({ value: observationsTable.value })
    .from(observationsTable)
    .where(
      and(
        eq(observationsTable.catId, original.catId),
        eq(observationsTable.kind, "colony"),
        isNull(observationsTable.redactedAt),
        // Only ORIGINAL statements say where the cat goes back to. A row that
        // itself supersedes something is the system's own restatement (what
        // an earlier Mark wrong wrote: a copy of the colony that then stood),
        // and choosing it would put the cat back in a colony whose statement
        // was just marked wrong (A -> B -> C, mark C wrong writes a copy of B;
        // marking B wrong must then land on A, not on that copy). This relies
        // on colony statements being superseded only by Mark wrong, which is
        // the only path that writes one.
        isNull(observationsTable.supersedesId),
        sql`${observationsTable.id} <> ${original.id}`,
        notExists(
          tx
            .select({ one: sql`1` })
            .from(replacer)
            .where(eq(replacer.supersedesId, observationsTable.id)),
        ),
      ),
    )
    .orderBy(desc(observationsTable.observedAt), desc(observationsTable.id))
    .limit(1);
  const colonyId = (next?.value as { colonyId?: unknown } | undefined)?.colonyId;
  return { colonyId: typeof colonyId === "number" ? colonyId : null };
}

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
  /** Write inside the caller's transaction (Remove owner, SYC-130) instead of a new one. */
  exec?: DbOrTx,
): Promise<Observation> {
  const capability = capabilityFor(input.kind);
  if (!capability || !can(person, capability)) throw notAuthorised();

  const [cat] = await (exec ?? db)
    .select({ id: catsTable.id })
    .from(catsTable)
    .where(eq(catsTable.id, input.catId));
  if (!cat) throw notFound();

  // The cat's colony, read from the record (SYC-316): the role written is
  // the one that holds the capability THERE.
  const target = await catTarget(input.catId, exec);
  const write = (tx: DbOrTx) =>
    writeObservation(tx, {
      catId: input.catId,
      kind: input.kind,
      value: { ...input.value, reason: input.reason },
      accountId: person.id,
      roleAtTime: actingRole(person, capability, target),
      observedAt: input.observedAt ?? new Date(),
    });
  return exec ? write(exec) : db.transaction(write);
}

// ── Remove owner (claiming-a-cat.md §7, D6) ───────────────────────────────

export interface RemoveOwnerInput {
  catId: number;
  /** What the cat is now: the team's choice, "street" by default (the route). */
  status: "street" | "in_care" | "deceased";
  reason: string;
  observedAt?: Date;
}

/**
 * Takes the owner off a cat and records what the cat now is, as one ordinary
 * team correction, in ONE transaction (spec §7):
 *
 * 1. the cat row is locked, so a second removal, or the owner's own let-go,
 *    waits and then finds the owner gone;
 * 2. the owner is looked at again under the lock (`require_owner` stops there
 *    with nothing written; `if_owner`, a confirmed life-status save or the
 *    JSON route's removeOwner, just records the status when there is none;
 *    `confirm_if_owner`, an unconfirmed life-status form, stops with
 *    "needs_confirm" and nothing written when there IS one: SYC-362 D2);
 * 3. EVERY active owner `homed` on the cat is withdrawn, as staff;
 * 4. the owner link, name, note and pin are cleared;
 * 5. the status is recorded through {@link recordTeamStatement}.
 *
 * Needs BOTH `remove_owner` and `set_life_status`, checked before anything is
 * read. Tells nobody: no push, no notification (§8).
 */
export async function removeOwnerAndSay(
  person: Person,
  input: RemoveOwnerInput,
  mode: "require_owner" | "if_owner" | "confirm_if_owner",
): Promise<{ owner: "removed" | "none" | "needs_confirm"; row: Observation | null; catName?: string }> {
  if (!can(person, "remove_owner") || !can(person, "set_life_status")) throw notAuthorised();

  return db.transaction(async (tx) => {
    const locked = await tx.execute<{ id: number }>(
      sql`select id from cats where id = ${input.catId} for update`,
    );
    if (locked.rows.length === 0) throw notFound();
    const [cat] = await tx
      .select({ ownerDeviceId: catsTable.ownerDeviceId, name: catsTable.name })
      .from(catsTable)
      .where(eq(catsTable.id, input.catId));
    // An owner who deleted their data leaves no link but their "has a home"
    // standing (D13): that counts as an owner here, so it can be ended.
    const hasOwner =
      cat?.ownerDeviceId != null ||
      (await newestActiveOwnerHomed(tx, input.catId, null)) !== null;
    if (!hasOwner && mode === "require_owner") return { owner: "none" as const, row: null };
    // Checked under the lock, so an owner who claims in the same moment
    // can't be removed without the person having been asked.
    // The name comes back with it, read under the same lock, for the page's words.
    if (hasOwner && mode === "confirm_if_owner") {
      return { owner: "needs_confirm" as const, row: null, catName: cat!.name };
    }

    const observedAt = input.observedAt ?? new Date();
    if (hasOwner) {
      // Each withdrawal supersedes the one found, so the next call finds the
      // next, until none remain (an owner can have written more than one).
      for (;;) {
        const homedId = await newestActiveOwnerHomed(tx, input.catId, null);
        if (homedId === null) break;
        await writeObservation(tx, {
          catId: input.catId,
          kind: "life_status",
          value: WITHDRAWN,
          allowWithdrawal: true,
          accountId: person.id,
          roleAtTime: actingRole(person, "remove_owner", await catTarget(input.catId, tx)),
          observedAt: new Date(),
          supersedesId: homedId,
          supersedeReason: input.reason,
        });
      }
      await clearOwner(tx, input.catId);
    }
    const row = await recordTeamStatement(
      person,
      {
        catId: input.catId,
        kind: "life_status",
        value: { status: input.status },
        reason: input.reason,
        observedAt,
      },
      tx,
    );
    return { owner: hasOwner ? ("removed" as const) : ("none" as const), row };
  });
}

/**
 * A cat's name and whether it has an owner (a link, or a deleted owner's
 * standing "has a home"), for the words on an "Are you sure?" page and the
 * note a cat guardian sees after saving. Informational only: the decision
 * itself is always made again under the lock in {@link removeOwnerAndSay}.
 * Null when there is no such cat.
 */
export async function catOwnerState(
  catId: number,
): Promise<{ name: string; hasOwner: boolean } | null> {
  const [cat] = await db
    .select({ name: catsTable.name, ownerDeviceId: catsTable.ownerDeviceId })
    .from(catsTable)
    .where(eq(catsTable.id, catId));
  if (!cat) return null;
  const hasOwner =
    cat.ownerDeviceId != null || (await newestActiveOwnerHomed(db, catId, null)) !== null;
  return { name: cat.name, hasOwner };
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
 *
 * A colour or markings statement (SYC-2 PR 3.1, spec §4.4) is marked wrong
 * by a **retraction**, `{ retracted: true }`, and nothing else: it removes
 * that one statement from the count and asserts nothing in its place. Any
 * other value is refused, so nobody expecting a replacement gets a
 * retraction instead; a new colour or list is Correct. This is the only
 * "mark wrong" for appearance; there is no second route. The cat is locked
 * first, in the same order as Correct and Confirm (cat, then statement), so
 * none of them reads a colour another is halfway through changing.
 */
export async function supersedeStatement(
  person: Person,
  input: SupersedeInput,
  /** Run inside the caller's transaction (a team Correct overruling a cat guardian) instead of a new one. */
  exec?: Tx,
): Promise<{ row: Observation; original: Observation }> {
  if (!SUPERSEDE_CAPABILITIES.some((c) => can(person, c))) throw notAuthorised();

  const run = async (tx: Tx) => {
    const [peek] = await tx
      .select({ catId: observationsTable.catId, kind: observationsTable.kind })
      .from(observationsTable)
      .where(eq(observationsTable.id, input.id));
    if (peek && isAppearanceKind(peek.kind)) await lockCat(tx, peek.catId);
    const original = await lockActiveObservation(tx, input.id);
    // A withdrawn owner claim can't be marked wrong (see correctionOf in
    // teamCatView): refused like any answer that doesn't fit, nothing written.
    if (isWithdrawal(original.kind as ObservationKind, original.value)) {
      throw new ObservationRefused("MALFORMED_VALUE", "A withdrawal can't be corrected");
    }

    // An owner's "has a home" is the claim itself: marking it wrong would
    // leave the owner link, note and pin in place. Remove owner is the only
    // team path that ends a claim.
    if (isOwnerHomed(original)) {
      throw new ObservationRefused("MALFORMED_VALUE", "An owner's claim is ended with Remove owner");
    }

    const capability = capabilityFor(original.kind);
    if (!capability || !can(person, capability)) throw notAuthorised();
    const target = await catTarget(original.catId, tx);

    // A colony statement is the one kind whose replacement is not the
    // caller's to choose (spec §2.8): the cat goes back to where its other
    // statements put it. The cat is locked first, so two people marking two
    // of its statements wrong queue up and each sees what the other left.
    const isColony = original.kind === "colony";
    if (isColony) {
      await tx.execute(sql`select id from cats where id = ${original.catId} for update`);
    }
    // Colour and markings: always a retraction (spec §4.4), never a value
    // the caller picks. writeObservation refuses a retraction of a retraction.
    const isAppearance = isAppearanceKind(original.kind);
    if (isAppearance && !isRetractedValue(input.value)) {
      throw new ObservationRefused(
        "MALFORMED_VALUE",
        "A colour or markings statement is marked wrong with { retracted: true }; use Correct for a new value",
      );
    }
    const value = isColony
      ? await colonyAfterMarkingWrong(tx, original)
      : isAppearance
        ? RETRACTED
        : input.value;

    const row = await writeObservation(tx, {
      catId: original.catId,
      kind: original.kind as ObservationKind,
      value,
      accountId: person.id,
      roleAtTime: actingRole(person, capability, target),
      // Now, not the caller's date: nothing about a colony change, or a
      // retraction (which asserts nothing), is dated by the team.
      observedAt: isColony || isAppearance ? new Date() : (input.observedAt ?? new Date()),
      supersedesId: original.id,
      supersedeReason: input.reason,
    });
    return { row, original };
  };
  return exec ? run(exec) : db.transaction(run);
}

// ── Colour and markings: Confirm and Correct (SYC-2 PR 3.1) ───────────────

/** Marking a colour or markings statement wrong (spec §4.4, §10.1). */
export const RETRACTED = { retracted: true } as const;

export type AppearanceKind = "coat" | "markings";

export function isAppearanceKind(kind: string): kind is AppearanceKind {
  return kind === "coat" || kind === "markings";
}

/** Exactly `{ retracted: true }`, nothing more. */
function isRetractedValue(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "retracted" && value["retracted"] === true;
}

/** The reason a Confirm carries: fixed, as "Looks right" on the Likely list. */
export const CONFIRM_REASON = "Looks right";

/** A cat's colour and markings as the resolver works them out now, read through `tx`. */
async function resolvedAppearance(tx: Tx, catId: number, now: Date) {
  const record = (await loadCatRecords([catId], tx)).get(catId);
  const observations = record?.observations ?? [];
  return {
    observations,
    coat: resolveCoat(observations, appearanceAuthorityLevel),
    markings: resolveMarkings(observations, now, appearanceAuthorityLevel),
  };
}

/** The same value, compared as a set (colours are never an order). */
function sameCodes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c) => b.includes(c));
}

/** Locks the cat for the rest of the transaction, so two people changing its
 * colour or markings queue up and each sees what the other wrote. */
async function lockCat(tx: Tx, catId: number): Promise<void> {
  const locked = await tx.execute<{ id: number }>(
    sql`select id from cats where id = ${catId} for update`,
  );
  if (locked.rows.length === 0) throw notFound();
}

export type ConfirmOutcome =
  | { kind: "confirmed"; row: Observation }
  /** Nothing is known to confirm (the answer is Not sure / no marks known). */
  | { kind: "nothing" }
  /** The answer changed since the page was drawn: nothing written. */
  | { kind: "changed" };

/**
 * **Confirm** (spec §4.4, §5.3): the team agrees with what the cat's colour
 * or markings say now. It writes the resolved value as a team statement,
 * with `agreesWith` the newest statement it rests on and **no photo** (the
 * PR #99 "Looks right" pattern), and the fixed reason "Looks right". It
 * becomes *Confirmed*. On a cat whose answer is a cat guardian's, it records
 * the team's agreement and changes nothing the public sees.
 *
 * `expected`, when given, is the value the page showed: if the answer has
 * changed since, nothing is written ("changed"), so nobody confirms
 * something they didn't see. The value is always worked out here, never
 * taken from the request.
 */
export async function confirmAppearance(
  person: Person,
  input: { catId: number; kind: AppearanceKind; expected?: readonly string[] },
  now = new Date(),
): Promise<ConfirmOutcome> {
  // No target: island-wide holders only. A cat guardian's own routes (SYC-2
  // PR 5.1) pass the cat's colony, read from the record.
  if (!can(person, "set_appearance")) throw notAuthorised();

  return db.transaction(async (tx) => {
    await lockCat(tx, input.catId);
    const a = await resolvedAppearance(tx, input.catId, now);
    const resolved = input.kind === "coat" ? a.coat : a.markings;
    const value = resolved.value;
    if (value === null || (input.kind === "coat" && value.length === 0)) {
      return { kind: "nothing" as const };
    }
    if (input.expected && !sameCodes(input.expected, value)) return { kind: "changed" as const };

    const byId = new Map(a.observations.map((o) => [o.id, o]));
    const newest = resolved.supportingObservationIds
      .map((id) => byId.get(id))
      .filter((o): o is Observation => o !== undefined)
      .reduce<Observation | undefined>(
        (best, o) =>
          !best ||
          o.observedAt.getTime() > best.observedAt.getTime() ||
          (o.observedAt.getTime() === best.observedAt.getTime() && o.id > best.id)
            ? o
            : best,
        undefined,
      );
    const row = await recordTeamStatement(
      person,
      {
        catId: input.catId,
        kind: input.kind,
        value: {
          ...(input.kind === "coat" ? { colours: [...value] } : { marks: [...value] }),
          ...(newest ? { agreesWith: newest.id } : {}),
        },
        reason: CONFIRM_REASON,
        observedAt: now,
      },
      tx,
    );
    return { kind: "confirmed" as const, row };
  });
}

export interface CorrectInput {
  catId: number;
  kind: AppearanceKind;
  /** Colour codes (1–2, never Not sure) or the whole list of marks ([] = nothing special). */
  codes: readonly string[];
  reason: string;
  /**
   * The ids of the statements outranking the team that the page showed (the
   * ones Correct will mark wrong). When given and the set has changed since
   * (a cat guardian said something new), nothing is written ("changed"), so
   * nobody overrules a statement they never saw.
   */
  shownAbove?: readonly number[];
}

export type CorrectOutcome =
  | { kind: "corrected"; row: Observation; retracted: Observation[] }
  | { kind: "changed" };

/**
 * **Correct** (spec §4.4; Decision G, Samuel 13 October 2026): the team's
 * whole new value, with a required reason. It becomes *Confirmed*.
 *
 * On a cat where a cat guardian's statement decides, a team statement alone
 * would be outranked and change nothing on the page. So, in ONE transaction,
 * Correct first marks wrong **every** standing statement of that kind that
 * outranks the team (every guardian's, not just the newest), each through
 * {@link supersedeStatement} with the same reason, and then writes the
 * team's value. Either all of it lands or none of it does.
 *
 * Colours go through `normaliseColours` (black + white is black and white).
 * The team never states Not sure on colour: Mark wrong undoes a colour.
 */
export async function correctAppearance(
  person: Person,
  input: CorrectInput,
  now = new Date(),
): Promise<CorrectOutcome> {
  // No target: island-wide holders only. A cat guardian's own routes (SYC-2
  // PR 5.1) pass the cat's colony, read from the record.
  if (!can(person, "set_appearance")) throw notAuthorised();

  const value =
    input.kind === "coat"
      ? { colours: normaliseColours(input.codes) }
      : { marks: [...new Set(input.codes)] };

  return db.transaction(async (tx) => {
    await lockCat(tx, input.catId);
    const { observations } = await resolvedAppearance(tx, input.catId, now);
    const above = standingAboveTeam(observations, input.kind);
    if (input.shownAbove && !sameCodes(input.shownAbove.map(String), above.map((o) => String(o.id)))) {
      return { kind: "changed" as const };
    }
    const retracted: Observation[] = [];
    for (const statement of above) {
      const { row } = await supersedeStatement(
        person,
        { id: statement.id, value: RETRACTED, reason: input.reason },
        tx,
      );
      retracted.push(row);
    }
    const row = await recordTeamStatement(
      person,
      { catId: input.catId, kind: input.kind, value, reason: input.reason, observedAt: now },
      tx,
    );
    return { kind: "corrected" as const, row, retracted };
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
      roleAtTime: actingRole(person, "set_sterilisation", await catTarget(spotter.catId, tx)),
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
        roleAtTime: actingRole(person, "rename_cat", await catTarget(cat.id, tx)),
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
