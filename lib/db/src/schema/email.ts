import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * The one "is this you?" system for every email address the app is given
 * (SYC-3 plan, Slice 1 step 1, Decision 6 A). Migration `keep_my_spots_safe`.
 *
 * - `email_contacts`: one row per address per purpose. **A keep-safe row
 *   never holds the address** (Decision 4), and the database refuses one that
 *   does. Report rows (SYC-42 Slice 3) and news rows (SYC-45) do.
 * - `mail_tokens`: one-time link tokens, stored only as hashes.
 * - `mail_requests`: every add and every restore request, known address or
 *   not, so the limits are counted in Postgres (across servers) and an
 *   unknown address uses them up exactly as a known one does (review A1).
 * - `email_consent_events`: email-capture.md §5.6, append-only; deletion
 *   redacts the identifying parts in place.
 * - `email_suppressions`: never mail this fingerprint (for this scope).
 *
 * Every fingerprint is a keyed HMAC, separated by purpose
 * (api-server/src/lib/mail/fingerprint.ts): a keep-safe fingerprint is never
 * equal to the fingerprint of the same address on a report or news row, so a
 * leaked database can't join the two (review A3).
 */

const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(", "));

export const EMAIL_CONTACT_PURPOSES = ["keep_safe", "report", "news"] as const;
export const EMAIL_CONTACT_STATUSES = ["pending", "confirmed"] as const;
export const MAIL_TOKEN_PURPOSES = ["verify", "forget", "restore"] as const;
export const MAIL_REQUEST_KINDS = ["add", "restore"] as const;
export const CONSENT_EVENTS = [
  "consented",
  "verify_sent",
  "verified",
  "withdrawn",
  "expired",
] as const;
export const SUPPRESSION_REASONS = [
  "forget",
  "bounce",
  "complaint",
  "verify_cap",
  "unsubscribe",
] as const;
export const SUPPRESSION_SCOPES = ["keep_safe", "report", "news", "all"] as const;

export const emailContactsTable = pgTable(
  "email_contacts",
  {
    id: serial("id").primaryKey(),
    purpose: text("purpose").notNull(),
    // Report and news rows only. Always empty on a keep-safe row (Decision 4).
    address: text("address"),
    addressHmac: text("address_hmac").notNull(),
    // The only form ever shown back: `s•••@gmail.com`.
    addressMask: text("address_mask").notNull(),
    // The spotter, for keep-safe.
    deviceId: text("device_id"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    check("email_contacts_purpose_ck", sql`${t.purpose} in (${sqlList(EMAIL_CONTACT_PURPOSES)})`),
    check("email_contacts_status_ck", sql`${t.status} in (${sqlList(EMAIL_CONTACT_STATUSES)})`),
    // Decision 4, enforced by the database: no keep-safe address, ever.
    check("email_contacts_keep_safe_no_address_ck", sql`${t.purpose} <> 'keep_safe' or ${t.address} is null`),
    check("email_contacts_keep_safe_device_ck", sql`${t.purpose} <> 'keep_safe' or ${t.deviceId} is not null`),
    // One keep-safe row per spotter.
    uniqueIndex("email_contacts_keep_safe_device_unique")
      .on(t.deviceId)
      .where(sql`${t.purpose} = 'keep_safe'`),
    // Not unique: siblings can share a parent's address (Decision 3).
    index("email_contacts_hmac_idx").on(t.addressHmac),
  ],
);

export const mailTokensTable = pgTable(
  "mail_tokens",
  {
    // sha256 of the 32 random bytes in the link. The raw token is never stored here.
    tokenHash: text("token_hash").primaryKey(),
    purpose: text("purpose").notNull(),
    // verify / forget: the contact row. Restore tokens have none.
    contactId: integer("contact_id").references(() => emailContactsTable.id, {
      onDelete: "cascade",
    }),
    addressHmac: text("address_hmac").notNull(),
    // verify / forget: the spotter. restore: the phone that asked (Decision 2).
    deviceId: text("device_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    // restore only, once used: who moved, and the secret fingerprint the
    // move replaced (so the old phone can be told `device_moved`).
    restoredDeviceId: text("restored_device_id"),
    replacedSecretHash: text("replaced_secret_hash"),
    attemptIpHash: text("attempt_ip_hash"),
  },
  (t) => [
    check("mail_tokens_purpose_ck", sql`${t.purpose} in (${sqlList(MAIL_TOKEN_PURPOSES)})`),
    index("mail_tokens_hmac_idx").on(t.addressHmac, t.purpose, t.expiresAt),
    index("mail_tokens_replaced_idx")
      .on(t.replacedSecretHash)
      .where(sql`${t.replacedSecretHash} is not null`),
  ],
);

export const mailRequestsTable = pgTable(
  "mail_requests",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    addressHmac: text("address_hmac").notNull(),
    ipHash: text("ip_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("mail_requests_kind_ck", sql`${t.kind} in (${sqlList(MAIL_REQUEST_KINDS)})`),
    index("mail_requests_address_idx").on(t.kind, t.addressHmac, t.createdAt),
    index("mail_requests_ip_idx").on(t.kind, t.ipHash, t.createdAt),
    index("mail_requests_created_idx").on(t.kind, t.createdAt),
  ],
);

/**
 * email-capture.md §5.6: what (`purpose`), where (`surface`), the exact
 * wording (`wording_version`), when (`occurred_at`), the app language, and
 * the verification and withdrawal times (the `occurred_at` of the
 * `verified` and `withdrawn` events: withdrawal is a new event, never an
 * edit). Append-only (trigger in the migration); the one permitted update is
 * deletion's redaction of the identifying parts.
 */
export const emailConsentEventsTable = pgTable(
  "email_consent_events",
  {
    id: serial("id").primaryKey(),
    // No foreign key: the contact row goes when the address is forgotten, the record stays.
    contactId: integer("contact_id"),
    deviceId: text("device_id"),
    addressHmac: text("address_hmac"),
    purpose: text("purpose").notNull(),
    event: text("event").notNull(),
    surface: text("surface"),
    wordingVersion: text("wording_version"),
    language: text("language"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
    redactionReason: text("redaction_reason"),
  },
  (t) => [
    check("email_consent_events_purpose_ck", sql`${t.purpose} in (${sqlList(EMAIL_CONTACT_PURPOSES)})`),
    check("email_consent_events_event_ck", sql`${t.event} in (${sqlList(CONSENT_EVENTS)})`),
    index("email_consent_events_device_idx").on(t.deviceId),
    index("email_consent_events_hmac_idx").on(t.addressHmac, t.purpose, t.event),
  ],
);

export const emailSuppressionsTable = pgTable(
  "email_suppressions",
  {
    id: serial("id").primaryKey(),
    addressHmac: text("address_hmac").notNull(),
    reason: text("reason").notNull(),
    // A purpose, or `all`.
    scope: text("scope").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("email_suppressions_reason_ck", sql`${t.reason} in (${sqlList(SUPPRESSION_REASONS)})`),
    check("email_suppressions_scope_ck", sql`${t.scope} in (${sqlList(SUPPRESSION_SCOPES)})`),
    uniqueIndex("email_suppressions_unique").on(t.addressHmac, t.scope, t.reason),
  ],
);

export type EmailContactRow = typeof emailContactsTable.$inferSelect;
export type MailTokenRow = typeof mailTokensTable.$inferSelect;
