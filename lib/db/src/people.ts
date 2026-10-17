import crypto from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type * as schema from "./schema";
import {
  PERSON_LANGUAGES,
  ISLAND_ROLES,
  PERSON_ROLES,
  ROLE_MAILBOX_LOCAL_PARTS,
  SCOPE_RELATIONSHIPS,
  peopleTable,
  personScopesTable,
  type PersonLanguage,
  type PersonRole,
  type ScopeReach,
} from "./schema/people";
import { coloniesTable } from "./schema/colonies";
import { personEventsTable, type PersonEventKind } from "./schema/personEvents";
import { foldName } from "./fold";

// The rules shared by every way into the list of people (team-access spec
// §2.8, §2.9): the `people` command now, the manage_people screen later. The
// database refuses the same things through its checks; these give the
// plain-English reason and never rely on those checks being present.

export type PeopleDb = NodePgDatabase<typeof schema>;

export interface AllowedPerson {
  id: string;
  name: string;
  email: string;
  sessionVersion: number;
}

export interface PersonWithScopes extends AllowedPerson {
  /** The language their messages and pages are in (§10.1). */
  language: PersonLanguage;
  scopes: {
    role: PersonRole;
    colonyId: number | null;
    /** Where the role applies (roles-and-invites.md §10.1). */
    reach: ScopeReach;
    /** When this placement turns itself off; null for never. */
    expiresAt: Date | null;
  }[];
}

export type EmailCheck = { ok: true } | { ok: false; reason: string };

export class PeopleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeopleError";
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPersonId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Trims and lower-cases, the same way on insert and on lookup. */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** `ok`, or the plain-English refusal. Expects a normalised address. */
export function checkPersonEmail(email: string): EmailCheck {
  if (email !== normaliseEmail(email)) {
    return {
      ok: false,
      reason: "The address must be lower-case, with no spaces around it.",
    };
  }
  const parts = email.split("@");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    return {
      ok: false,
      reason: "That isn't an email address.",
    };
  }
  const local = parts[0]!.split("+")[0]!;
  if ((ROLE_MAILBOX_LOCAL_PARTS as readonly string[]).includes(local)) {
    return {
      ok: false,
      reason: `${local}@ is a shared mailbox. Every person needs their own address, so we can tell who did what. A personal address is fine.`,
    };
  }
  return { ok: true };
}

function isRole(value: string): value is PersonRole {
  return (PERSON_ROLES as readonly string[]).includes(value);
}

/** The stored language, or `en` for anything the code doesn't know. */
function asLanguage(value: string): PersonLanguage {
  return (PERSON_LANGUAGES as readonly string[]).includes(value)
    ? (value as PersonLanguage)
    : "en";
}

function checkRole(role: string): asserts role is PersonRole {
  if (!isRole(role)) {
    throw new PeopleError(
      `"${role}" isn't a role. Roles are: ${PERSON_ROLES.join(", ")}.`,
    );
  }
}

function checkColonyId(colonyId: unknown): asserts colonyId is number {
  if (!Number.isInteger(colonyId) || (colonyId as number) < 1) {
    throw new PeopleError("A colony is given by its number, like 12.");
  }
}

/**
 * One person as the People screen draws them (SYC-53 PR 1.2): everything
 * `personState` needs, every placement with its end and label, and the
 * history with its detail. Ids only; the screen turns them into names.
 */
export interface ScreenPerson {
  id: string;
  name: string;
  email: string;
  language: string;
  addedAt: Date;
  addedBy: string | null;
  leftAt: Date | null;
  leftBy: string | null;
  acceptedAt: Date | null;
  inviteSentAt: Date | null;
  inviteExpiresAt: Date | null;
  /** Every placement row, ended ones included (marked by `inForce`, by the database's clock). */
  placements: {
    role: string;
    colonyId: number | null;
    /** `island`, `colony`, or `start` for "no colony yet" (SYC-439). */
    reach: string;
    expiresAt: Date | null;
    relationship: string | null;
    inForce: boolean;
  }[];
  /** Oldest first. */
  history: { kind: string; at: Date; by: string; detail: Record<string, unknown> | null }[];
}

/**
 * One placement as a label: the role, with `:<colony id>` when placed, and
 * `guardian:start` for a cat guardian with no colony yet (SYC-439), read
 * from the row's reach, never guessed from an empty colony.
 */
export const START_LABEL = "guardian:start";
const scopeLabel = (s: { role: string; colonyId: number | null; reach?: string | null }) =>
  s.reach === "start"
    ? START_LABEL
    : s.colonyId === null
      ? s.role
      : `${s.role}:${s.colonyId}`;

/**
 * The row a role is written as. A guardian is always placed on a colony;
 * every other role written here is island-wide (the database checks the
 * same, §10.1).
 */
function scopeRow(
  personId: string,
  role: PersonRole,
  colonyId: number | null,
  grantedBy: string,
  /** "No colony yet" (SYC-439): only ever from an explicit choice. */
  start = false,
) {
  if (start) {
    if (role !== "guardian" || colonyId !== null) {
      throw new PeopleError("'No colony yet' is only for a cat guardian, with no colony.");
    }
    return { personId, role, colonyId: null, reach: "start" as ScopeReach, grantedBy };
  }
  const placed = role === "guardian";
  return {
    personId,
    role,
    colonyId: placed ? colonyId : null,
    reach: (placed ? "colony" : "island") as ScopeReach,
    grantedBy,
  };
}

export interface AddPersonInput {
  email: string;
  name: string;
  addedBy: string;
  roles?: string[];
  /** The colony a `guardian` role is placed on. Required for a guardian. */
  colonyId?: number;
  /** `en` (the default), `el` or `fr`. */
  language?: string;
}

/**
 * One change to a person's roles (`people set-roles`, plan PR 0.3). Exactly
 * one of `add`, `remove` and `replace`. Additive by default: `add` and
 * `remove` change one role, and only `replace` sets the whole list.
 */
export interface SetRolesInput {
  email: string;
  by: string;
  add?: string;
  remove?: string;
  replace?: string[];
  /** The colony, for adding or removing a `guardian` placement. */
  colonyId?: number;
  /**
   * With `add: "guardian"` and no colony: a cat guardian with no colony yet,
   * who may create her first one (SYC-439, `--start`). Only for someone who
   * holds nothing else in force.
   */
  start?: boolean;
  /**
   * Allows a result without `staff`. Until plan PR 0.5, can() and mayEnter()
   * ask only for `staff`, so a person without it can't sign in at all, even
   * holding `management`.
   */
  force?: boolean;
}

export interface SetRolesResult {
  id: string;
  /** Role names, `guardian:<colony id>` for a placement. Ids only. */
  before: string[];
  after: string[];
  /** Guardian placements a `replace` took away (labels, ids only). */
  droppedPlacements: string[];
}

export interface SetPlacementsResult {
  id: string;
  /** Labels in force before and after (`guardian:<colony id>`). Ids only. */
  before: string[];
  after: string[];
}

export interface MarkLeftResult {
  id: string;
  sessionVersion: number;
  /** Pending invitations this person had sent, withdrawn with them (§9.2). */
  withdrawnInvitations: number;
  /**
   * True when the person had not joined, so this withdrew their invitation
   * (and anonymised them if they never joined) instead (review minor 6).
   */
  invitationWithdrawn?: true;
}

/**
 * The open transaction a change is running in, and nothing else: passing the
 * database itself (`db`) does not compile, so an event can't be written
 * outside the transaction of its change.
 */
export type PeopleTx = Parameters<Parameters<PeopleDb["transaction"]>[0]>[0];
type Tx = PeopleTx;

/**
 * Anything that can read: the database itself or an open transaction. Only
 * the read-only helpers below take it; every write takes a `Tx`.
 */
export type PeopleExec = PgDatabase<NodePgQueryResultHKT, typeof schema>;

/**
 * Writes one row of the record of who changed what (SYC-213, spec 11.1).
 * Always called with the transaction the change itself runs in, so the change
 * and its event stand or fall together. `detail` holds ids and role names
 * only, never a name or an address.
 */
