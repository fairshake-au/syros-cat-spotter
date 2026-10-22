import { db, mailOutboxTable, type MailOutboxRow } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { addressFingerprint, ipFingerprint, maskAddress, normaliseAddress } from "../mail/fingerprint";
import { hashRecipient, sendMail, type SendResult } from "../mail/send";
import { isReportSuppressed, reportSendDeps } from "../mail/suppression";
import { reportDate, cleanTeamSentence } from "../mail/reportTemplates";
import { confirmUrl, forgetUrl } from "../keepSafe/links";
import { hashToken, newToken, VERIFY_TOKEN_DAYS } from "../keepSafe/tokens";
import { dailyCeilings } from "../keepSafe/service";

/**
 * The reporter's email (SYC-42 plan, Slice 3; spec §4.3, §5.3(g)–(h);
 * email-capture.md §3.4, §4, §5.4).
 *
 * The address lives in the shared "is this you?" model SYC-3 built
 * (`email_contacts`, purpose `report`, one row per report). The report row
 * holds only `reporter_contact_id` (§8.4).
 *
 * **F7b, the rule everything here serves: an address nobody has confirmed
 * gets exactly one fixed message, and nothing else.** The acknowledgement and
 * the outcome are held as intents (the contact link on the report, and the
 * report's state), never as rendered messages, and go out only once the
 * address is confirmed (email-capture.md §4.3 step 4). `sendMail` checks
 * again at send time, so a confirmed row going away stops them too.
 *
 * **Welfare reports only.** Every query here carries `kind = 'welfare'`: a
 * "Report an issue" row (SYC-44) never gets a reporter address, an
 * acknowledgement or a "the cat you reported" outcome.
 *
 * **The report is never at stake.** It is written and committed before any of
 * this runs, and every failure here is caught by the caller and logged.
 *
 * Limits (§2.6, email-capture.md §4.4), counted in Postgres:
 * - one "is this you?" per address per 24 hours, three in its lifetime, then
 *   a report-scope `verify_cap` suppression;
 * - one acknowledgement per address per 24 hours;
 * - per IP, and the global daily ceiling, shared with keep-safe;
 * - a suppressed address (forgotten, bounced, complained) gets nothing.
 *
 * Confirmation is per phone: a later report with the same address from the
 * same phone skips the "is this you?" and is acknowledged straight away
 * (within the daily limit). From another phone it gets the one fixed "is this
 * you?" again, because someone else may have typed it (review of #181,
 * finding 1). Three in a lifetime counts "is this you?" messages only
 * (email-capture.md §4.4 owns that limit), and stops applying once the holder
 * has confirmed the address anywhere, so a cat guardian's fourth report is
 * still acknowledged.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };

export const REPORTER_LIMITS = {
  verifyPerAddressHours: 24,
  verifyLifetime: 3,
  ackPerAddressHours: 24,
  /** An address confirmed from another phone: "is this you?" at most 3 a day. */
  verifyConfirmedPerDay: 3,
  addPerIpPerHour: 20,
};

/** How long the acknowledgement and outcome keep trying before giving up. */
export const REPORTER_MAIL_RETRY_DAYS = 3;
/**
 * The "Delete my details" link. email-capture.md §5.8 wants delete links that
 * don't expire; three years is how long the report itself is kept (§8.5), so
 * after that there is nothing left to delete.
 */
export const DELETE_LINK_DAYS = 3 * 365;

export const REPORTER_PURPOSES = ["public_verify", "report_ack", "report_outcome"] as const;
export type ReporterPurpose = (typeof REPORTER_PURPOSES)[number];
export type ReportOutcome = "done" | "nothing_needed";

/** An outbox row's payload. Raw tokens sit here only until the row is settled. */
export type ReporterPayload = {
  contactId: number;
  expiresAt: string;
  token?: string;
  forgetToken?: string;
  deleteToken?: string;
  outcome?: ReportOutcome;
  teamSentence?: string;
  cleared?: true;
};

/** The wording on screen, recorded with the consent (email-capture.md §5.6). */
export const REPORT_WORDING_VERSION = "report-ask-v1-2026-10-15";

