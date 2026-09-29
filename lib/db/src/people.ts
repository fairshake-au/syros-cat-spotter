import crypto from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";
import {
  PERSON_ROLES,
  ROLE_MAILBOX_LOCAL_PARTS,
  peopleTable,
  personScopesTable,
  type PersonRole,
} from "./schema/people";

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
      reason: `"${email}" isn't an email address.`,
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

/**
 * The people operations, bound to one database. `@workspace/db` exports
 * these bound to the app's database; the `people` command and the tests bind
 * them to the database they name.
 */
export function peopleStore(db: PeopleDb) {
  async function findPersonByEmail(
    email: string,
  ): Promise<AllowedPerson | null> {
    const [row] = await db
      .select({
        id: peopleTable.id,
        name: peopleTable.name,
        email: peopleTable.email,
        sessionVersion: peopleTable.sessionVersion,
      })
      .from(peopleTable)
      .where(eq(peopleTable.email, normaliseEmail(email)));
    return row ?? null;
  }

  return {
    /** One transaction: the person and their roles, or nothing. */
    async addPerson(input: AddPersonInput): Promise<AllowedPerson> {
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
          .select({ id: peopleTable.id })
          .from(peopleTable)
          .where(eq(peopleTable.email, email));
        if (existing) throw new PeopleError(`${email} is already on the list.`);
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
        return person!;
      });
    },

    /**
     * Deletes their roles, then the person, in one transaction. The cascade
     * is declared too; deleting the roles here keeps removal correct even if
     * it were ever missing. False if they weren't on the list.
     */
    async removePerson(email: string): Promise<boolean> {
      const normalised = normaliseEmail(email);
      return db.transaction(async (tx) => {
        const [person] = await tx
          .select({ id: peopleTable.id })
          .from(peopleTable)
          .where(eq(peopleTable.email, normalised));
        if (!person) return false;
        await tx
          .delete(personScopesTable)
          .where(eq(personScopesTable.personId, person.id));
        await tx.delete(peopleTable).where(eq(peopleTable.id, person.id));
        return true;
      });
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

    /** Is this address on the list? */
    findAllowedPerson: findPersonByEmail,

    /** The person behind a hand-off pass or session, with their roles. */
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
        .where(eq(peopleTable.id, id));
      if (!person) return null;
      const scopes = await db
        .select({
          role: personScopesTable.role,
          colonyId: personScopesTable.colonyId,
        })
        .from(personScopesTable)
        .where(eq(personScopesTable.personId, id));
      return {
        ...person,
        scopes: scopes.filter((s): s is PersonWithScopes["scopes"][number] =>
          isRole(s.role),
        ),
      };
    },

    /** Everybody on the list, with their roles, oldest first. */
    async listPeople(): Promise<
      (AllowedPerson & {
        roles: string[];
        addedAt: Date;
        addedBy: string | null;
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
