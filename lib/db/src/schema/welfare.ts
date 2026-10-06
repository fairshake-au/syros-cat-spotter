import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  doublePrecision,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
  customType,
  uuid,
} from "drizzle-orm/pg-core";
import { peopleTable } from "./people";

/**
 * "This cat needs help" (SYC-42 plan, Slice 1 item 1.1; spec §4, §8.4).
 *
 * Migration: `welfare_reports_and_mail_outbox`. Three tables:
 *
 * - `welfare_reports`: the queue row. **It is the source of truth** and is
 *   written first, before any email exists (spec §4.3). A mail failure can
 *   never lose a report.
 * - `welfare_report_photos`: report photos. **Deliberately not rows in
 *   `photos`**, so the public photo route, which reads `photos`, cannot serve
 *   one (spec §4.3). No visibility column: enforcement is by table.
 * - `mail_outbox`: emails waiting to go, with retry. Claimed with
 *   `FOR UPDATE SKIP LOCKED`, so two servers never send the same alert.
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const welfareReportsTable = pgTable(
  "welfare_reports",
  {
    id: serial("id").primaryKey(),
    // Unguessable; the only id that ever leaves the server.
    publicId: text("public_id").notNull(),
    // welfare | content (spec §8.4). Only `welfare` is written in Slice 1.
    kind: text("kind").notNull().default("welfare"),
    severity: text("severity").notNull(),
    isLitter: boolean("is_litter").notNull().default(false),
    // Exact: this is the team's view (spec §3.1).
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    note: text("note"),
    reporterLanguage: text("reporter_language").notNull().default("en"),
    // Nullable so SYC-63's deletion can clear it; the report stays.
    reporterDevice: text("reporter_device"),
    // Unused until Slice 3 (the address lives in the verified-contact model).
    reporterContactId: integer("reporter_contact_id"),
    catId: integer("cat_id"),
    // new | looking | done | nothing_needed (spec §3.1). Slice 2 moves it.
    state: text("state").notNull().default("new"),
    stateChangedAt: timestamp("state_changed_at", { withTimezone: true }),
    // Strict link to people.id: no cascade, no set-null, so a person who has
    // moved a report can't be hard-deleted (mark them as left instead;
    // SYC-43 part 2, Decision 7).
    stateChangedBy: uuid("state_changed_by").references(() => peopleTable.id),
    teamNote: text("team_note"),
    // Who wrote the team note, and when (spec §3.1, §8.5). Same strict link.
    teamNoteBy: uuid("team_note_by").references(() => peopleTable.id),
    teamNoteAt: timestamp("team_note_at", { withTimezone: true }),
    // A draft is written once severity and location are set (spec §4.2).
    isDraft: boolean("is_draft").notNull().default(false),
    // The app's own id for this report, so a resent queued report is stored once.
    clientRef: text("client_ref").notNull(),
    // pending | attached | none | failed: "photo pending" is visible (spec
    // §4.3); failed means the server refused the photo (review of #55).
    photoState: text("photo_state").notNull().default("pending"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("welfare_reports_public_id_key").on(t.publicId),
    uniqueIndex("welfare_reports_device_client_ref_key").on(
      t.reporterDevice,
      t.clientRef,
    ),
    index("welfare_reports_queue_idx").on(t.isDraft, t.state, t.createdAt),
    check("welfare_reports_kind_ck", sql`${t.kind} in ('welfare', 'content')`),
    check(
      "welfare_reports_severity_ck",
      sql`${t.severity} in ('attention', 'urgent')`,
    ),
    check(
      "welfare_reports_state_ck",
      sql`${t.state} in ('new', 'looking', 'done', 'nothing_needed')`,
    ),
    check(
      "welfare_reports_photo_state_ck",
      sql`${t.photoState} in ('pending', 'attached', 'none', 'failed')`,
    ),
  ],
);

export const welfareReportPhotosTable = pgTable(
  "welfare_report_photos",
  {
    id: serial("id").primaryKey(),
    publicId: text("public_id").notNull(),
    reportId: integer("report_id")
      .notNull()
      .references(() => welfareReportsTable.id, { onDelete: "cascade" }),
    bytes: bytea("bytes").notNull(),
    mime: text("mime").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("welfare_report_photos_public_id_key").on(t.publicId),
    // One photo per report; a resent upload replaces nothing twice.
    uniqueIndex("welfare_report_photos_report_id_key").on(t.reportId),
  ],
);

export const mailOutboxTable = pgTable(
  "mail_outbox",
  {
    id: serial("id").primaryKey(),
    // A MailPurpose (api-server/src/lib/mail/send.ts).
    purpose: text("purpose").notNull(),
    reportId: integer("report_id").references(() => welfareReportsTable.id, {
      onDelete: "set null",
    }),
    // Never the address itself.
    recipientHash: text("recipient_hash").notNull(),
    // What to build the message from. Never a reporter's address.
    payload: jsonb("payload").notNull(),
    // queued | sending | sent | failed
    state: text("state").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    // When it may next be tried. While `sending`, a lease: past it, the row
    // is reclaimed (a server that died mid-send doesn't strand the alert).
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mail_outbox_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.state} in ('queued', 'sending')`),
    index("mail_outbox_report_idx").on(t.reportId),
    check(
      "mail_outbox_state_ck",
      sql`${t.state} in ('queued', 'sending', 'sent', 'failed')`,
    ),
  ],
);

/**
 * Every move of a report between the four states (spec §8.4; SYC-43 part 2,
 * PR 1). Add-only: rows are never updated or deleted.
 */
const REPORT_STATES = ["new", "looking", "done", "nothing_needed"] as const;
const stateList = sql.raw(REPORT_STATES.map((s) => `'${s}'`).join(", "));

export const reportStateEventsTable = pgTable(
  "report_state_events",
  {
    id: serial("id").primaryKey(),
    reportId: integer("report_id")
      .notNull()
      .references(() => welfareReportsTable.id, { onDelete: "cascade" }),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    // Strict link to people.id (Decision 7): no cascade, no set-null.
    personId: uuid("person_id")
      .notNull()
      .references(() => peopleTable.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    // Stays empty until SYC-42 Slice 3: which reporter email this change
    // sent, so "never mail twice" is a query (§5.3h).
    reporterMessage: text("reporter_message"),
  },
  (t) => [
    index("report_state_events_report_idx").on(t.reportId, t.at),
    check(
      "report_state_events_from_state_ck",
      sql`${t.fromState} in (${stateList})`,
    ),
    check(
      "report_state_events_to_state_ck",
      sql`${t.toState} in (${stateList})`,
    ),
  ],
);

export type WelfareReport = typeof welfareReportsTable.$inferSelect;
export type ReportStateEvent = typeof reportStateEventsTable.$inferSelect;
export type WelfareReportPhoto = typeof welfareReportPhotosTable.$inferSelect;
export type MailOutboxRow = typeof mailOutboxTable.$inferSelect;