async function recordPersonEvent(
  tx: Tx,
  event: {
    personId: string;
    kind: PersonEventKind;
    by: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(personEventsTable).values({
    personId: event.personId,
    kind: event.kind,
    by: event.by,
    detail: event.detail ?? null,
  });
}

/**
 * A `person_scopes` row is in force while it has no end, or its end is still
 * ahead of `clock`. The clock is the database's `now()` everywhere in the app;
 * it is a parameter only so the T6 test can ask the same condition about a
 * moment the database can't be wound to (the 25 October clock change).
 */
export function scopeInForce(clock: SQL = sql`now()`): SQL {
  return or(
    isNull(personScopesTable.expiresAt),
    sql`${personScopesTable.expiresAt} > ${clock}`,
  )!;
}

/**
 * When a placement given an end date stops (§6.6): midnight Athens time at
 * the END of that date, as an instant. Athens is UTC+3 in summer and UTC+2 in
 * winter, so this asks the time-zone database for the offset at that
 * midnight rather than adding 24 hours (which is an hour wrong on the night
 * the clocks change). "2026-10-25" ends at 2026-10-25T22:00:00Z.
 */
export function placementEndsAt(date: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new PeopleError(`"${date}" isn't a date like 2026-10-25.`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d
  ) {
    throw new PeopleError(`"${date}" isn't a real date.`);
  }
  // The next day's 00:00 as wall-clock digits, read as if UTC, minus Athens's
  // offset at that instant. One correction step is exact: midnight is never
  // inside a skipped or repeated hour in Athens (the changes are at 03:00
  // and 04:00).
  const wall = Date.UTC(y, mo - 1, d + 1);
  const offset = athensOffsetMs(new Date(wall));
  const guess = wall - offset;
  return new Date(wall - athensOffsetMs(new Date(guess)));
}

/** Athens's offset from UTC at an instant, in milliseconds. */
function athensOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Athens",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

// ── SYC-53 PR 1.1: invitations, accepting, withdrawing, leaving ────────────
// (roles-and-invites.md §4, §8, §9, §10.1–10.2, §11.1)

/** An invitation is valid for 14 days from when it is sent (§4.4). */
export const INVITATION_DAYS = 14;
// In hours, not days: `interval '14 days'` adds calendar days in the
// session's time zone, which is 14 days and an hour across a clock change.
const INVITATION_INTERVAL = sql.raw(`interval '${INVITATION_DAYS * 24} hours'`);
/** At most one invitation message per person per 24 hours (§4.4, §8.1). */
const RESEND_INTERVAL = sql.raw(`interval '24 hours'`);

/** The longest name a person can have, wherever it is typed. */
export const PERSON_NAME_MAX = 100;

/** What a withdrawn, never-joined invitee's row says instead (§9.6; plan M9). */
export const ANONYMISED_NAME = "Withdrawn invitation";
export const anonymisedEmail = (personId: string) =>
  `withdrawn-${personId.toLowerCase()}@invalid`;
const ANONYMISED_EMAIL_RE =
  /^withdrawn-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@invalid$/;
export function isAnonymisedEmail(email: string): boolean {
  return ANONYMISED_EMAIL_RE.test(email);
}
/** The same rule in SQL: this row's address is not a placeholder. */
const notAnonymised = () =>
  sql`${peopleTable.email} not like 'withdrawn-%@invalid'`;

/**
 * The states a person can be in (§10.1), worked out from the row, in this
 * order and from nothing else. Nothing writes "expired": it is the moment
 * the expiry passes. The People screen's chips (PR 1.2) and the tests use
 * this one rule. `now` is the clock to compare the expiry with; the finders
 * below use the DATABASE's clock in SQL (`isInvitedNow`), never this one.
 */
export type PersonState = "left" | "joined" | "invited" | "expired" | "not_sent";
export function personState(
  row: {
    leftAt: Date | null;
    acceptedAt: Date | null;
    inviteSentAt: Date | null;
    inviteExpiresAt: Date | null;
  },
  now: Date,
): PersonState {
  if (row.leftAt !== null) return "left";
  if (row.acceptedAt !== null) return "joined";
  if (row.inviteSentAt === null) return "not_sent";
  return row.inviteExpiresAt !== null &&
    row.inviteExpiresAt.getTime() > now.getTime()
    ? "invited"
    : "expired";
}

/**
 * State "Invited", exactly, by the database's clock: not left, not
 * accepted, the message has gone out, and the expiry is still ahead. The
 * only condition `findInvitee` and the allow-list's invitee answer use.
 */
export function isInvitedNow(): SQL {
  return and(
    isNull(peopleTable.leftAt),
    isNull(peopleTable.acceptedAt),
    isNotNull(peopleTable.inviteSentAt),
    sql`${peopleTable.inviteExpiresAt} > now()`,
    notAnonymised(),
  )!;
}

/** Pending: not left and not accepted (Invited, Expired or Not sent yet). */
const isPending = () =>
  and(isNull(peopleTable.leftAt), isNull(peopleTable.acceptedAt))!;

/** Someone invited who has not joined: what the hand-off and accept page see. */
export interface Invitee {
  id: string;
  name: string;
  sessionVersion: number;
  language: PersonLanguage;
}

/** One placement, as the People screen and the actions layer give it. */
export interface PlacementInput {
  role: string;
  /** The colony, for a cat guardian only. */
  colonyId?: number | null;
  /** When it stops (see `placementEndsAt`); null or absent for never. */
  endsAt?: Date | null;
  /** feeds, owns_here or covering; a label, grants nothing (Decision 9). */
  relationship?: string | null;
  /**
   * A cat guardian with no colony yet, who may create her first one
   * (SYC-439). Must be said in so many words: a guardian with no colony and
   * no `start` is refused, never turned into one.
   */
  start?: boolean;
}

interface Placement {
  role: PersonRole;
  colonyId: number | null;
  endsAt: Date | null;
  relationship: string | null;
  reach: ScopeReach;
}

/**
 * The roles an invitation or a role change may give (§8.1): the team,
 * management, a cat guardian. `vet` is reserved and grants nothing yet, so
 * nobody is invited as one.
 */
const GRANTABLE_ROLES: readonly PersonRole[] = PERSON_ROLES.filter((r) => r !== "vet");

function checkPlacements(input: readonly PlacementInput[]): Placement[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new PeopleError("Choose at least one role.");
  }
  const out: Placement[] = [];
  for (const p of input) {
    checkRole(p.role);
    if (!GRANTABLE_ROLES.includes(p.role)) {
      throw new PeopleError(`"${p.role}" can't be given here. Choose the team, management or a cat guardian.`);
    }
    const colonyId = p.colonyId ?? null;
    const start = p.start === true;
    if (p.start !== undefined && typeof p.start !== "boolean") {
      throw new PeopleError("'No colony yet' is yes or no.");
    }
    if (start) {
      // "No colony yet" (SYC-439): a cat guardian alone, no colony, no end
      // date, no label. The database checks the same.
      if (p.role !== "guardian") {
        throw new PeopleError(START_ALONE);
      }
      if (colonyId !== null) throw new PeopleError(START_OR_COLONIES);
      if ((p.endsAt ?? null) !== null || (p.relationship ?? null) !== null) {
        throw new PeopleError(START_NO_END);
      }
      if (input.length !== 1) {
        throw new PeopleError(
          input.some((q) => q.role === "guardian" && (q.colonyId ?? null) !== null)
            ? START_OR_COLONIES
            : START_ALONE,
        );
      }
      out.push({ role: "guardian", colonyId: null, endsAt: null, relationship: null, reach: "start" });
      continue;
    }
    if (p.role === "guardian") {
      if (colonyId === null) {
        throw new PeopleError("A cat guardian needs a colony.");
      }
      checkColonyId(colonyId);
    } else if (colonyId !== null) {
      throw new PeopleError(
        "Only a cat guardian is placed on a colony; the other roles are island-wide.",
      );
    }
    const endsAt = p.endsAt ?? null;
    const relationshipGiven = p.relationship ?? null;
    // End dates and relationship labels belong to a cat guardian's placement
    // only (spec §6.6, Decision 9). An end date on management would let it
    // run out with nobody left in charge (review M-1).
    if (p.role !== "guardian" && (endsAt !== null || relationshipGiven !== null)) {
      throw new PeopleError(
        "Only a cat guardian's placement can have an end date or a label; the team and management don't.",
      );
    }
    if (endsAt !== null) {
      if (!(endsAt instanceof Date) || Number.isNaN(endsAt.getTime())) {
        throw new PeopleError("That end date isn't a date.");
      }
      if (endsAt.getTime() <= Date.now()) {
        throw new PeopleError("That end date has already passed.");
      }
    }
    const relationship = p.relationship ?? null;
    if (
      relationship !== null &&
      !(SCOPE_RELATIONSHIPS as readonly string[]).includes(relationship)
    ) {
      throw new PeopleError(
        `"${relationship}" isn't a relationship. They are: ${SCOPE_RELATIONSHIPS.join(", ")}.`,
      );
    }
    if (out.some((o) => o.role === p.role && o.colonyId === colonyId)) {
      throw new PeopleError(
        `${scopeLabel({ role: p.role, colonyId })} is given twice.`,
      );
    }
    out.push({
      role: p.role,
      colonyId,
      endsAt,
      relationship,
      reach: p.role === "guardian" ? "colony" : "island",
    });
  }
  return out;
}

export const START_ALONE = "'No colony yet' is only for a cat guardian with no other role.";
export const START_OR_COLONIES = "Choose her colonies, or 'No colony yet', not both.";
export const START_NO_END =
  "'No colony yet' can't have an end date or a label. It ends when she creates her colony.";

/** Role names and colony ids, for an event's detail (ids only, §11). */
function rolesAndColonies(
  placements: readonly { role: string; colonyId: number | null; reach?: string | null }[],
) {
  return {
    // A cat guardian with no colony yet (SYC-439): said, so the history and
    // messages never read her as holding nothing.
    ...(placements.some((p) => p.reach === "start") ? { start: true } : {}),
    roles: [...new Set(placements.map((p) => p.role))].sort(),
    colonyIds: [
      ...new Set(
        placements
          .map((p) => p.colonyId)
          .filter((c): c is number => c !== null),
      ),
    ].sort((a, b) => a - b),
  };
}

/** A name as stored: trimmed, no control characters, spaces collapsed. */
export function cleanPersonName(raw: string): string {
  return String(raw)
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function checkName(raw: string): string {
  const name = cleanPersonName(raw);
  if (!name) throw new PeopleError("Every person needs a name.");
  if ([...name].length > PERSON_NAME_MAX) {
    throw new PeopleError(`A name is at most ${PERSON_NAME_MAX} letters.`);
  }
  return name;
}

function checkLanguage(language: string): PersonLanguage {
  if (!(PERSON_LANGUAGES as readonly string[]).includes(language)) {
    throw new PeopleError(
      `"${language}" isn't a language. Languages are: ${PERSON_LANGUAGES.join(", ")}.`,
    );
  }
  return language as PersonLanguage;
}

/**
 * Every management row, locked in one fixed order (by id), before anything
 * about the person being changed is counted (§9.5; SYC-333). `setRoles`
 * takes the same lock in the same order, after the person's own `people`
 * row, so two managers removing, demoting or signing out each other at once
 * queue here, and the second counts after the first has committed.
 */
async function lockManagementRows(tx: Tx): Promise<void> {
  await tx
    .select({ id: personScopesTable.id })
    .from(personScopesTable)
    .where(eq(personScopesTable.role, "management"))
    .orderBy(asc(personScopesTable.id))
    .for("update");
}

/**
 * A management row that counts towards the last-manager guard: one with NO
 * end date (review M-1). A management row due to end tomorrow is in force
 * today, but counting it would let two managers each give the other an end
 * date, or one give the other an end date and then stop helping, and leave
 * nobody in charge the day after. `setRoles` counts the same way.
 */
const lastingManagement = () =>
  and(eq(personScopesTable.role, "management"), isNull(personScopesTable.expiresAt))!;

/**
 * Joined people, still on the list, holding a lasting management row,
 * other than `personId`. Counted exactly as `setRoles` counts them.
 */
async function otherManagers(tx: Tx, personId: string): Promise<number> {
  const managers = await tx
    .select({ personId: personScopesTable.personId })
    .from(personScopesTable)
    .innerJoin(peopleTable, eq(peopleTable.id, personScopesTable.personId))
    .where(
      and(
        lastingManagement(),
        isNull(peopleTable.leftAt),
        isNotNull(peopleTable.acceptedAt),
      ),
    );
  return new Set(
    managers.map((m) => m.personId).filter((id) => id !== personId),
  ).size;
}

/** Does this person hold management in force now? */
async function holdsManagement(tx: Tx, personId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: personScopesTable.id })
    .from(personScopesTable)
    .where(
      and(
        eq(personScopesTable.personId, personId),
        eq(personScopesTable.role, "management"),
        scopeInForce(),
      ),
    );
  return rows.length > 0;
}

