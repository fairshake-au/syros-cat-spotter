import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { peopleTable } from "./people";

/**
 * SYC-516 C3 (docs/specs/team-dashboard-ux-fixes.md §3.2, decision 516-B):
 * what someone typed into a dashboard form when their sign-in had lapsed,
 * kept for at most 30 minutes and given back only to that same person when
 * they sign in again on that browser. `fields` holds only the named text
 * boxes of that form (artifacts/api-server/src/lib/teamAuth/heldTyping.ts
 * KEEPABLE), each cut to 4,000 characters. No IP, no device, no address.
 *
 * `claimed_at` is set by the hand-off when the row is matched, and the
 * landing page deletes it as it fills the form in. Rows older than 30
 * minutes are cleared by deleteStaleHeldTyping. Deleting the person takes
 * their rows with them.
 */
export const heldTypingTable = pgTable(
  "held_typing",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => peopleTable.id, { onDelete: "cascade" }),
    sessionVersion: integer("session_version").notNull(),
    formKey: text("form_key").notNull(),
    landingPath: text("landing_path").notNull(),
    fields: jsonb("fields").$type<Record<string, string>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
  },
  (t) => [index("held_typing_created_at_idx").on(t.createdAt)],
);

export type HeldTyping = typeof heldTypingTable.$inferSelect;