async function lock(tx: Tx, hmac: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"report:" + hmac}, 0))`);
}

async function count(tx: Tx, query: ReturnType<typeof sql>): Promise<number> {
  const result = await tx.execute(query);
  return Number((result.rows[0] as { n: number | string } | undefined)?.n ?? 0);
}

async function insertToken(
  tx: Tx,
  t: { raw: string; purpose: "verify" | "forget"; contactId: number; hmac: string; deviceId: string; expiresAt: Date },
): Promise<void> {
  await tx.execute(sql`
    insert into mail_tokens (token_hash, purpose, contact_id, address_hmac, device_id, expires_at)
    values (${hashToken(t.raw)}, ${t.purpose}, ${t.contactId}, ${t.hmac}, ${t.deviceId}, ${t.expiresAt})
  `);
}

async function enqueue(
  tx: Tx,
  row: { purpose: ReporterPurpose; reportId: number; recipientHash: string; payload: ReporterPayload; dueAt?: Date },
): Promise<number> {
  const [inserted] = await tx
    .insert(mailOutboxTable)
    .values({
      purpose: row.purpose,
      reportId: row.reportId,
      recipientHash: row.recipientHash,
      payload: row.payload,
      ...(row.dueAt ? { nextAttemptAt: row.dueAt } : {}),
    })
    .returning({ id: mailOutboxTable.id });
  return inserted!.id;
}

// ── Adding the address to a report ──────────────────────────────────────────

export type AddReporterInput = {
  reportId: number;
  deviceId: string;
  email: string;
  language: string;
  ip: string;
};

/**
 * Link an address to a report that has just been written. Returns the outbox
 * rows to kick after the commit. Answers nothing to the reporter: the screen
 * says the same thing whatever happened here (no limit or suppression is ever
 * revealed).
 */
export async function addReporterEmail(input: AddReporterInput, log: Log): Promise<number[]> {
  const to = normaliseAddress(input.email);
  const hmac = addressFingerprint("report", to);
  const ipHash = ipFingerprint(input.ip);

  return db.transaction(async (tx) => {
    await lock(tx, hmac);
    await tx.execute(sql`insert into mail_requests (kind, address_hmac, ip_hash) values ('add', ${hmac}, ${ipHash})`);
    const skip = (reason: string, level: "info" | "warn" | "error" = "info") => {
      log[level]({ reason, addressHmac: hmac.slice(0, 10) }, "reporter email: nothing sent");
      return [] as number[];
    };

    const [report] = (
      await tx.execute(sql`
        select id, reporter_contact_id from welfare_reports
         where id = ${input.reportId} and is_draft = false and kind = 'welfare' for update
      `)
    ).rows as { id: number; reporter_contact_id: number | null }[];
    // A resent report already has its address: nothing more to do.
    if (!report || report.reporter_contact_id !== null) return skip("already_linked");

    // Confirmed by its holder for a report from THIS phone: the same person,
    // so no second "is this you?". Confirmed only from another phone: someone
    // else may have typed it, so it gets the one fixed "is this you?" again
    // and nothing more until it's confirmed for this report too (F7b;
    // adversarial review of #181, finding 1; the keep-safe rule, SYC-261).
    const confirmedHere =
      (await count(tx, sql`
        select count(*)::int as n from email_contacts
         where purpose = 'report' and address_hmac = ${hmac} and status = 'confirmed'
           and device_id = ${input.deviceId}
      `)) > 0;
    const confirmedElsewhere =
      confirmedHere ||
      (await count(tx, sql`
        select count(*)::int as n from email_contacts
         where purpose = 'report' and address_hmac = ${hmac} and status = 'confirmed'
      `)) > 0;
    // Forgotten, bounced or complained: don't even keep the address.
    if (await isReportSuppressed(to, confirmedElsewhere ? "confirmed" : "verify")) return skip("suppressed");

    const inserted = await tx.execute(sql`
      insert into email_contacts (purpose, address, address_hmac, address_mask, device_id, status, confirmed_at)
      values ('report', ${to}, ${hmac}, ${maskAddress(to)}, ${input.deviceId},
              ${confirmedHere ? "confirmed" : "pending"}, ${confirmedHere ? new Date() : null})
      returning id
    `);
    const contactId = (inserted.rows[0] as { id: number }).id;
    await tx.execute(sql`update welfare_reports set reporter_contact_id = ${contactId} where id = ${report.id}`);
    await tx.execute(sql`
      insert into email_consent_events (contact_id, device_id, address_hmac, purpose, event, surface, wording_version, language)
      values (${contactId}, ${input.deviceId}, ${hmac}, 'report', 'consented', 'welfare_report', ${REPORT_WORDING_VERSION}, ${input.language})
    `);

    if (confirmedHere) {
      const ack = await queueAck(tx, { reportId: report.id, contactId, hmac, deviceId: input.deviceId });
      return ack === null ? skip("ack_daily_limit") : [ack];
    }

    if (confirmedElsewhere) {
      // An address its holder has confirmed isn't a stranger's: the 24-hour
      // and lifetime caps don't apply, but a stranger who knows it still
      // can't flood it (3 a day, as keep-safe does for a confirmed address).
      const todayToAddress = await count(tx, sql`
        select count(*)::int as n from email_consent_events
         where purpose = 'report' and event = 'verify_sent' and address_hmac = ${hmac}
           and occurred_at > now() - interval '1 day'
      `);
      if (todayToAddress >= REPORTER_LIMITS.verifyConfirmedPerDay) return skip("confirmed_daily_cap");
    }
    // Per address: one in 24 hours. A report from the same phone while one
    // is still waiting to be confirmed rides on it: confirming confirms that
    // phone's reports with this address.
    if (!confirmedElsewhere) {
      const recent = await count(tx, sql`
        select count(*)::int as n from email_consent_events
         where purpose = 'report' and event = 'verify_sent' and address_hmac = ${hmac}
           and occurred_at > now() - make_interval(hours => ${REPORTER_LIMITS.verifyPerAddressHours})
      `);
      if (recent > 0) return skip("per_address_24h");
      const lifetime = await count(tx, sql`
        select count(*)::int as n from email_consent_events
         where purpose = 'report' and event = 'verify_sent' and address_hmac = ${hmac}
      `);
      if (lifetime >= REPORTER_LIMITS.verifyLifetime) {
        await tx.execute(sql`
          insert into email_suppressions (address_hmac, reason, scope)
          values (${hmac}, 'verify_cap', 'report') on conflict do nothing
        `);
        return skip("lifetime_cap");
      }
    }
    const fromIp = await count(tx, sql`
      select count(*)::int as n from mail_requests
       where kind = 'add' and ip_hash = ${ipHash} and created_at > now() - interval '1 hour'
    `);
    if (fromIp > REPORTER_LIMITS.addPerIpPerHour) return skip("per_ip");
    const today = await count(tx, sql`
      select count(*)::int as n from email_consent_events
       where event = 'verify_sent' and occurred_at > now() - interval '1 day'
    `);
    if (today >= dailyCeilings().verify) return skip("global_ceiling", "error");

    const token = newToken();
    const forgetToken = newToken();
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_DAYS * 24 * 60 * 60 * 1000);
    await insertToken(tx, { raw: token, purpose: "verify", contactId, hmac, deviceId: input.deviceId, expiresAt });
    await insertToken(tx, { raw: forgetToken, purpose: "forget", contactId, hmac, deviceId: input.deviceId, expiresAt });
    await tx.execute(sql`
      insert into email_consent_events (contact_id, device_id, address_hmac, purpose, event, surface, wording_version, language)
      values (${contactId}, ${input.deviceId}, ${hmac}, 'report', 'verify_sent', 'welfare_report', ${REPORT_WORDING_VERSION}, ${input.language})
    `);
    const id = await enqueue(tx, {
      purpose: "public_verify",
      reportId: report.id,
      recipientHash: hashRecipient(to, "public_verify"),
      payload: { contactId, expiresAt: expiresAt.toISOString(), token, forgetToken },
    });
    return [id];
  });
}

// ── The acknowledgement and the outcome, once confirmed ────────────────────

async function deleteTokenFor(tx: Tx, contactId: number, hmac: string, deviceId: string): Promise<string> {
  const raw = newToken();
  await insertToken(tx, {
    raw,
    purpose: "forget",
    contactId,
    hmac,
    deviceId,
    expiresAt: new Date(Date.now() + DELETE_LINK_DAYS * 24 * 60 * 60 * 1000),
  });
  return raw;
}

function retryUntil(): string {
  return new Date(Date.now() + REPORTER_MAIL_RETRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Queue the acknowledgement for one report, unless this report already has
 * one or the address had one in the last 24 hours. Null when nothing queued.
 */
async function queueAck(
  tx: Tx,
  a: { reportId: number; contactId: number; hmac: string; deviceId: string },
): Promise<number | null> {
  const already = await count(tx, sql`
    select count(*)::int as n from mail_outbox where purpose = 'report_ack' and report_id = ${a.reportId}
  `);
  if (already) return null;
  // `recipient_hash` of an acknowledgement is the address's report
  // fingerprint, the same value as `address_hmac` (send.ts PURPOSE_LABEL).
  const recent = await count(tx, sql`
    select count(*)::int as n from mail_outbox
     where purpose = 'report_ack' and recipient_hash = ${a.hmac}
       and created_at > now() - make_interval(hours => ${REPORTER_LIMITS.ackPerAddressHours})
  `);
  if (recent) return null;
  const deleteToken = await deleteTokenFor(tx, a.contactId, a.hmac, a.deviceId);
  return enqueue(tx, {
    purpose: "report_ack",
    reportId: a.reportId,
    recipientHash: a.hmac,
    payload: { contactId: a.contactId, expiresAt: retryUntil(), deleteToken },
  });
}

/** Has this report already sent (or queued) its one outcome? (§5.3(h): a query on the state events.) */
async function outcomeAlreadySent(tx: Tx, reportId: number): Promise<boolean> {
  return (
    (await count(tx, sql`
      select count(*)::int as n from report_state_events
       where report_id = ${reportId} and reporter_message = 'report_outcome'
    `)) > 0
  );
}

export const REPORTER_ON_CLOSE = ["none", "already_sent", "will_send", "held", "may_not_arrive"] as const;
/** SYC-515: what happens to the reporter if this report closes. */
export type ReporterOnClose = (typeof REPORTER_ON_CLOSE)[number];

/**
 * SYC-515 (spec §2): the one answer to "what happens to the reporter if this
 * closes?". The Queue and the state route both use it, and `moveReportState`
 * asks it again inside the move's transaction. It reads the same facts
 * `onReportStateChanged` acts on, and judges a bounced or refused address the
 * way `sendMail` does (`isReportSuppressed`, as for a confirmed address).
 */
export async function reporterOnClose(
  tx: Tx | typeof db,
  reportId: number,
  /** `lock`: inside a move's transaction, take the address lock first, as
   * `onReportStateChanged` does, so a confirmation running at the same
   * moment either lands before this read or waits for the move. */
  opts: { lock?: boolean } = {},
): Promise<ReporterOnClose> {
  const readContact = async () =>
    (
      await tx.execute(sql`
        select c.address, c.status, c.address_hmac, c.device_id from welfare_reports r
          join email_contacts c on c.id = r.reporter_contact_id
         where r.id = ${reportId} and r.kind = 'welfare'
      `)
    ).rows[0] as { address: string | null; status: string; address_hmac: string; device_id: string | null } | undefined;
  let c = await readContact();
  if (!c) return "none";
  if (opts.lock) {
    await lock(tx as Tx, c.address_hmac);
    c = await readContact();
    if (!c) return "none";
  }
  // The same conditions, in the same order, as onReportStateChanged (and
  // confirmReporterAddress, which skips a contact with no device): a contact
  // with no phone on file, or no address left, is never emailed.
  if (!c.device_id || !c.address) return "none";
  if (c.status !== "confirmed") return "held";
  const sent =
    (
      (
        await tx.execute(sql`
          select count(*)::int as n from report_state_events
           where report_id = ${reportId} and reporter_message = 'report_outcome'
        `)
      ).rows[0] as { n: number }
    ).n > 0;
  if (sent) return "already_sent";
  if (await isReportSuppressed(c.address, "confirmed")) return "may_not_arrive";
  return "will_send";
}

async function queueOutcome(
  tx: Tx,
  o: { reportId: number; contactId: number; hmac: string; deviceId: string; outcome: ReportOutcome; teamSentence: string | null; dueAt?: Date },
): Promise<number> {
  const deleteToken = await deleteTokenFor(tx, o.contactId, o.hmac, o.deviceId);
  return enqueue(tx, {
    purpose: "report_outcome",
    reportId: o.reportId,
    recipientHash: o.hmac,
    payload: {
      contactId: o.contactId,
      expiresAt: retryUntil(),
      deleteToken,
      outcome: o.outcome,
      ...(o.outcome === "done" && o.teamSentence ? { teamSentence: o.teamSentence } : {}),
    },
    dueAt: o.dueAt,
  });
}

/**
 * Called inside `moveReportState`'s transaction, after the state event is
 * written. A move to a closing state sends the reporter's one outcome email,
 * if they left an address, it's confirmed, and the report hasn't sent one
 * before (re-opening and re-closing sends no second). "Looking at it" sends
 * nothing (§5.3(h)). An unconfirmed address is held: confirming sends it.
 */
export async function onReportStateChanged(
  tx: Tx,
  m: { reportId: number; eventId: number; to: string; teamSentence: string | null },
): Promise<number | null> {
  if (m.to !== "done" && m.to !== "nothing_needed") return null;
  const readContact = async () =>
    (
      await tx.execute(sql`
        select c.id, c.address_hmac, c.status, c.device_id from welfare_reports r
          join email_contacts c on c.id = r.reporter_contact_id
         where r.id = ${m.reportId} and r.kind = 'welfare'
      `)
    ).rows[0] as { id: number; address_hmac: string; status: string; device_id: string | null } | undefined;
  const first = await readContact();
  if (!first) return null;
  // Lock, THEN read the status: a confirmation running at the same moment
  // either finishes first (and we see it confirmed) or waits for this close
  // (and sends the held outcome itself). Read before the lock, the two could
  // each miss the other and the outcome would never go (review of #181,
  // finding 5).
  await lock(tx, first.address_hmac);
  const contact = await readContact();
  if (!contact || contact.status !== "confirmed" || !contact.device_id) return null;
  if (await outcomeAlreadySent(tx, m.reportId)) return null;
  await tx.execute(sql`update report_state_events set reporter_message = 'report_outcome' where id = ${m.eventId}`);
  return queueOutcome(tx, {
    reportId: m.reportId,
    contactId: contact.id,
    hmac: contact.address_hmac,
    deviceId: contact.device_id,
    outcome: m.to,
    teamSentence: m.teamSentence,
  });
}

// ── "Yes, that was me" and "Forget this address" ───────────────────────────

/**
 * The address is confirmed: every report row from the same phone waiting on it becomes confirmed,
 * and what was held is sent, in one go (email-capture.md §4.3 step 5): each
 * report's acknowledgement (one per address per 24 hours), and the outcome of
 * any report the team has already closed. Runs inside confirmAddress's
 * transaction. Returns the outbox rows to kick.
 */
export async function confirmReporterAddress(tx: Tx, hmac: string, deviceId: string): Promise<number[]> {
  await lock(tx, hmac);
  // Only this phone's reports: a report someone else typed the same address
  // on waits for its own "is this you?" (review of #181, finding 1).
  const confirmed = (
    await tx.execute(sql`
      update email_contacts set status = 'confirmed', confirmed_at = now()
       where purpose = 'report' and address_hmac = ${hmac} and status = 'pending'
         and device_id = ${deviceId}
      returning id, device_id
    `)
  ).rows as { id: number; device_id: string | null }[];
  const ids: number[] = [];
  for (const c of confirmed) {
    await tx.execute(sql`
      insert into email_consent_events (contact_id, device_id, address_hmac, purpose, event)
      values (${c.id}, ${c.device_id}, ${hmac}, 'report', 'verified')
    `);
    if (!c.device_id) continue;
    const reports = (
      await tx.execute(sql`
        select id, state from welfare_reports
         where reporter_contact_id = ${c.id} and is_draft = false and kind = 'welfare' order by created_at
      `)
    ).rows as { id: number; state: string }[];
    for (const r of reports) {
      const ack = await queueAck(tx, { reportId: r.id, contactId: c.id, hmac, deviceId: c.device_id });
      if (ack !== null) ids.push(ack);
      if ((r.state === "done" || r.state === "nothing_needed") && !(await outcomeAlreadySent(tx, r.id))) {
        // The closing move that this outcome answers: mark it, so a later
        // re-close finds it and sends no second.
        await tx.execute(sql`
          update report_state_events set reporter_message = 'report_outcome'
           where id = (
             select id from report_state_events
              where report_id = ${r.id} and to_state in ('done', 'nothing_needed')
              order by at desc, id desc limit 1)
        `);
        ids.push(
          await queueOutcome(tx, {
            reportId: r.id,
            contactId: c.id,
            hmac,
            deviceId: c.device_id,
            outcome: r.state as ReportOutcome,
            teamSentence: null,
            // After the acknowledgement, so they arrive in order.
            dueAt: new Date(Date.now() + 2 * 60_000),
          }),
        );
      }
    }
  }
  return ids;
}

export type ReporterForget = "forgotten" | "deleted";

/**
 * A forget-purpose link on a report address. Every report row holding this
 * address goes, which takes the address off every report (the reports stay).
 *
 * - From the "is this you?" email (the address was never confirmed): also
 *   suppressed for reports, so typing it again sends nothing (§4.3 step 7).
 * - "Delete my details", from an acknowledgement or outcome (confirmed): the
 *   person is deleting, not refusing, so a later report of theirs can still
 *   ask; its consent records are redacted in place (§5.6).
 */
export async function forgetReporterAddress(
  tx: Tx,
  t: { contactId: number; hmac: string },
): Promise<ReporterForget> {
  await lock(tx, t.hmac);
  const [own] = (
    await tx.execute(sql`select status from email_contacts where id = ${t.contactId}`)
  ).rows as { status: string }[];
  const confirmed = own?.status === "confirmed";
  const removed = (
    await tx.execute(sql`
      delete from email_contacts where purpose = 'report' and address_hmac = ${t.hmac}
      returning id
    `)
  ).rows as { id: number }[];
  const ids = removed.map((r) => r.id);
  if (ids.length) {
    const list = sql.join(ids.map((id) => sql`${String(id)}`), sql`, `);
    // Every email to it goes: queued ones hold a raw link, sent ones the
    // address's fingerprint, and so do their delivery records (review of
    // #181, finding 4; the same rows "Delete my data" removes).
    await tx.execute(sql`
      delete from mail_deliveries
       where provider_message_id in (
         select provider_message_id from mail_outbox
          where purpose in ('public_verify', 'report_ack', 'report_outcome')
            and provider_message_id is not null
            and payload->>'contactId' in (${list}))
    `);
    await tx.execute(sql`
      delete from mail_outbox
       where purpose in ('public_verify', 'report_ack', 'report_outcome')
         and payload->>'contactId' in (${list})
    `);
    await tx.execute(sql`
      update email_consent_events
         set contact_id = null, device_id = null, address_hmac = null,
             redacted_at = coalesce(redacted_at, now()),
             redaction_reason = coalesce(redaction_reason, ${confirmed ? "deleted by the person" : "unconfirmed address withdrawn"})
       where contact_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    `);
  }
  if (!confirmed) {
    await tx.execute(sql`
      insert into email_suppressions (address_hmac, reason, scope)
      values (${t.hmac}, 'forget', 'report') on conflict do nothing
    `);
    await tx.execute(sql`
      insert into email_consent_events (address_hmac, purpose, event, surface)
      values (${t.hmac}, 'report', 'withdrawn', 'email')
    `);
  } else {
    await tx.execute(sql`
      insert into email_consent_events (purpose, event, surface)
      values ('report', 'withdrawn', 'email')
    `);
  }
  return confirmed ? "deleted" : "forgotten";
}

// ── Sending (called by the outbox) ─────────────────────────────────────────

/** Reasons a send won't get better by trying again. */
const FINAL: ReadonlySet<string> = new Set([
  "unknown_purpose",
  "purpose_disabled",
  "recipient_not_allowed",
  "bad_recipient",
  "suppression_check_missing",
  "verification_check_missing",
  "suppressed",
  "unverified",
  "unknown_template",
]);

export type OutboxHelpers = {
  markSent: (row: MailOutboxRow, providerMessageId: string | null, payload: Record<string, unknown>) => Promise<void>;
  markRetry: (row: MailOutboxRow, error: string) => Promise<void>;
};

async function giveUp(row: MailOutboxRow, payload: ReporterPayload, error: string): Promise<void> {
  await db
    .update(mailOutboxTable)
    .set({ state: "failed", lastError: error, payload: { contactId: payload.contactId, expiresAt: payload.expiresAt, cleared: true } })
    .where(eq(mailOutboxTable.id, row.id));
}

export async function processReporterMail(
  row: MailOutboxRow,
  helpers: OutboxHelpers,
): Promise<"sent" | "retry" | "failed"> {
  const purpose = row.purpose as ReporterPurpose;
  const payload = (row.payload ?? {}) as ReporterPayload;
  const settled = { contactId: payload.contactId, expiresAt: payload.expiresAt, cleared: true as const };
  const expiresAt = Date.parse(payload.expiresAt ?? "");
  if (!(expiresAt > Date.now())) {
    await giveUp(row, payload, "expired");
    return "failed";
  }
  const [contact] = (
    await db.execute(sql`select address, status from email_contacts where id = ${payload.contactId ?? -1}`)
  ).rows as { address: string | null; status: string }[];
  if (!contact?.address) {
    await giveUp(row, payload, "contact_gone");
    return "failed";
  }

  let params: Record<string, string>;
  if (purpose === "public_verify") {
    // Confirmed since (another report's email): this one would say nothing new.
    if (contact.status === "confirmed") {
      await giveUp(row, payload, "already_confirmed");
      return "failed";
    }
    if (!payload.token || !payload.forgetToken) {
      await giveUp(row, payload, "nothing_to_send");
      return "failed";
    }
    params = { confirmUrl: confirmUrl(payload.token), forgetUrl: forgetUrl(payload.forgetToken) };
  } else {
    if (!payload.deleteToken || row.reportId === null) {
      await giveUp(row, payload, "nothing_to_send");
      return "failed";
    }
    const [report] = (
      await db.execute(sql`select is_litter, photo_state, coalesce(submitted_at, created_at) as at from welfare_reports where id = ${row.reportId} and kind = 'welfare'`)
    ).rows as { is_litter: boolean; photo_state: string; at: Date | string }[];
    if (!report) {
      await giveUp(row, payload, "report_gone");
      return "failed";
    }
    const deleteUrl = forgetUrl(payload.deleteToken);
    if (purpose === "report_ack") {
      params = {
        date: reportDate(new Date(report.at)),
        litter: report.is_litter ? "yes" : "no",
        photo: report.photo_state === "attached" ? "yes" : "no",
        deleteUrl,
      };
    } else {
      params = { outcome: payload.outcome ?? "", deleteUrl };
      const sentence = cleanTeamSentence(payload.teamSentence);
      if (sentence) params["teamSentence"] = sentence;
    }
  }

  const result: SendResult = await sendMail(
    {
      purpose,
      to: contact.address,
      template: purpose,
      params,
      // One per row: a retry after a lost response can't send a second email.
      idempotencyKey: `${purpose}-${row.id}-${row.createdAt.getTime()}`,
    },
    reportSendDeps(purpose),
  );
  if (!result.ok) {
    const refusedByProvider =
      result.reason === "provider_error" && typeof result.status === "number" &&
      result.status >= 400 && result.status < 500 && result.status !== 429;
    if (FINAL.has(result.reason) || refusedByProvider) {
      await giveUp(row, payload, result.reason);
      return "failed";
    }
    await helpers.markRetry(row, `${result.reason}${result.detail ? `: ${result.detail}` : ""}`);
    return "retry";
  }
  await helpers.markSent(row, result.providerMessageId, settled);
  return "sent";
}
