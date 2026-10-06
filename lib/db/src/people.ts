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
import { observationsTable } from "./schema/observations";

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

/** removePerson's refusal for someone who has history (Decision 7). */
export const HAS_HISTORY_MESSAGE =
  "This person has history. Use mark-left instead.";

/** Postgres' foreign_key_violation, wherever the driver's wrapper puts it. */
function isForeignKeyViolation(err: unknown): boolean {
  let e = err;
  while (e && typeof e === "object") {
    if ((e as { code?: unknown }).code === "23503") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
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

  function removeInTransaction(email: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [person] = await tx
        .select({ id: peopleTable.id })
        .from(peopleTable)
        .where(eq(peopleTable.email, email))
        .for("update");
      if (!person) return false;
      // Observations name their author by account_id, which has no database
      // link (the data spine keeps it as text, §10.1), so the links can't
      // refuse this one. Check it here.
      const [authored] = await tx
        .select({ id: observationsTable.id })
        .from(observationsTable)
        .where(eq(observationsTable.accountId, person.id))
        .limit(1);
      if (authored) throw new PeopleError(HAS_HISTORY_MESSAGE);
      await tx
        .delete(personScopesTable)
        .where(eq(personScopesTable.personId, person.id));
      await tx.delete(peopleTable).where(eq(peopleTable.id, person.id));
      return true;
    });
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
        return row!;
      });
    },

    /**
     * Hard deletion, only for someone with no history: a mistaken add
     * (Decision 7). The database's strict links to people.id refuse it for
     * anyone else, and that refusal becomes "use mark-left instead"; so does
     * having written an observation, which has no link. Deletes
     * their roles, then the person, in one transaction. The cascade is
     * declared too; deleting the roles here keeps removal correct even if it
     * were ever missing. False if they weren't in the table.
     */
    async removePerson(email: string): Promise<boolean> {
      try {
        return await removeInTransaction(normaliseEmail(email));
      } catch (err) {
        if (isForeignKeyViolation(err)) {
          throw new PeopleError(HAS_HISTORY_MESSAGE);
        }
        throw err;
      }
    },

    /** Signs this person out on every device. Their new version, or null. */
    async signOutEverywhere(email: string): Promise<number | null> {
      const [row] = await db
        .update(peopleTable)
        .set({ sessionVersion: sql`${peopleTable.sessionVersion} + 1` })
        .where(eq(peopleTable.email, normaliseEmail(email)))
        .returning({ sessionVersion: peopleTable.sessionVersion });
      return row?.sessionVersion ?? null;
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
      })[]
    > {
      const people = await db
        .select()
        .from(peopleTable)
        .orderBy(asc(peopleTable.addedAt), asc(peopleTable.email));
      const scopes = await db.select().from(personScopesTable);
      return people.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        sessionVersion: p.sessionVersion,
        addedAt: p.addedAt,
        addedBy: p.addedBy,
        leftAt: p.leftAt,
        leftBy: p.leftBy,
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
