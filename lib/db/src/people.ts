import crypto from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";
import {
  PERSON_ROLES,
  ROLE_MAILBOX_LOCAL_PARTS,
  peopleTable,
  personScopesTable,
  type PersonRole,
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
  scopes: { role: PersonRole; colonyId: number | null }[];
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

export interface AddPersonInput {
  email: string;
  name: string;
  addedBy: string;
  roles?: string[];
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
 * The people operations, bound to one database. `@workspace/db` exports
 * these bound to the app's database; the `people` command and the tests bind
 * them to the database they name.
 */
export function peopleStore(db: PeopleDb) {
  // The one rule (Decision 7): a person with left_at set is not on the list.
  // findAllowedPerson and findPersonById are every reader of "who is allowed
  // in", and both apply it.
  /** This person's roles, dropping any the code doesn't know. */
  async function scopesOf(id: string): Promise<PersonWithScopes["scopes"]> {
    const scopes = await db
      .select({
        role: personScopesTable.role,
        colonyId: personScopesTable.colonyId,
      })
      .from(personScopesTable)
      .where(eq(personScopesTable.personId, id));
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
      })
      .from(peopleTable)
      .where(
        and(
          eq(peopleTable.email, normaliseEmail(email)),
          isNull(peopleTable.leftAt),
        ),
      );
    if (!row) return null;
    return { ...row, scopes: await scopesOf(row.id) };
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
      for (const role of roles) {
        if (!isRole(role)) {
          throw new PeopleError(
            `"${role}" isn't a role. Roles are: ${PERSON_ROLES.join(", ")}.`,
          );
        }
      }
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
          await tx
            .insert(personScopesTable)
            .values(roles.map((role) => ({ personId: existing.id, role })));
          await recordPersonEvent(tx, {
            personId: existing.id,
            kind: "rejoined",
            by: input.addedBy,
            detail: { roles },
          });
          return { ...person!, rejoined: true };
        }
        const id = crypto.randomUUID();
        const [person] = await tx
          .insert(peopleTable)
          .values({ id, email, name, addedBy: input.addedBy })
          .returning({
            id: peopleTable.id,
            name: peopleTable.name,
            email: peopleTable.email,
            sessionVersion: peopleTable.sessionVersion,
          });
        await tx
          .insert(personScopesTable)
          .values(roles.map((role) => ({ personId: id, role })));
        await recordPersonEvent(tx, {
          personId: id,
          kind: "added",
          by: input.addedBy,
          detail: { roles },
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
        })
        .from(peopleTable)
        .where(and(eq(peopleTable.id, id), isNull(peopleTable.leftAt)));
      if (!person) return null;
      return { ...person, scopes: await scopesOf(id) };
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
        history: events
          .filter((e) => e.personId === p.id)
          .map((e) => ({ kind: e.kind, at: e.at, by: e.by })),
        roles: scopes
          .filter((s) => s.personId === p.id)
          .map((s) =>
            s.colonyId === null ? s.role : `${s.role}:${s.colonyId}`,
          ),
      }));
    },
  };
}

export type PeopleStore = ReturnType<typeof peopleStore>;
