import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { peopleTable } from "./people";

// SYC-53 PR 0.1 / SYC-213: the record of who changed what on the list of
// people (roles-and-invites.md §11.1). The trigger that makes it add-only
// lives in the migration, as the schema code can't express it.

const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(", "));

/**
 * Every kind of change the record holds. The fuller list from spec §11.1 is
 * here from the start, because adding a kind later costs a migration.
 */
export const PERSON_EVENT_KINDS = [
  "invited",
  "invite_sent",
  "invite_resent",
  "invite_withdrawn",
  "accepted",
  "added",
  "roles_changed",
  "left",
  "rejoined",
  "signed_out_everywhere",
  "anonymised",
] as const;
export type PersonEventKind = (typeof PERSON_EVENT_KINDS)[number];

/**
 * One row per change to who is on the list or what they may do, written in
 * the same transaction as the change. Add-only: a trigger refuses update,
 * delete and TRUNCATE. `detail` holds ids and role names only, never a name
 * or an address, so the record survives anonymising (SYC-208).
 *
 * `by` is a person id, `self`, or `cli:<operator>` (or `system:migration`
 * for the rows the migration wrote for people who predate the record).
 */
export const personEventsTable = pgTable(
  "person_events",
  {
    id: serial("id").primaryKey(),
    // Strict: a person with a record can never be deleted, only marked left.
    personId: uuid("person_id")
      .notNull()
      .references(() => peopleTable.id),
    kind: text("kind").notNull(),
    by: text("by").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    detail: jsonb("detail"),
  },
  (t) => [
    index("person_events_person_idx").on(t.personId, t.id),
    check("person_events_kind_ck", sql`${t.kind} in (${sqlList(PERSON_EVENT_KINDS)})`),
  ],
);

export type PersonEvent = typeof personEventsTable.$inferSelect;
