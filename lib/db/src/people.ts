import crypto from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";
import {
  PERSON_LANGUAGES,
  ISLAND_ROLES,
  PERSON_ROLES,
  ROLE_MAILBOX_LOCAL_PARTS,
  peopleTable,
  personScopesTable,
  type PersonLanguage,
  type PersonRole,
  type ScopeReach,
} from "./schema/people";
import { personEventsTable, type PersonEventKind } from "./schema/personEvents";

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

/** One placement as a label: the role, with `:<colony id>` when placed. */
const scopeLabel = (s: { role: string; colonyId: number | null }) =>
  s.colonyId === null ? s.role : `${s.role}:${s.colonyId}`;

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
) {
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

export interface MarkLeftResult {
  id: string;
  sessionVersion: number;
}

/**
 * The open transaction a change is running in, and nothing else: passing the
 * database itself (`db`) does not compile, so an event can't be written
 * outside the transaction of its change.
 */
type Tx = Parameters<Parameters<PeopleDb["transaction"]>[0]>[0];

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
     * Marks this person as left (Decision 7): sets left_at and left_by and
     * raises session_version in one transaction, so an open session dies at
     * its next request even before the left_at check is reached. The row,
     * and so everything attributed to them, stays. Null if the address isn't
     * in the table at all.
     */
    async markLeft(email: string, by: string): Promise<MarkLeftResult | null> {
      const normalised = normaliseEmail(email);
      return db.transaction(async (tx) => {
        const [person] = await tx
          .select({ id: peopleTable.id, leftAt: peopleTable.leftAt })
          .from(peopleTable)
          .where(eq(peopleTable.email, normalised))
          .for("update");
        if (!person) return null;
        // Marking again would overwrite when, and by whom, they left.
        if (person.leftAt !== null) {
          throw new PeopleError("That person is already marked as left.");
        }
        const [row] = await tx
          .update(peopleTable)
          .set({
            leftAt: sql`now()`,
            leftBy: by,
            sessionVersion: sql`${peopleTable.sessionVersion} + 1`,
          })
          .where(eq(peopleTable.id, person.id))
          .returning({
            id: peopleTable.id,
            sessionVersion: peopleTable.sessionVersion,
          });
        // What they held when they left, as role names and colony ids.
        const held = await tx
          .select({
            role: personScopesTable.role,
            colonyId: personScopesTable.colonyId,
          })
          .from(personScopesTable)
          .where(eq(personScopesTable.personId, person.id));
        await recordPersonEvent(tx, {
          personId: person.id,
          kind: "left",
          by,
          detail: {
            roles: [...new Set(held.map((h) => h.role))],
            colonyIds: [
              ...new Set(
                held
                  .map((h) => h.colonyId)
                  .filter((c): c is number => c !== null),
              ),
            ],
          },
        });
        return row!;
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
      if (single !== undefined) {
        checkRole(single);
        if (single === "guardian" && colonyId === null) {
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
        const held = await tx
          .select({
            id: personScopesTable.id,
            role: personScopesTable.role,
            colonyId: personScopesTable.colonyId,
          })
          .from(personScopesTable)
          .where(eq(personScopesTable.personId, person.id))
          .for("update");
        const before = held.map(scopeLabel).sort();
        const holds = (role: string, colony: number | null) =>
          held.some((h) => h.role === role && h.colonyId === colony);

        const toDelete: number[] = [];
        const toInsert: { role: PersonRole; colonyId: number | null }[] = [];
        if (input.add !== undefined) {
          const role = input.add as PersonRole;
          const colony = role === "guardian" ? colonyId : null;
          if (holds(role, colony)) {
            throw new PeopleError(
              `They already hold ${scopeLabel({ role, colonyId: colony })}. Nothing was changed.`,
            );
          }
          // Since plan PR 0.5, can() honours management on its own, so
          // management no longer has to sit beside staff (SYC-316).
          toInsert.push({ role, colonyId: colony });
        } else if (input.remove !== undefined) {
          const role = input.remove;
          const colony = role === "guardian" ? colonyId : null;
          const row = held.find(
            (h) => h.role === role && h.colonyId === colony,
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
            if (!holds(role, null)) toInsert.push({ role, colonyId: null });
          }
        }

        const after = [
          ...held.filter((h) => !toDelete.includes(h.id)).map(scopeLabel),
          ...toInsert.map(scopeLabel),
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
                eq(personScopesTable.role, "management"),
                isNull(peopleTable.leftAt),
                isNotNull(peopleTable.acceptedAt),
                // A management row with an end date that has passed lets
                // nobody in, so it doesn't count (review finding 3b).
                scopeInForce(),
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
        if (toInsert.length) {
          await tx
            .insert(personScopesTable)
            .values(
              toInsert.map((r) =>
                scopeRow(person.id, r.role, r.colonyId, input.by),
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
      const scopes = await db.select().from(personScopesTable);
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
        roles: scopes
          .filter((s) => s.personId === p.id)
          .map(scopeLabel),
      }));
    },
  };
}

export type PeopleStore = ReturnType<typeof peopleStore>;
