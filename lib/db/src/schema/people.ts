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

/**
 * The roles a scope row may hold (roles-and-invites.md §10.1). Only `staff`
 * grants anything yet. `volunteer` is retired: the people who help in the
 * field are on the team (`staff`), island-wide (Decision 8).
 */
export const PERSON_ROLES = ["staff", "management", "guardian", "vet"] as const;

/**
 * The roles that are always island-wide (§10.1): the team and management.
 * A database check below is built from it, and `people set-roles` refuses a
 * result holding none of them unless forced. It is not the list of the
 * team's roles (that is api-server's teamRoles.ts, which includes `vet`).
 */
export const ISLAND_ROLES = ["staff", "management"] as const;

/** Where a scope row applies (§10.1). No default: every insert says. */
export const SCOPE_REACHES = ["island", "colony"] as const;

/** A label for the team's records (§10.1). Grants nothing. */
export const SCOPE_RELATIONSHIPS = ["feeds", "owns_here", "covering"] as const;

/** The languages a person's messages and pages can be in (§10.1). */
export const PERSON_LANGUAGES = ["en", "el", "fr"] as const;

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
    // Set when this person has left (SYC-43 part 2, Decision 7). A person
    // with left_at set is not on the list: they can't sign in, and their
    // sessions end. The row stays, so everything they did stays attributed
    // to them. Adding their address again clears it.
    leftAt: timestamp("left_at", { withTimezone: true }),
    // Who marked them as left: a person id or `cli:<operator>`, like added_by.
    leftBy: text("left_by"),
    // SYC-53 (roles-and-invites.md §10.1). When the person tapped "Yes,
    // join". Null means not accepted: such a person is never found by
    // findAllowedPerson or findPersonById, so is never a CapabilityHolder.
    // Set to added_at for everyone on the list when the migration ran.
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    // When the invitation went out; null with accepted_at null is "not sent
    // yet".
    inviteSentAt: timestamp("invite_sent_at", { withTimezone: true }),
    // 14 days after invite_sent_at; null once accepted.
    inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
    language: text("language").notNull().default("en"),
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
    check(
      "people_language_ck",
      sql`${t.language} IN (${sqlList(PERSON_LANGUAGES)})`,
    ),
  ],
);

/**
 * What each person may do (§7.3): a join table, so one person can hold two
 * roles, or guard several colonies. Where a row applies is `reach`, never
 * "colony_id is null" (roles-and-invites.md §10.1): if a guardian row were
 * ever written with the colony left out, "null means island" would quietly
 * make her island-wide. The checks below make that impossible.
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
    // `island` or `colony`. Not null, and deliberately no default.
    reach: text("reach").notNull(),
    // When this placement turns itself off (Decision 9). Null: never.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    relationship: text("relationship"),
    // A person id or `cli:<operator>`, the same convention as added_by.
    grantedBy: text("granted_by"),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "person_scopes_role_ck",
      sql`${t.role} IN (${sqlList(PERSON_ROLES)})`,
    ),
    check(
      "person_scopes_reach_ck",
      sql`${t.reach} IN (${sqlList(SCOPE_REACHES)})`,
    ),
    // `colony` exactly when a colony is named.
    check(
      "person_scopes_reach_colony_ck",
      sql`(${t.reach} = 'colony') = (${t.colonyId} IS NOT NULL)`,
    ),
    // A cat guardian is never island-wide.
    check(
      "person_scopes_guardian_colony_ck",
      sql`${t.role} <> 'guardian' OR ${t.reach} = 'colony'`,
    ),
    // The team and management are island-wide.
    check(
      "person_scopes_team_island_ck",
      sql`${t.role} NOT IN (${sqlList(ISLAND_ROLES)}) OR ${t.reach} = 'island'`,
    ),
    check(
      "person_scopes_relationship_ck",
      sql`${t.relationship} IS NULL OR ${t.relationship} IN (${sqlList(SCOPE_RELATIONSHIPS)})`,
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
export type ScopeReach = (typeof SCOPE_REACHES)[number];
export type PersonLanguage = (typeof PERSON_LANGUAGES)[number];
