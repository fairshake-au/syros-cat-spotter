import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { photosTable } from "./photos";
import { peopleTable } from "./people";

/**
 * Hiding and restoring a photo (SYC-43 part 2 plan, PR 6; Decision 3;
 * DECISIONS.md Part 2b). An add-only log: a photo is hidden from the public
 * while its NEWEST event is `hide`. Rows are never updated or deleted (a
 * trigger in migration 0014 refuses both), so "who hid this, and when?"
 * always has an answer, and a restore is one more row.
 *
 * "Newest" means the highest `id`, not the latest `at`. Writers lock the
 * photo row first (api-server lib/photoVisibility.ts), so ids are handed out
 * in the order the writes actually happened; `at` is the time of the
 * transaction and can tie, or run backwards, between two writers that queued
 * on the same lock.
 *
 * `author` is who did it, as text: a team member's people.id today, and
 * `report:<id>` when a "Report an issue" report hides a photo (SYC-44), so
 * there is one hiding mechanism, not two. When a team member is the author,
 * `person_id` holds the same id with a strict link to people.id (Decision 7:
 * no cascade, no set-null; people who leave are marked left, never deleted).
 */
export const photoVisibilityEventsTable = pgTable(
  "photo_visibility_events",
  {
    id: serial("id").primaryKey(),
    photoId: integer("photo_id")
      .notNull()
      .references(() => photosTable.id),
    action: text("action").notNull(),
    author: text("author").notNull(),
    personId: uuid("person_id").references(() => peopleTable.id),
    reason: text("reason"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("photo_visibility_events_photo_idx").on(t.photoId, t.id.desc()),
    check("photo_visibility_events_action_ck", sql`${t.action} in ('hide', 'restore')`),
    // A team member: author is their id, and person_id links it. A public
    // report (SYC-44): author is report:<id>, and there is no person.
    check(
      "photo_visibility_events_author_ck",
      sql`(${t.personId} is not null and ${t.author} = ${t.personId}::text) or (${t.personId} is null and ${t.author} ~ '^report:.+$')`,
    ),
  ],
);

export type PhotoVisibilityEvent = typeof photoVisibilityEventsTable.$inferSelect;