export const LAST_MANAGER =
  "They are the last person with management. Nobody else could invite or remove anyone. Nothing was changed.";

/** The person's rows, locked, each with whether it is in force now. */
async function heldRows(tx: Tx, personId: string) {
  return tx
    .select({
      id: personScopesTable.id,
      role: personScopesTable.role,
      colonyId: personScopesTable.colonyId,
      reach: personScopesTable.reach,
      expiresAt: personScopesTable.expiresAt,
      relationship: personScopesTable.relationship,
      inForce: sql<boolean>`(${personScopesTable.expiresAt} is null or ${personScopesTable.expiresAt} > now())`,
    })
    .from(personScopesTable)
    .where(eq(personScopesTable.personId, personId))
    .for("update");
}

/**
 * Makes the person's placements exactly `wanted` (§6.6, §9.4). A placement
 * she holds already is kept as it is if nothing about it changed; one she
 * once held (its end has passed) is put back by UPDATING that row, which
 * clears or sets its end and records who and when; a new one is inserted.
 * A row no longer wanted is removed: a cat guardian placement is ended (its
 * end set to now, so it stays as the record of what she held and can be put
 * back), an island row is deleted, as `setRoles` does. Returns the labels in
 * force before and after, and whether anything changed.
 */
async function writePlacements(
  tx: Tx,
  personId: string,
  wanted: readonly Placement[],
  by: string,
): Promise<{ before: string[]; after: string[]; changed: boolean }> {
  const held = await heldRows(tx, personId);
  const before = held.filter((h) => h.inForce).map(scopeLabel).sort();
  let changed = false;
  // A row is "the same placement" by role, colony AND reach, so a start row
  // (SYC-439) is never mistaken for, or updated into, anything else.
  const sameRow = (h: { role: string; colonyId: number | null; reach: string }, w: Placement) =>
    h.role === w.role && h.colonyId === w.colonyId && h.reach === w.reach;
  for (const w of wanted) {
    const row = held.find((h) => sameRow(h, w));
    if (!row) {
      await tx.insert(personScopesTable).values({
        ...scopeRow(personId, w.role, w.colonyId, by, w.reach === "start"),
        expiresAt: w.endsAt,
        relationship: w.relationship,
      });
      changed = true;
      continue;
    }
    const same =
      row.inForce &&
      (row.expiresAt?.getTime() ?? null) === (w.endsAt?.getTime() ?? null) &&
      row.relationship === w.relationship;
    if (same) continue;
    await tx
      .update(personScopesTable)
      .set({
        expiresAt: w.endsAt,
        relationship: w.relationship,
        grantedBy: by,
        grantedAt: sql`now()`,
      })
      .where(eq(personScopesTable.id, row.id));
    changed = true;
  }
  for (const h of held) {
    if (wanted.some((w) => sameRow(h, w))) continue;
    if (!h.inForce) continue;
    // A placement on a colony is ended, so it stays as the record of what she
    // held; an island row, and a "no colony yet" row (SYC-439), is deleted.
    if (h.colonyId !== null) {
      await tx
        .update(personScopesTable)
        .set({ expiresAt: sql`now()` })
        .where(eq(personScopesTable.id, h.id));
    } else {
      await tx.delete(personScopesTable).where(eq(personScopesTable.id, h.id));
    }
    changed = true;
  }
  const after = wanted.map(scopeLabel).sort();
  return { before, after, changed };
}

/**
 * Anonymising on withdrawal (§9.6; plan M9; brief point 5): a person who
 * NEVER joined (no `accepted` and no `added` event: a backfilled `added`
 * counts as joined, and someone brought back by `rejoinPerson` did join
 * once) loses her address and name to fixed placeholders, in the same
 * transaction as the withdrawal, and an `anonymised` event is written whose
 * detail holds no address. The row stays. True if it anonymised.
 */
async function anonymiseIfNeverJoined(
  tx: Tx,
  personId: string,
  by: string,
): Promise<boolean> {
  const joined = await tx
    .select({ id: personEventsTable.id })
    .from(personEventsTable)
    .where(
      and(
        eq(personEventsTable.personId, personId),
        inArray(personEventsTable.kind, ["accepted", "added"]),
      ),
    )
    .limit(1);
  if (joined.length > 0) return false;
  await tx
    .update(peopleTable)
    .set({ email: anonymisedEmail(personId), name: ANONYMISED_NAME })
    .where(eq(peopleTable.id, personId));
  await recordPersonEvent(tx, {
    personId,
    kind: "anonymised",
    by,
    detail: { reason: "invitation_withdrawn" },
  });
  return true;
}

/**
 * Ends a pending invitation (Invited, Expired or Not sent yet): one guarded
 * update, so it can only win against an acceptance that hasn't happened
 * yet (§10.1). The person is marked as left (a row is never deleted, §9.6),
 * signed out, `invite_withdrawn` is written with who and why, and she is
 * anonymised if she never joined. Null if it was no longer pending.
 */
async function closeInvitation(
  tx: Tx,
  personId: string,
  by: string,
  reason: "withdrawn" | "declined" | "sender_left",
  extra: Record<string, unknown> = {},
): Promise<{ id: string; anonymised: boolean } | null> {
  const [row] = await tx
    .update(peopleTable)
    .set({
      leftAt: sql`now()`,
      leftBy: by,
      sessionVersion: sql`${peopleTable.sessionVersion} + 1`,
    })
    .where(and(eq(peopleTable.id, personId), isPending()))
    .returning({ id: peopleTable.id });
  if (!row) return null;
  await recordPersonEvent(tx, {
    personId,
    kind: "invite_withdrawn",
    by,
    detail: { reason, ...extra },
  });
  const anonymised = await anonymiseIfNeverJoined(tx, personId, by);
  return { id: personId, anonymised };
}

/** Labels and colony ids of the rows in force, for a `left` event. */
async function heldInForce(tx: Tx, personId: string) {
  return tx
    .select({
      role: personScopesTable.role,
      colonyId: personScopesTable.colonyId,
      reach: personScopesTable.reach,
    })
    .from(personScopesTable)
    .where(and(eq(personScopesTable.personId, personId), scopeInForce()));
}

/**
 * Marks a person as left, inside the caller's transaction, with the people
 * row already locked (§9.2, §9.5): the last-manager guard under the shared
 * management lock (SYC-333), `left_at`, a new session version, the `left`
 * event, and EVERY pending invitation this person sent withdrawn in the same
 * transaction (each anonymised if never joined). Who sent an invitation is
 * the `by` of its latest `invited` event, so a person brought back counts
 * as sent by whoever brought her back.
 */
async function leave(
  tx: Tx,
  personId: string,
  by: string,
  opts: { force: boolean },
): Promise<MarkLeftResult> {
  // Lock order (review minor 2), the same in every function here:
  //   1. `people` rows: the person being changed first (the caller has it),
  //      then, when leaving, the leaver's pending invitees, by id;
  //   2. every management `person_scopes` row, by id (lockManagementRows);
  //   3. the person's own `person_scopes` rows.
  // setRoles, setPlacements and signOutEverywhereById take 1 then 2, so a
  // departure and a role change on one of the leaver's invitees queue
  // instead of each holding what the other wants.
  const sent = await tx.execute<{ id: string }>(sql`
    select p.id from people p
     where p.accepted_at is null and p.left_at is null
       and (select e.by from person_events e
             where e.person_id = p.id and e.kind = 'invited'
             order by e.id desc limit 1) = ${personId}
     order by p.id
     for update of p
  `);
  await lockManagementRows(tx);
  if (
    !opts.force &&
    (await holdsManagement(tx, personId)) &&
    (await otherManagers(tx, personId)) === 0
  ) {
    throw new PeopleError(LAST_MANAGER);
  }
  const [row] = await tx
    .update(peopleTable)
    .set({
      leftAt: sql`now()`,
      leftBy: by,
      sessionVersion: sql`${peopleTable.sessionVersion} + 1`,
    })
    .where(eq(peopleTable.id, personId))
    .returning({ id: peopleTable.id, sessionVersion: peopleTable.sessionVersion });
  // What they held when they left, as role names and colony ids: only the
  // rows in force at that moment, not ones that had already ended (review
  // minor 7).
  const held = await heldInForce(tx, personId);
  await recordPersonEvent(tx, {
    personId,
    kind: "left",
    by,
    detail: rolesAndColonies(held),
  });
  let withdrawnInvitations = 0;
  for (const { id } of sent.rows) {
    const closed = await closeInvitation(tx, id, by, "sender_left", { sender: personId });
    if (closed) withdrawnInvitations += 1;
  }
  return { ...row!, withdrawnInvitations };
}

/** What happens inside the change's own transaction, before it commits. */
export interface InTransaction<R> {
  /**
   * Runs first, inside the change's transaction, after the input has been
   * validated and before anything is read or written: the actions layer
   * takes its per-address lock and rolling 24-hour check here, so two
   * invitations to one address queue on it instead of racing to insert.
   * If it throws, nothing is changed.
   */
  beforeChange?: (tx: Tx, ctx: { email: string }) => Promise<void>;
  /**
   * Runs inside the change's transaction, after the change and its event:
   * the actions layer queues the emails here, so a change can't happen
   * without its notice, and a refused change queues nothing. If it throws,
   * the change is undone.
   */
  inTransaction?: (tx: Tx, result: R) => Promise<void>;
}

async function runHook<R>(tx: Tx, hooks: InTransaction<R> | undefined, result: R): Promise<R> {
  if (hooks?.inTransaction) await hooks.inTransaction(tx, result);
  return result;
}

// ── Read-only helpers for the mail path, on the db or a transaction ────────

/** Who an invitation message may go to, and what it says (§8.5). */
export interface InviteRecipient {
  id: string;
  email: string;
  language: PersonLanguage;
  /** Null until the first message went out. */
  inviteSentAt: Date | null;
  roles: PersonRole[];
  /** Her own placements' colonies, with their names now. */
  colonies: { id: number; name: string }[];
}

