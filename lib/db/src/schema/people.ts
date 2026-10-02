import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  serial,
  integer,
  uuid,
  timestamp,
  check,
  unique,
} from "drizzle-orm/pg-core";
import { coloniesTable } from "./colonies";

/**
 * Shared and role mailboxes that may never be a person (team-access spec
 * §2.8, word for word). Matched on the part before the `@`, ignoring anything
 * after a `+`. The database check below is built from this list, and
 * `checkPersonEmail()` (../people.ts) gives the plain-English refusal from the
 * same list. A test pins the list to the migrated database so the two can't
 * drift.
 */
export const ROLE_MAILBOX_LOCAL_PARTS = [
  "admin",
  "info",
  "hello",
  "contact",
  "team",
  "office",
  "support",
] as const;

/** The roles a scope row may hold (§7.3). Only `staff` grants anything yet. */
export const PERSON_ROLES = ["staff", "guardian", "volunteer", "vet"] as const;

const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(", "));

/**
 * The one list of people (§2.7, §2.9). Both the sign-in Worker and the staff
 * dashboard read it. One row per person, with their own address.
 */
export const peopleTable = pgTable(
  "people",
  {
    // The stable id: the hand-off pass's `sub`, and later observations'
    // account_id. Never the email. addPerson() creates it in TypeScript, so
    // no insert relies on this default.
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    // Increasing it signs this person out everywhere (§2.9).
    sessionVersion: integer("session_version").notNull().default(1),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // The adder's person id, or `cli:<operator>`. No foreign key, like
    // colonies.created_by, so removing the adder never blocks anything.
    addedBy: text("added_by"),
  },
  (t) => [
    check(
      "people_email_lowercase_ck",
      sql`${t.email} = lower(btrim(${t.email}))`,
    ),
    check("people_email_shape_ck", sql`${t.email} ~ '^[^@]+@[^@]+$'`),
    check(
      "people_email_not_role_ck",
      sql`split_part(split_part(${t.email}, '@', 1), '+', 1) NOT IN (${sqlList(ROLE_MAILBOX_LOCAL_PARTS)})`,
    ),
  ],
);

/**
 * What each person may do (§7.3): a join table, so one person can hold two
 * roles, or guard several colonies. `colony_id` null means "not tied to a
 * colony".
 */
export const personScopesTable = pgTable(
  "person_scopes",
  {
    id: serial("id").primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => peopleTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    colonyId: integer("colony_id").references(() => coloniesTable.id),
  },
  (t) => [
    check(
      "person_scopes_role_ck",
      sql`${t.role} IN (${sqlList(PERSON_ROLES)})`,
    ),
    // A constraint, not uniqueIndex(): only the constraint builder has
    // nullsNotDistinct() in drizzle-orm 0.45.2. Without it every staff row's
    // empty colony_id counts as different, and one person could get `staff`
    // twice.
    unique("person_scopes_role_scope_unique")
      .on(t.personId, t.role, t.colonyId)
      .nullsNotDistinct(),
  ],
);

/**
 * Spent hand-off passes (§2.4 step 5). Spending is one
 * `INSERT … ON CONFLICT DO NOTHING RETURNING`, which only one server can win.
 * Rows older than ten minutes are deleted during each hand-off.
 */
export const teamHandoffSpentTable = pgTable("team_handoff_spent", {
  jti: text("jti").primaryKey(),
  spentAt: timestamp("spent_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Person = typeof peopleTable.$inferSelect;
export type PersonScope = typeof personScopesTable.$inferSelect;
export type PersonRole = (typeof PERSON_ROLES)[number];