/**
 * The invitation's recipient, ONLY while she is pending (not accepted, not
 * left), unexpired by the database's clock and not anonymised (§8.5; plan
 * M9). Otherwise null, and no message may go. `lock` takes her row FOR
 * UPDATE for the rest of the CALLER's transaction only. The outbox's re-check
 * commits that transaction before the provider is called (review M-2), so
 * the lock does not cover the send: it only makes the re-check wait for a
 * withdrawal or acceptance that is mid-commit and read its outcome. A
 * change landing during the send itself is the in-flight window
 * personOutbox.ts describes.
 */
export async function inviteRecipient(
  exec: PeopleExec,
  personId: string,
  opts: {
    lock?: boolean;
    /**
     * For a RESEND only: an Expired invitation may still be delivered, since
     * management asked for a fresh 14 days and delivery gives them. Every
     * other condition (pending, not anonymised) still holds.
     */
    resend?: boolean;
  } = {},
): Promise<InviteRecipient | null> {
  if (!isPersonId(personId)) return null;
  const q = exec
    .select({
      id: peopleTable.id,
      email: peopleTable.email,
      language: peopleTable.language,
      inviteSentAt: peopleTable.inviteSentAt,
    })
    .from(peopleTable)
    .where(
      and(
        eq(peopleTable.id, personId),
        isPending(),
        opts.resend ? undefined : sql`${peopleTable.inviteExpiresAt} > now()`,
        notAnonymised(),
      ),
    );
  const [row] = opts.lock ? await q.for("update") : await q;
  if (!row) return null;
  const { roles, colonies } = await placementsOf(exec, personId);
  return { ...row, language: asLanguage(row.language), roles, colonies };
}

/** In-force roles and colonies (with names) of one person, for wording. */
async function placementsOf(exec: PeopleExec, personId: string) {
  const scopes = await exec
    .select({
      role: personScopesTable.role,
      colonyId: personScopesTable.colonyId,
      colonyName: coloniesTable.name,
    })
    .from(personScopesTable)
    .leftJoin(coloniesTable, eq(coloniesTable.id, personScopesTable.colonyId))
    .where(and(eq(personScopesTable.personId, personId), scopeInForce()))
    .orderBy(asc(personScopesTable.id));
  const roles = [...new Set(scopes.map((s) => s.role).filter(isRole))];
  const colonies = scopes
    .filter((s) => s.colonyId !== null && s.colonyName !== null)
    .map((s) => ({ id: s.colonyId!, name: s.colonyName! }));
  return { roles, colonies };
}

/**
 * A management member who may get an access-change notice: joined, on the
 * list, with management in force now. Null otherwise.
 */
export async function managerRecipient(
  exec: PeopleExec,
  personId: string,
): Promise<{ id: string; email: string; language: PersonLanguage } | null> {
  if (!isPersonId(personId)) return null;
  const [row] = await exec
    .select({ id: peopleTable.id, email: peopleTable.email, language: peopleTable.language })
    .from(peopleTable)
    .innerJoin(personScopesTable, eq(personScopesTable.personId, peopleTable.id))
    .where(
      and(
        eq(peopleTable.id, personId),
        isNull(peopleTable.leftAt),
        isNotNull(peopleTable.acceptedAt),
        eq(personScopesTable.role, "management"),
        scopeInForce(),
      ),
    )
    .limit(1);
  return row ? { ...row, language: asLanguage(row.language) } : null;
}

/**
 * Every management member to tell about a change (§8.3): joined, on the
 * list, management in force, and never the person who made it.
 */
export async function managersToNotify(
  exec: PeopleExec,
  actorId: string,
): Promise<{ id: string; email: string }[]> {
  const rows = await exec
    .selectDistinct({ id: peopleTable.id, email: peopleTable.email })
    .from(peopleTable)
    .innerJoin(personScopesTable, eq(personScopesTable.personId, peopleTable.id))
    .where(
      and(
        isNull(peopleTable.leftAt),
        isNotNull(peopleTable.acceptedAt),
        eq(personScopesTable.role, "management"),
        scopeInForce(),
      ),
    )
    .orderBy(asc(peopleTable.id));
  return rows.filter((r) => r.id !== actorId);
}

/** Names of these people, whatever their state, by id. */
export async function peopleNames(
  exec: PeopleExec,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter(isPersonId))];
  if (wanted.length === 0) return new Map();
  const rows = await exec
    .select({ id: peopleTable.id, name: peopleTable.name })
    .from(peopleTable)
    .where(inArray(peopleTable.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Names of these colonies, by id. */
export async function colonyNames(
  exec: PeopleExec,
  ids: readonly number[],
): Promise<Map<number, string>> {
  const wanted = [...new Set(ids.filter((i) => Number.isInteger(i) && i > 0))];
  if (wanted.length === 0) return new Map();
  const rows = await exec
    .select({ id: coloniesTable.id, name: coloniesTable.name })
    .from(coloniesTable)
    .where(inArray(coloniesTable.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * The outbox has delivered an invitation message (plan PR 1.1; brief point
 * 4). In the delivering transaction: `invite_sent_at` and a fresh 14-day
 * expiry, and `invite_sent` (the first message) or `invite_resent`. Guarded
 * like every change to an invitation: only while she is still pending.
 * False if she no longer was (nothing written).
 */
export async function recordInviteDelivered(
  tx: Tx,
  personId: string,
  kind: "invite_sent" | "invite_resent",
  by: string,
): Promise<boolean> {
  const [row] = await tx
    .update(peopleTable)
    .set({
      inviteSentAt: sql`now()`,
      inviteExpiresAt: sql`now() + ${INVITATION_INTERVAL}`,
    })
    .where(and(eq(peopleTable.id, personId), isPending(), notAnonymised()))
    .returning({ id: peopleTable.id });
  if (!row) return false;
  await recordPersonEvent(tx, { personId, kind, by });
  return true;
}

/**
 * The people operations, bound to one database. `@workspace/db` exports
 * these bound to the app's database; the `people` command and the tests bind
 * them to the database they name.
 */
export function peopleStore(db: PeopleDb) {
  // The two rules (Decision 7; roles-and-invites.md §10.1): a person with
  // left_at set is not on the list, and nor is one who has not accepted.
  // findAllowedPerson and findPersonById are every reader of "who is allowed
  // in", and both apply them.
  /**
   * This person's roles that are in force now, dropping any the code doesn't
   * know. A placement whose end date has passed is dropped here, by the
   * DATABASE's clock (`now()`), never this process's (roles-and-invites.md
   * §6.6; SYC-53 PR 0.5, T6): it stops working at the next request after its
   * end, with no job run. can() reads no clock; it trusts this.
   */
  async function scopesOf(id: string): Promise<PersonWithScopes["scopes"]> {
    const scopes = await db
      .select({
        role: personScopesTable.role,
        colonyId: personScopesTable.colonyId,
        reach: personScopesTable.reach,
        expiresAt: personScopesTable.expiresAt,
      })
      .from(personScopesTable)
      .where(and(eq(personScopesTable.personId, id), scopeInForce()));
    return scopes.filter((s): s is PersonWithScopes["scopes"][number] =>
      isRole(s.role),
    );
  }

  async function findPersonByEmail(
    email: string,
  ): Promise<PersonWithScopes | null> {
    const [row] = await db
      .select({
        id: peopleTable.id,
        name: peopleTable.name,
        email: peopleTable.email,
        sessionVersion: peopleTable.sessionVersion,
        language: peopleTable.language,
      })
      .from(peopleTable)
      .where(
        and(
          eq(peopleTable.email, normaliseEmail(email)),
          isNull(peopleTable.leftAt),
          // Joined, not merely invited (roles-and-invites.md §10.1): a
          // pending person is never a CapabilityHolder.
          isNotNull(peopleTable.acceptedAt),
        ),
      );
    if (!row) return null;
    return {
      ...row,
      language: asLanguage(row.language),
      scopes: await scopesOf(row.id),
    };
  }

  async function findInviteeById(id: string): Promise<Invitee | null> {
    if (!isPersonId(id)) return null;
    const [row] = await db
      .select({
        id: peopleTable.id,
        name: peopleTable.name,
        sessionVersion: peopleTable.sessionVersion,
        language: peopleTable.language,
      })
      .from(peopleTable)
      .where(and(eq(peopleTable.id, id), isInvitedNow()));
    return row ? { ...row, language: asLanguage(row.language) } : null;
  }

  return {
    /**
     * One transaction: the person and their roles, or nothing. An address
     * that has left rejoins the same row (Decision 7): the same id, so their
     * history stays theirs, with left_at cleared, a new session_version, and
     * the roles given here in place of the ones they had.
     */
    async addPerson(
      input: AddPersonInput,
    ): Promise<AllowedPerson & { rejoined: boolean }> {
      const email = normaliseEmail(input.email);
      const check = checkPersonEmail(email);
      if (!check.ok) throw new PeopleError(check.reason);
      const name = input.name.trim();
      if (!name) throw new PeopleError("Every person needs a name.");
      const roles = [...new Set(input.roles ?? ["staff"])];
      if (roles.length === 0) throw new PeopleError("Give at least one role.");
      for (const role of roles) checkRole(role);
      // Management is never given by `add` (PR 0.3, review minor 5): it is
      // given with set-roles, as a recorded roles change, to someone already
      // on the list. (Since PR 0.5 management lets someone in on its own.)
      if (roles.includes("management")) {
        throw new PeopleError(
          "Management can't be given when adding someone. Add them as staff, then use set-roles --add management.",
        );
      }
      const colonyId = input.colonyId ?? null;
      if (roles.includes("guardian")) {
        if (colonyId === null) {
          throw new PeopleError(
            "A cat guardian needs a colony: give its number with --colony.",
          );
        }
        checkColonyId(colonyId);
      } else if (colonyId !== null) {
        throw new PeopleError(
          "Only a cat guardian is placed on a colony; the other roles are island-wide.",
        );
      }
      const language = input.language ?? "en";
      if (!(PERSON_LANGUAGES as readonly string[]).includes(language)) {
        throw new PeopleError(
          `"${language}" isn't a language. Languages are: ${PERSON_LANGUAGES.join(", ")}.`,
        );
      }
      const rows = (personId: string) =>
        (roles as PersonRole[]).map((role) =>
          scopeRow(personId, role, colonyId, input.addedBy),
        );
      return db.transaction(async (tx) => {
        // Looked up first, so a missing unique constraint can't let a second
        // row in quietly.
        const [existing] = await tx
          .select({ id: peopleTable.id, leftAt: peopleTable.leftAt })
          .from(peopleTable)
          .where(eq(peopleTable.email, email))
          .for("update");
        if (existing && existing.leftAt === null)
          throw new PeopleError("That address is already on the list.");
        if (existing) {
          const [person] = await tx
            .update(peopleTable)
            .set({
              name,
              leftAt: null,
              leftBy: null,
              // Added back directly, so joined at once. (Bringing someone
              // back by invitation, which leaves this null, is PR 1.1's.)
              acceptedAt: sql`now()`,
              language: language as PersonLanguage,
              sessionVersion: sql`${peopleTable.sessionVersion} + 1`,
            })
            .where(eq(peopleTable.id, existing.id))
            .returning({
              id: peopleTable.id,
              name: peopleTable.name,
              email: peopleTable.email,
              sessionVersion: peopleTable.sessionVersion,
            });
          await tx
            .delete(personScopesTable)
            .where(eq(personScopesTable.personId, existing.id));
          await tx.insert(personScopesTable).values(rows(existing.id));
          await recordPersonEvent(tx, {
            personId: existing.id,
            kind: "rejoined",
            by: input.addedBy,
            detail: { roles, colonyIds: colonyId === null ? [] : [colonyId] },
          });
          return { ...person!, rejoined: true };
        }
        const id = crypto.randomUUID();
        const [person] = await tx
          .insert(peopleTable)
          .values({
            id,
            email,
            name,
            addedBy: input.addedBy,
            // addPerson adds someone directly (the `people` command's
            // --accepted, and the tests): joined at once. An invitation,
            // which leaves this null, is invitePerson's (PR 1.1).
            acceptedAt: sql`now()`,
            language: language as PersonLanguage,
          })
          .returning({
            id: peopleTable.id,
            name: peopleTable.name,
            email: peopleTable.email,
            sessionVersion: peopleTable.sessionVersion,
          });
        await tx.insert(personScopesTable).values(rows(id));
        await recordPersonEvent(tx, {
          personId: id,
          kind: "added",
          by: input.addedBy,
          detail: { roles, colonyIds: colonyId === null ? [] : [colonyId] },
        });
        return { ...person!, rejoined: false };
      });
    },

    /**
     * Marks this person as left (Decision 7), by address: the `people`
     * command's mark-left. Sets left_at and left_by and raises
     * session_version in one transaction, so an open session dies at its
     * next request even before the left_at check is reached. The row, and so
     * everything attributed to them, stays. Every pending invitation they
     * sent is withdrawn with them (§9.2). The last management person is
     * refused unless `force` (the break-glass, as for `setRoles`; §9.5,
     * SYC-333). Null if the address isn't in the table at all.
     */
    async markLeft(
      email: string,
      by: string,
      opts: { force?: boolean } = {},
    ): Promise<MarkLeftResult | null> {
      const normalised = normaliseEmail(email);
      return db.transaction(async (tx) => {
        const [person] = await tx
          .select({ id: peopleTable.id, leftAt: peopleTable.leftAt, acceptedAt: peopleTable.acceptedAt })
          .from(peopleTable)
          .where(eq(peopleTable.email, normalised))
          .for("update");
        if (!person) return null;
        // Marking again would overwrite when, and by whom, they left.
        if (person.leftAt !== null) {
          throw new PeopleError("That person is already marked as left.");
        }
        // Someone invited who hasn't joined (review minor 6): their invitation
        // is withdrawn exactly as withdrawInvitation does, so a stranger's
        // address is anonymised rather than kept.
        if (person.acceptedAt === null) {
          await closeInvitation(tx, person.id, by, "withdrawn");
          const [after] = await tx
            .select({ sessionVersion: peopleTable.sessionVersion })
            .from(peopleTable)
            .where(eq(peopleTable.id, person.id));
          return {
            id: person.id,
            sessionVersion: after!.sessionVersion,
            withdrawnInvitations: 0,
            invitationWithdrawn: true as const,
          };
        }
        return leave(tx, person.id, by, { force: opts.force === true });
      });
    },

    /**
     * Changes one person's roles (`people set-roles`; plan PR 0.3, Decision
     * A1). It is also the break-glass, so it is hard to misuse: `add` and
     * `remove` change one role and leave the rest alone, a whole new list
     * needs `replace`, a result with neither `staff` nor `management` is
     * refused unless `force` is given (since plan PR 0.5 either one lets
     * someone in; SYC-316), and so is taking management from the last
     * person who holds it (§9.5). Writes one
     * `roles_changed` event, with the roles before and after, in the same
     * transaction. A person who has left is refused: add them again.
     */
    async setRoles(input: SetRolesInput): Promise<SetRolesResult> {
      const modes = [input.add, input.remove, input.replace].filter(
        (m) => m !== undefined,
      );
      if (modes.length !== 1) {
        throw new PeopleError(
          "Give exactly one change: --add <role>, --remove <role>, or --replace <role> for a whole new list.",
        );
      }
      const colonyId = input.colonyId ?? null;
      if (colonyId !== null) checkColonyId(colonyId);
      const single = input.add ?? input.remove;
      const start = input.start === true;
      if (start && (input.add !== "guardian" || colonyId !== null)) {
        throw new PeopleError(
          "--start is only for --add guardian, with no --colony: a cat guardian with no colony yet.",
        );
      }
      if (single !== undefined) {
        checkRole(single);
        if (single === "guardian" && colonyId === null && !start) {
          throw new PeopleError(
            "A cat guardian is placed on a colony: give its number with --colony.",
          );
        }
        if (single !== "guardian" && colonyId !== null) {
          throw new PeopleError(
            "Only a cat guardian is placed on a colony; the other roles are island-wide.",
          );
        }
      }
      const replace = input.replace ? [...new Set(input.replace)] : undefined;
      if (replace) {
        if (replace.length === 0) {
          throw new PeopleError("--replace needs at least one role.");
        }
        for (const role of replace) checkRole(role);
        if (replace.includes("guardian") || colonyId !== null) {
          throw new PeopleError(
            "A cat guardian placement is added one colony at a time: use --add guardian --colony <number>.",
          );
        }
      }
      const email = normaliseEmail(input.email);
      return db.transaction(async (tx) => {
        const [person] = await tx
          .select({ id: peopleTable.id, leftAt: peopleTable.leftAt })
          .from(peopleTable)
          .where(eq(peopleTable.email, email))
          .for("update");
        if (!person) {
          throw new PeopleError(
            "That address isn't on the list. Nothing was changed.",
          );
        }
        if (person.leftAt !== null) {
          throw new PeopleError(
            "That person has left. Add them again first. Nothing was changed.",
          );
        }
        // Every management row is locked first, always in the same order,
        // before this person's own rows: two managers demoting each other at
        // once then queue here instead of deadlocking, and the second sees
        // the first's change when it counts (the last-manager guard below).
        await tx
          .select({ id: personScopesTable.id })
          .from(personScopesTable)
          .where(eq(personScopesTable.role, "management"))
          .orderBy(asc(personScopesTable.id))
          .for("update");
        // Rows whose end has passed are kept as the record of what was held
        // (PR 1.1); they don't count as held here, and adding one back
        // updates that row instead of inserting a second.
        const allHeld = await heldRows(tx, person.id);
        const held = allHeld.filter((h) => h.inForce);
        const ended = allHeld.filter((h) => !h.inForce);
        const before = held.map(scopeLabel).sort();
        const holds = (role: string, colony: number | null) =>
          held.some((h) => h.role === role && h.colonyId === colony);

        const toDelete: number[] = [];
        const toInsert: { role: PersonRole; colonyId: number | null; start?: true }[] = [];
        const toRevive: number[] = [];
        // A "no colony yet" row (SYC-439) never sits beside another row in
        // force: anything this adds clears it, in this transaction.
        const startRows = held.filter((h) => h.reach === "start");
        if (input.add !== undefined && start) {
          if (startRows.length > 0) {
            throw new PeopleError(`They already hold ${START_LABEL}. Nothing was changed.`);
          }
          if (held.length > 0) throw new PeopleError(`${START_ALONE} Nothing was changed.`);
          toInsert.push({ role: "guardian", colonyId: null, start: true });
        } else if (input.add !== undefined) {
          const role = input.add as PersonRole;
          const colony = role === "guardian" ? colonyId : null;
          for (const r of startRows) toDelete.push(r.id);
          if (holds(role, colony)) {
            throw new PeopleError(
              `They already hold ${scopeLabel({ role, colonyId: colony })}. Nothing was changed.`,
            );
          }
          // Since plan PR 0.5, can() honours management on its own, so
          // management no longer has to sit beside staff (SYC-316).
          const old = ended.find((h) => h.role === role && h.colonyId === colony);
          if (old) toRevive.push(old.id);
          else toInsert.push({ role, colonyId: colony });
        } else if (input.remove !== undefined) {
          const role = input.remove;
          const colony = role === "guardian" ? colonyId : null;
          const row = held.find(
            (h) => h.role === role && h.colonyId === colony && h.reach !== "start",
          );
          if (!row) {
            throw new PeopleError(
              `They don't hold ${scopeLabel({ role, colonyId: colony })}. Nothing was changed.`,
            );
          }
          toDelete.push(row.id);
        } else {
          const wanted = replace as PersonRole[];
          for (const h of held) {
            if (h.colonyId !== null || !wanted.includes(h.role as PersonRole))
              toDelete.push(h.id);
          }
          for (const role of wanted) {
            if (holds(role, null)) continue;
            const old = ended.find((h) => h.role === role && h.colonyId === null);
            if (old) toRevive.push(old.id);
            else toInsert.push({ role, colonyId: null });
          }
        }

        const after = [
          ...held.filter((h) => !toDelete.includes(h.id)).map(scopeLabel),
          ...toInsert.map((r) => scopeLabel({ ...r, reach: r.start ? "start" : null })),
          ...ended.filter((h) => toRevive.includes(h.id)).map(scopeLabel),
        ].sort();
        // Since plan PR 0.5, staff and management each let someone in on
        // their own (SYC-316 relaxed review M1's "staff must stay"). Without
        // either, they would be locked out of the team's pages, unless forced.
        const afterRoles = after.map((label) => label.split(":")[0]!);
        if (
          !afterRoles.some((r) => (ISLAND_ROLES as readonly string[]).includes(r)) &&
          !input.force
        ) {
          throw new PeopleError(
            `That would leave them with no staff or management role (${after.join(", ") || "no roles at all"}), so they would be locked out. Nothing was changed. Give --force if that is really meant.`,
          );
        }
        const droppedPlacements = held
          .filter((h) => h.colonyId !== null && toDelete.includes(h.id))
          .map(scopeLabel)
          .sort();
        // The last manager (roles spec §9.5; SYC-316): taking management
        // from the only person who holds it would leave nobody who can
        // invite anyone. Refused unless forced; this command is the
        // break-glass. The management rows were locked above, so two
        // managers removing each other at once can't both pass the count.
        const losesManagement =
          held.some((h) => h.role === "management") &&
          !afterRoles.includes("management");
        if (losesManagement) {
          const managers = await tx
            .select({ personId: personScopesTable.personId })
            .from(personScopesTable)
            .innerJoin(peopleTable, eq(peopleTable.id, personScopesTable.personId))
            .where(
              and(
                isNull(peopleTable.leftAt),
                isNotNull(peopleTable.acceptedAt),
                // Only a management row with no end date counts: an ended
                // one lets nobody in (review finding 3b), and one due to end
                // would leave nobody in charge when it does (PR 1.1 review
                // M-1).
                lastingManagement(),
              ),
            );
          const others = managers.filter((m) => m.personId !== person.id);
          if (others.length === 0 && !input.force) {
            throw new PeopleError(
              "They are the last person with management. Nobody else could invite or remove anyone. Nothing was changed. Give --force if that is really meant.",
            );
          }
        }
        if (toDelete.length) {
          await tx
            .delete(personScopesTable)
            .where(inArray(personScopesTable.id, toDelete));
        }
        if (toRevive.length) {
          await tx
            .update(personScopesTable)
            .set({ expiresAt: null, grantedBy: input.by, grantedAt: sql`now()` })
            .where(inArray(personScopesTable.id, toRevive));
        }
        if (toInsert.length) {
          await tx
            .insert(personScopesTable)
            .values(
              toInsert.map((r) =>
                scopeRow(person.id, r.role, r.colonyId, input.by, r.start === true),
              ),
            );
        }
        await recordPersonEvent(tx, {
          personId: person.id,
          kind: "roles_changed",
          by: input.by,
          detail: { before, after },
        });
        return {
          id: person.id,
          before,
          after,
          droppedPlacements: input.replace ? droppedPlacements : [],
        };
      });
    },

    /**
     * Signs this person out on every device, and records who did it. Their
     * new version, or null if the address isn't in the table.
     */
    async signOutEverywhere(email: string, by: string): Promise<number | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(peopleTable)
          .set({ sessionVersion: sql`${peopleTable.sessionVersion} + 1` })
          .where(eq(peopleTable.email, normaliseEmail(email)))
          .returning({
            id: peopleTable.id,
            sessionVersion: peopleTable.sessionVersion,
          });
        if (!row) return null;
        await recordPersonEvent(tx, {
          personId: row.id,
          kind: "signed_out_everywhere",
          by,
        });
        return row.sessionVersion;
      });
    },

    // ── SYC-53 PR 1.1 ─────────────────────────────────────────────────────

    /**
     * Invites someone (§4.1, §8.1, §10.2): a pending person (`accepted_at`
     * null), her placements and an `invited` event, in one transaction. The
     * invitation is good for 14 days from now even if the message never goes
     * (so an unsent one can't live forever); delivery sets a fresh 14 days.
     * The event records the language asked for and the one actually used
     * (review minor 10: a language not yet live is sent in English).
     * Refuses an address already on the list or already invited, and one
     * that has left (bring them back instead).
     */
    async invitePerson(
      by: string,
      input: {
        email: string;
        name: string;
        placements: readonly PlacementInput[];
        language: string;
        /** The language the message will really be in (LIVE_LANGUAGES). */
        languageUsed: string;
      },
      hooks?: InTransaction<{ id: string; email: string }>,
    ): Promise<{ id: string; email: string }> {
      const email = normaliseEmail(input.email);
      const check = checkPersonEmail(email);
      if (!check.ok) throw new PeopleError(check.reason);
      if (isAnonymisedEmail(email)) throw new PeopleError("That isn't an email address.");
      const name = checkName(input.name);
      const language = checkLanguage(input.language);
      const languageUsed = checkLanguage(input.languageUsed);
      const placements = checkPlacements(input.placements);
      return db.transaction(async (tx) => {
        if (hooks?.beforeChange) await hooks.beforeChange(tx, { email });
        const [existing] = await tx
          .select({ id: peopleTable.id, leftAt: peopleTable.leftAt })
          .from(peopleTable)
          .where(eq(peopleTable.email, email))
          .for("update");
        if (existing && existing.leftAt === null) {
          throw new PeopleError("That address is already on the list, or already invited.");
        }
        if (existing) {
          throw new PeopleError(
            "That address belongs to someone who has left. Bring them back instead.",
          );
        }
        const id = crypto.randomUUID();
        await tx.insert(peopleTable).values({
          id,
          email,
          name,
          addedBy: by,
          acceptedAt: null,
          inviteExpiresAt: sql`now() + ${INVITATION_INTERVAL}`,
          language,
        });
        await writePlacements(tx, id, placements, by);
        await recordPersonEvent(tx, {
          personId: id,
          kind: "invited",
          by,
          detail: { ...rolesAndColonies(placements), language, languageUsed },
        });
        return runHook(tx, hooks, { id, email });
      });
    },

    /**
     * Someone invited and not expired (§10.1 "Invited", exactly, by the
     * database's clock), by id: the hand-off, the accept page and the
     * decline route. Returns no placements: an invitee is never a
     * CapabilityHolder.
     */
    findInvitee: findInviteeById,

    /** The same, by address: the allow-list's answer for an invitee (§4.5). */
    async findInviteeByEmail(email: string): Promise<Invitee | null> {
      const [row] = await db
        .select({
          id: peopleTable.id,
          name: peopleTable.name,
          sessionVersion: peopleTable.sessionVersion,
          language: peopleTable.language,
        })
        .from(peopleTable)
        .where(and(eq(peopleTable.email, normaliseEmail(email)), isInvitedNow()));
      return row ? { ...row, language: asLanguage(row.language) } : null;
    },

    /**
     * What the accept page says (§4.1 step 4): who invited her (the person
     * behind the latest `invited` event, if a person), and for what (her own
     * placements in force, with colony names). Only for someone Invited.
     */
    async invitationFor(id: string): Promise<{
      invitee: Invitee;
      inviterName: string | null;
      roles: PersonRole[];
      colonies: { id: number; name: string }[];
    } | null> {
      const invitee = await findInviteeById(id);
      if (!invitee) return null;
      const [event] = await db
        .select({ by: personEventsTable.by })
        .from(personEventsTable)
        .where(and(eq(personEventsTable.personId, id), eq(personEventsTable.kind, "invited")))
        .orderBy(sql`${personEventsTable.id} desc`)
        .limit(1);
      const names = await peopleNames(db, event ? [event.by] : []);
      const { roles, colonies } = await placementsOf(db, id);
      return {
        invitee,
        inviterName: event ? names.get(event.by) ?? null : null,
        roles,
        colonies,
      };
    },

    /**
     * Yes, join (§10.1): ONE conditional update, `where accepted_at is null
     * and left_at is null and the message went out and invite_expires_at >
     * now()`, so whichever of accept, withdraw and expiry comes first wins
     * and the other changes nothing. Sets her name (trimmed; the pre-filled
     * one if she cleared it), clears the expiry, raises the session version
     * (so the pending session is spent) and writes `accepted` with the
     * version of the promises she read. Null if it didn't win.
     */
    async acceptInvitation(
      id: string,
      rawName: string,
      promisesVersion: string,
    ): Promise<{ id: string; sessionVersion: number } | null> {
      if (!isPersonId(id)) return null;
      if (!/^promises-v[1-9][0-9]*$/.test(promisesVersion)) {
        throw new PeopleError("Unknown version of the promises.");
      }
      const cleaned = cleanPersonName(rawName ?? "");
      const name = cleaned === "" ? null : checkName(cleaned);
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(peopleTable)
          .set({
            acceptedAt: sql`now()`,
            inviteExpiresAt: null,
            ...(name === null ? {} : { name }),
            sessionVersion: sql`${peopleTable.sessionVersion} + 1`,
          })
          .where(
            and(
              eq(peopleTable.id, id),
              isNull(peopleTable.acceptedAt),
              isNull(peopleTable.leftAt),
              isNotNull(peopleTable.inviteSentAt),
              sql`${peopleTable.inviteExpiresAt} > now()`,
            ),
          )
          .returning({ id: peopleTable.id, sessionVersion: peopleTable.sessionVersion });
        if (!row) return null;
        await recordPersonEvent(tx, {
          personId: id,
          kind: "accepted",
          by: "self",
          detail: { promisesVersion },
        });
        return row;
      });
    },

    /**
     * No, this isn't for me (§4.1, §9.6): the invitation is withdrawn by
     * her, she is marked as left, and anonymised if she never joined. Null
     * if it was no longer pending.
     */
    async declineInvitation(id: string) {
      if (!isPersonId(id)) return null;
      return db.transaction((tx) => closeInvitation(tx, id, "self", "declined"));
    },

    /**
     * Management withdraws a pending invitation (§4.4, §9.6). Null if it
     * was no longer pending (already accepted, declined or withdrawn).
     */
    async withdrawInvitation(
      by: string,
      id: string,
      hooks?: InTransaction<{ id: string; anonymised: boolean }>,
    ) {
      if (!isPersonId(id)) return null;
      return db.transaction(async (tx) => {
        const closed = await closeInvitation(tx, id, by, "withdrawn");
        return closed ? runHook(tx, hooks, closed) : null;
      });
    },

    /**
     * Resend (§4.4): a fresh 14 days, and a new message queued by the
     * caller's hook. One guarded update allows it only while she is pending
     * and not anonymised, no invitation message to her is still waiting in
     * the outbox, and none went out in the last 24 hours. The message's
     * `invite_resent` event is written when it is delivered.
     */
    async resendInvitation(
      by: string,
      id: string,
      hooks?: InTransaction<{ id: string; email: string }>,
    ): Promise<{ id: string; email: string }> {
      if (!isPersonId(id)) throw new PeopleError("That person isn't on the list.");
      return db.transaction(async (tx) => {
        // Locked and checked, never changed (review minor 1): the expiry only
        // moves when a message is actually delivered (recordInviteDelivered).
        // An undelivered resend must not turn an Expired invitation back
        // into a working one.
        const [row] = await tx
          .select({ id: peopleTable.id, email: peopleTable.email })
          .from(peopleTable)
          .where(
            and(
              eq(peopleTable.id, id),
              isPending(),
              notAnonymised(),
              sql`(${peopleTable.inviteSentAt} is null or ${peopleTable.inviteSentAt} <= now() - ${RESEND_INTERVAL})`,
              sql`not exists (select 1 from mail_outbox m
                               where m.purpose = 'person_invite'
                                 and m.state in ('queued', 'sending')
                                 and m.payload->>'personId' = ${peopleTable.id}::text)`,
            ),
          )
          .for("update");
        if (row) return runHook(tx, hooks, row);
        const [p] = await tx
          .select({
            leftAt: peopleTable.leftAt,
            acceptedAt: peopleTable.acceptedAt,
            sentAt: peopleTable.inviteSentAt,
            recent: sql<boolean>`${peopleTable.inviteSentAt} > now() - ${RESEND_INTERVAL}`,
          })
          .from(peopleTable)
          .where(eq(peopleTable.id, id));
        if (!p || p.leftAt !== null || p.acceptedAt !== null) {
          throw new PeopleError("That invitation isn't open any more. Nothing was sent.");
        }
        if (p.recent) {
          throw new PeopleError(
            "An invitation went to them less than 24 hours ago. Nothing was sent; try again tomorrow.",
          );
        }
        throw new PeopleError("Their invitation is still on its way. Nothing more was sent.");
      });
    },

    /**
     * Management changes someone's roles and placements (§8.1, §6.6): never
     * your own; not someone who has left (bring them back instead). The
     * placements given become exactly what they hold (see
     * `writePlacements`: putting a guardian back on a colony she once held
     * updates her old row). Taking management from the last person who holds
     * it is refused, under the same management lock as `setRoles` (§9.5;
     * SYC-333). Writes `roles_changed` with before and after (role names and
     * colony ids). Named apart from the `people` command's `setRoles(input)`,
     * which is unchanged.
     */
    async setPlacements(
      by: string,
      personId: string,
      input: readonly PlacementInput[],
      hooks?: InTransaction<SetPlacementsResult>,
    ): Promise<SetPlacementsResult> {
      if (by.toLowerCase() === personId.toLowerCase()) {
        throw new PeopleError("You can't change your own roles. Nothing was changed.");
      }
      if (!isPersonId(personId)) throw new PeopleError("That person isn't on the list.");
      const placements = checkPlacements(input);
      return db.transaction(async (tx) => {
        const [person] = await tx
          .select({ id: peopleTable.id, leftAt: peopleTable.leftAt })
          .from(peopleTable)
          .where(eq(peopleTable.id, personId))
          .for("update");
        if (!person) throw new PeopleError("That person isn't on the list.");
        if (person.leftAt !== null) {
          throw new PeopleError("That person has left. Bring them back instead. Nothing was changed.");
        }
        await lockManagementRows(tx);
        const losesManagement =
          (await holdsManagement(tx, personId)) &&
          !placements.some((p) => p.role === "management");
        if (losesManagement && (await otherManagers(tx, personId)) === 0) {
          throw new PeopleError(LAST_MANAGER);
        }
        const { before, after, changed } = await writePlacements(tx, personId, placements, by);
        if (!changed) {
          throw new PeopleError("They already hold exactly that. Nothing was changed.");
        }
        await recordPersonEvent(tx, {
          personId,
          kind: "roles_changed",
          by,
          detail: { before, after },
        });
        return runHook(tx, hooks, { id: personId, before, after });
      });
    },

    /**
     * Management marks someone as left (§9.1, §9.2): never yourself (use
     * "stop helping"), never someone who hasn't joined (withdraw the
     * invitation instead), never the last management person (no force here:
     * the `people` command is the break-glass). Withdraws every pending
     * invitation they sent, in the same transaction; the count is returned
     * for the screen's line.
     */
    async markLeftById(
      by: string,
      personId: string,
      hooks?: InTransaction<MarkLeftResult>,
    ): Promise<MarkLeftResult> {
      if (by.toLowerCase() === personId.toLowerCase()) {
        throw new PeopleError("You can't mark yourself as left here. Use Stop helping on your own page.");
      }
      if (!isPersonId(personId)) throw new PeopleError("That person isn't on the list.");
      return db.transaction(async (tx) => {
        const [person] = await tx
          .select({
            id: peopleTable.id,
            leftAt: peopleTable.leftAt,
            acceptedAt: peopleTable.acceptedAt,
          })
          .from(peopleTable)
          .where(eq(peopleTable.id, personId))
          .for("update");
        if (!person) throw new PeopleError("That person isn't on the list.");
        if (person.leftAt !== null) throw new PeopleError("That person is already marked as left.");
        if (person.acceptedAt === null) {
          throw new PeopleError("They haven't joined yet. Withdraw the invitation instead.");
        }
        return runHook(tx, hooks, await leave(tx, personId, by, { force: false }));
      });
    },

    /**
     * The person's own "stop helping" (§9.1, §9.5): recorded as `left` by
     * `self`. The same as being marked as left, invitations they sent
     * included, and the last management person can't (nobody could invite
     * anyone). The route is PR 1.3's.
     */
    async stopHelping(
      personId: string,
      hooks?: InTransaction<MarkLeftResult>,
    ): Promise<MarkLeftResult> {
      if (!isPersonId(personId)) throw new PeopleError("That person isn't on the list.");
      return db.transaction(async (tx) => {
        const [person] = await tx
          .select({ id: peopleTable.id })
          .from(peopleTable)
          .where(
            and(
              eq(peopleTable.id, personId),
              isNull(peopleTable.leftAt),
              isNotNull(peopleTable.acceptedAt),
            ),
          )
          .for("update");
        if (!person) throw new PeopleError("That person isn't on the list.");
        return runHook(tx, hooks, await leave(tx, personId, "self", { force: false }));
      });
    },

    /**
     * Signs someone out everywhere by id, for the screen (§8.1, §9.5): never
     * the last management person, checked under the shared management lock.
     * (The `people` command's `signOutEverywhere(email)` is the break-glass
     * and has no such guard.) Their new session version.
     */
    async signOutEverywhereById(
      by: string,
      personId: string,
      hooks?: InTransaction<{ id: string; sessionVersion: number }>,
    ): Promise<{ id: string; sessionVersion: number }> {
      if (!isPersonId(personId)) throw new PeopleError("That person isn't on the list.");
      return db.transaction(async (tx) => {
        const [person] = await tx
          .select({ id: peopleTable.id })
          .from(peopleTable)
          .where(and(eq(peopleTable.id, personId), isNull(peopleTable.leftAt)))
          .for("update");
        if (!person) throw new PeopleError("That person isn't on the list.");
        await lockManagementRows(tx);
        if ((await holdsManagement(tx, personId)) && (await otherManagers(tx, personId)) === 0) {
          throw new PeopleError(LAST_MANAGER);
        }
        const [row] = await tx
          .update(peopleTable)
          .set({ sessionVersion: sql`${peopleTable.sessionVersion} + 1` })
          .where(eq(peopleTable.id, personId))
          .returning({ id: peopleTable.id, sessionVersion: peopleTable.sessionVersion });
        await recordPersonEvent(tx, { personId, kind: "signed_out_everywhere", by });
        return runHook(tx, hooks, row!);
      });
    },

    /**
     * Bring back (§9.4): someone who has left becomes pending again, with
     * roles chosen afresh. `accepted_at` goes back to null, the new
     * placements are written (a colony she once held updates its old row),
     * and `rejoined` then `invited` are written; the caller's hook queues the
     * invitation, and she accepts again. Never an anonymised withdrawn
     * invitation (there is no address to invite).
     */
    async rejoinPerson(
      by: string,
      personId: string,
      input: readonly PlacementInput[],
      language: string,
      languageUsed: string,
      hooks?: InTransaction<{ id: string; email: string }>,
    ): Promise<{ id: string; email: string }> {
      if (!isPersonId(personId)) throw new PeopleError("That person isn't on the list.");
      const placements = checkPlacements(input);
      const lang = checkLanguage(language);
      const used = checkLanguage(languageUsed);
      return db.transaction(async (tx) => {
        // The address first, unlocked, so the caller's per-address check (and
        // its advisory lock) comes before this row's lock, in the same order
        // as invitePerson: advisory lock, then the people row.
        const [address] = await tx
          .select({ email: peopleTable.email })
          .from(peopleTable)
          .where(eq(peopleTable.id, personId));
        if (!address) throw new PeopleError("That person isn't on the list.");
        if (hooks?.beforeChange) await hooks.beforeChange(tx, { email: address.email });
        const [person] = await tx
          .select({ id: peopleTable.id, leftAt: peopleTable.leftAt, email: peopleTable.email })
          .from(peopleTable)
          .where(eq(peopleTable.id, personId))
          .for("update");
        if (!person) throw new PeopleError("That person isn't on the list.");
        if (person.leftAt === null) throw new PeopleError("They haven't left. Nothing was changed.");
        if (isAnonymisedEmail(person.email)) {
          throw new PeopleError("That was a withdrawn invitation. Invite the person afresh instead.");
        }
        await tx
          .update(peopleTable)
          .set({
            leftAt: null,
            leftBy: null,
            acceptedAt: null,
            inviteSentAt: null,
            inviteExpiresAt: sql`now() + ${INVITATION_INTERVAL}`,
            language: lang,
            sessionVersion: sql`${peopleTable.sessionVersion} + 1`,
          })
          .where(eq(peopleTable.id, personId));
        await writePlacements(tx, personId, placements, by);
        const intended = rolesAndColonies(placements);
        await recordPersonEvent(tx, { personId, kind: "rejoined", by, detail: intended });
        await recordPersonEvent(tx, {
          personId,
          kind: "invited",
          by,
          detail: { ...intended, language: lang, languageUsed: used },
        });
        return runHook(tx, hooks, { id: personId, email: person.email });
      });
    },

    /**
     * A colony made by someone on the list (Decision D; §6.1, §6.9; T30's
     * core). For a cat guardian (no island row): the colony (`created_by` =
     * her id), her placement on it (`reach = 'colony'`, `granted_by` = her own
     * id) and a `roles_changed` event, in one transaction, all or nothing.
     * For a team member: the colony only. The hook runs in the same
     * transaction (SYC-209's route adds its `colony_created` mapping event
     * there). The person is re-read inside the transaction, never trusted
     * from the caller.
     */
    async createColonyWithPlacement(
      person: { id: string },
      colony: { name: string; guardianName?: string | null; notes?: string | null },
      hooks?: InTransaction<{ colonyId: number; placed: boolean }>,
    ): Promise<{ colonyId: number; placed: boolean }> {
      const name = String(colony.name ?? "").trim();
      if (!name) throw new PeopleError("A colony needs a name.");
      if (!isPersonId(person.id)) throw new PeopleError("That person isn't on the list.");
      return db.transaction(async (tx) => {
        const [me] = await tx
          .select({ id: peopleTable.id })
          .from(peopleTable)
          .where(
            and(
              eq(peopleTable.id, person.id),
              isNull(peopleTable.leftAt),
              isNotNull(peopleTable.acceptedAt),
            ),
          )
          .for("update");
        if (!me) throw new PeopleError("That person isn't on the list.");
        const held = await heldInForce(tx, person.id);
        const island = held.some(
          (h) => (ISLAND_ROLES as readonly string[]).includes(h.role) && h.colonyId === null,
        );
        const guardian = held.some(
          (h) => h.role === "guardian" && h.colonyId !== null && h.reach === "colony",
        );
        // A cat guardian with no colony yet (SYC-439): read from the row's
        // reach, never from an empty colony.
        const starting = held.filter(
          (h) => h.role === "guardian" && h.colonyId === null && h.reach === "start",
        );
        if (!island && !guardian && starting.length === 0) {
          throw new PeopleError("Only the team or a cat guardian can create a colony.");
        }
        const [row] = await tx
          .insert(coloniesTable)
          .values({
            name,
            normalisedName: foldName(name),
            guardianName: colony.guardianName ?? null,
            notes: colony.notes ?? null,
            createdBy: person.id,
          })
          .returning({ id: coloniesTable.id });
        const colonyId = row!.id;
        if (island) return runHook(tx, hooks, { colonyId, placed: false });
        const before = held.map(scopeLabel).sort();
        await tx.insert(personScopesTable).values(
          scopeRow(person.id, "guardian", colonyId, person.id),
        );
        // Her first colony: "no colony yet" ends here, in this transaction
        // (SYC-439, spec §5 step 4). Selected by reach, after the colony
        // exists, so a name clash above leaves it untouched.
        if (starting.length > 0) {
          await tx
            .delete(personScopesTable)
            .where(
              and(
                eq(personScopesTable.personId, person.id),
                eq(personScopesTable.reach, "start"),
              ),
            );
        }
        const after = [
          ...held.filter((h) => h.reach !== "start").map(scopeLabel),
          scopeLabel({ role: "guardian", colonyId }),
        ].sort();
        await recordPersonEvent(tx, {
          personId: person.id,
          kind: "roles_changed",
          by: person.id,
          detail: { before, after, createdColony: colonyId },
        });
        return runHook(tx, hooks, { colonyId, placed: true });
      });
    },

    /**
     * This address's person, with their roles. Never someone who has left.
     * Being in the table is not being let in: callers decide that with the
     * roles, through can() (SYC-188).
     */
    findAllowedPerson: findPersonByEmail,

    /**
     * The person behind a hand-off pass or session, with their roles. Never
     * someone who has left.
     */
    async findPersonById(id: string): Promise<PersonWithScopes | null> {
      // Anything that isn't a uuid would make Postgres throw; it simply isn't
      // on the list.
      if (!isPersonId(id)) return null;
      const [person] = await db
        .select({
          id: peopleTable.id,
          name: peopleTable.name,
          email: peopleTable.email,
          sessionVersion: peopleTable.sessionVersion,
          language: peopleTable.language,
        })
        .from(peopleTable)
        .where(
          and(
            eq(peopleTable.id, id),
            isNull(peopleTable.leftAt),
            isNotNull(peopleTable.acceptedAt),
          ),
        );
      if (!person) return null;
      return {
        ...person,
        language: asLanguage(person.language),
        scopes: await scopesOf(id),
      };
    },

    /**
     * A cat guardian's own placements that are in force now, by the
     * DATABASE's clock, for "My colonies" and "My page" (PR 1.3): the colony's
     * name, the label the team gave it (null for none) and when the placement
     * ends (null for never). An ended placement is not returned. Nothing here
     * grants anything; it is only what she is shown about herself.
     */
    async myColonies(personId: string): Promise<
      { colonyId: number; name: string; relationship: string | null; expiresAt: Date | null }[]
    > {
      if (!isPersonId(personId)) return [];
      const rows = await db
        .select({
          colonyId: personScopesTable.colonyId,
          name: coloniesTable.name,
          relationship: personScopesTable.relationship,
          expiresAt: personScopesTable.expiresAt,
        })
        .from(personScopesTable)
        .innerJoin(coloniesTable, eq(coloniesTable.id, personScopesTable.colonyId))
        .where(
          and(
            eq(personScopesTable.personId, personId),
            eq(personScopesTable.role, "guardian"),
            scopeInForce(),
          ),
        )
        .orderBy(asc(coloniesTable.name), asc(coloniesTable.id));
      return rows.map((r) => ({ ...r, colonyId: r.colonyId! }));
    },

    /**
     * A person's own choice of language (PR 1.3). Only a language we have
     * (en, el, fr); only for someone who is on the list. True if it was saved.
     */
    async setOwnLanguage(personId: string, language: string): Promise<boolean> {
      if (!isPersonId(personId)) return false;
      const lang = checkLanguage(language);
      const rows = await db
        .update(peopleTable)
        .set({ language: lang })
        .where(and(eq(peopleTable.id, personId), isNull(peopleTable.leftAt), isNotNull(peopleTable.acceptedAt)))
        .returning({ id: peopleTable.id });
      return rows.length === 1;
    },

    /**
     * Everybody, for the People screen (PR 1.2): the invitation columns
     * `personState` reads, every placement with its end date and label, and
     * the full history with its detail. Oldest first. Reads only.
     */
    async peopleScreen(): Promise<ScreenPerson[]> {
      const people = await db
        .select()
        .from(peopleTable)
        .orderBy(asc(peopleTable.addedAt), asc(peopleTable.email));
      const scopes = await db
        .select({
          personId: personScopesTable.personId,
          role: personScopesTable.role,
          colonyId: personScopesTable.colonyId,
          reach: personScopesTable.reach,
          expiresAt: personScopesTable.expiresAt,
          relationship: personScopesTable.relationship,
          inForce: sql<boolean>`(${personScopesTable.expiresAt} is null or ${personScopesTable.expiresAt} > now())`,
        })
        .from(personScopesTable)
        .orderBy(asc(personScopesTable.id));
      const events = await db
        .select()
        .from(personEventsTable)
        .orderBy(asc(personEventsTable.id));
      return people.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        language: p.language,
        addedAt: p.addedAt,
        addedBy: p.addedBy,
        leftAt: p.leftAt,
        leftBy: p.leftBy,
        acceptedAt: p.acceptedAt,
        inviteSentAt: p.inviteSentAt,
        inviteExpiresAt: p.inviteExpiresAt,
        placements: scopes
          .filter((s) => s.personId === p.id)
          .map(({ personId: _p, ...rest }) => rest),
        history: events
          .filter((e) => e.personId === p.id)
          .map((e) => ({
            kind: e.kind,
            at: e.at,
            by: e.by,
            detail:
              e.detail && typeof e.detail === "object" && !Array.isArray(e.detail)
                ? (e.detail as Record<string, unknown>)
                : null,
          })),
      }));
    },

    /**
     * Everybody in the table, with their roles, oldest first. That includes
     * people who have left (leftAt set), so the command can show them.
     */
    async listPeople(): Promise<
      (AllowedPerson & {
        roles: string[];
        addedAt: Date;
        addedBy: string | null;
        leftAt: Date | null;
        leftBy: string | null;
        /** Null while the person is invited but has not joined. */
        acceptedAt: Date | null;
        language: string;
        /** Oldest first: kind, when, and by whom (ids only). */
        history: { kind: string; at: Date; by: string }[];
      })[]
    > {
      const people = await db
        .select()
        .from(peopleTable)
        .orderBy(asc(peopleTable.addedAt), asc(peopleTable.email));
      // Whether each row is in force, by the database's clock (review minor 7).
      const scopes = await db
        .select({
          personId: personScopesTable.personId,
          role: personScopesTable.role,
          colonyId: personScopesTable.colonyId,
          reach: personScopesTable.reach,
          inForce: sql<boolean>`(${personScopesTable.expiresAt} is null or ${personScopesTable.expiresAt} > now())`,
        })
        .from(personScopesTable);
      const events = await db
        .select({
          personId: personEventsTable.personId,
          kind: personEventsTable.kind,
          at: personEventsTable.at,
          by: personEventsTable.by,
        })
        .from(personEventsTable)
        .orderBy(asc(personEventsTable.id));
      return people.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        sessionVersion: p.sessionVersion,
        addedAt: p.addedAt,
        addedBy: p.addedBy,
        leftAt: p.leftAt,
        leftBy: p.leftBy,
        acceptedAt: p.acceptedAt,
        language: p.language,
        history: events
          .filter((e) => e.personId === p.id)
          .map((e) => ({ kind: e.kind, at: e.at, by: e.by })),
        // A placement whose end has passed is shown, marked as ended.
        roles: scopes
          .filter((s) => s.personId === p.id)
          .map((s) =>
            s.reach === "start"
              ? "guardian (no colony yet)"
              : s.inForce
                ? scopeLabel(s)
                : `${scopeLabel(s)} (ended)`,
          ),
      }));
    },
  };
}

export type PeopleStore = ReturnType<typeof peopleStore>;
