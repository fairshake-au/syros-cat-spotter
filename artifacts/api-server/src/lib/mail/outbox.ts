import {
  db,
  catsTable,
  mailOutboxTable,
  photosTable,
  welfareReportPhotosTable,
  welfareReportsTable,
  type MailOutboxRow,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger, safeError } from "../logger";
import { consume, declareLimit } from "../limits";
import { buildUncheckedWaiting, buildWelfareAlert, type AlertKind } from "../welfare/alertEmail";
import { buildIssueAlert, buildIssueDigest, type IssueDigestItem } from "../issues/alertEmail";
import { isNearFeedingSite, withCheckTimeout } from "../feedingSiteProximity";
import {
  hashRecipient,
  isSheddable,
  NEVER_SHED_PURPOSES,
  sendMail,
  shedThreshold,
  type SendResult,
} from "./send";
import { keepSafeSendDeps, type KeepSafeMail } from "./suppression";
import { confirmUrl, forgetUrl, restoreUrl } from "../keepSafe/links";
import { REPORTER_PURPOSES, processReporterMail } from "../welfare/reporterEmail";
import { PERSON_OUTBOX_PURPOSES, processPersonMail } from "./personOutbox";

/**
 * The mail outbox (SYC-42 plan, Slice 1 items 1.5–1.6).
 *
 * The report row is the source of truth; an outbox row is a notification
 * about it, written in the SAME transaction as the report, so a report can't
 * exist without its alert being queued, and nothing about mail can lose a
 * report (spec §4.3, §8.3).
 *
 * The deployment is autoscale and can sleep, so a timer inside the server
 * isn't guaranteed to run. Three layers make sure the email goes:
 *   1. right after the transaction commits, the same server tries (`kick`);
 *   2. every API request checks for due rows after replying
 *      (`opportunisticDrain`, at most two rows, throttled);
 *   3. a GitHub Actions schedule calls POST /api/internal/mail/drain every
 *      10 minutes with its own narrow token.
 * Welfare alert retries back off 1, 5, 15, 60 minutes, then hourly, forever. If any
 * welfare alert is still unsent an hour after it was queued, the drain call
 * fails, and GitHub emails Samuel about the failed run: a delivery path that
 * doesn't depend on Resend. That is about the system being broken, not about
 * a cat, and it pages nobody (F1).
 *
 * Rows are claimed with `FOR UPDATE SKIP LOCKED`, so two servers (or two
 * drains) never send the same alert. A claimed row holds a 5-minute lease in
 * `next_attempt_at`; if its server dies mid-send, the row is reclaimed after
 * that.
 *
 * **Keep-safe mail (SYC-3 plan, Slice 1 steps 2 and 5; review A4, R1, R2).**
 * The "is this you?" email and the restore link ride the same outbox. Their
 * payload has to carry the address and the raw link token, because the
 * database keeps only their fingerprints. Both are cleared from the row the
 * moment it's sent, given up on, or its token expires, whichever comes
 * first, so Decision 4 holds at rest and no usable token sits in the table.
 * Retries stop at the token's expiry, never "hourly, forever": the drain
 * never sends a link that has already expired. The request kicks its own row
 * straight away (`kickRow`); the 10-minute drain is only the retry.
 */

/** `mail_outbox.last_error` for a row the budget dropped. */
export const SHED = "shed";

export const PHOTO_WAIT_MINUTES = 10;
export const OVERDUE_MINUTES = 60;
const LEASE = sql`interval '5 minutes'`;
const BACKOFF_MINUTES = [1, 5, 15, 60];

export function backoffMinutes(attempts: number): number {
  return BACKOFF_MINUTES[Math.max(0, attempts - 1)] ?? 60;
}

export function alertRecipient(): string {
  return (process.env["WELFARE_ALERT_TO"] ?? "").trim();
}

export function alertRecipientHash(): string {
  const to = alertRecipient();
  return to ? hashRecipient(to) : "unset";
}

type Payload = {
  kind?: AlertKind | typeof UNCHECKED_WAITING;
  photoIncluded?: boolean;
  withMapLinks?: boolean;
  /** SYC-170: the alert is for a report accepted while Cloudflare was unreachable. */
  unchecked?: true;
  /** SYC-170: how many unchecked reports the "waiting" email counted (fixed at first try). */
  waiting?: number;
};

/**
 * SYC-170 (spec §9.5; plan PR 1.1, small call): reports accepted unchecked
 * (Cloudflare unreachable) still get their own alert, because a hurt cat must
 * not wait, but only 10 an hour in total. Beyond that, at most one
 * "N unchecked reports waiting" email an hour, under the same never-shed
 * welfare_alert purpose, so an outage (or a script during one) can neither
 * flood the inbox nor silence a real report entirely.
 */
export const UNCHECKED_ALERTS_PER_HOUR = 10;
export const UNCHECKED_WAITING = "unchecked_waiting" as const;
// The "waiting" email goes a little after the first report it covers, so it
// can count the ones that follow in the same burst.
export const UNCHECKED_WAITING_DELAY_MINUTES = 15;
// One lock for the cap's count-then-insert, so two reports at once can't both
// take the tenth place.
const UNCHECKED_ALERT_LOCK = 170_001;

/**
 * SYC-44 PR 5.2 (spec §5.2): "Photo hidden" alerts go out one by one, but at
 * most 10 an hour across the whole island. Past that the report waits for the
 * daily digest. The count is the shared `consume()` counter, taken inside the
 * report's transaction, under one bucket and one key, so every server shares
 * it.
 */
export const ISSUE_ALERTS_PER_HOUR = 10;
export const ISSUE_ALERT_BUCKET = "issue_alert_hidden";
const HOUR_MS = 60 * 60 * 1000;
declareLimit(ISSUE_ALERT_BUCKET, ISSUE_ALERTS_PER_HOUR, HOUR_MS);

/**
 * Queue the "Photo hidden" alert for an issue report, inside the report's
 * transaction. Returns `"alert"` when a row was queued, or `"digest"` when the
 * report is left for the daily digest (over the cap, or the counter failed:
 * the cap fails CLOSED, so a broken counter can never become unlimited
 * email). Nothing is inserted for `"digest"`; the report row itself is what
 * the digest counts.
 *
 * The counter runs in a savepoint: a database error inside it would otherwise
 * poison the caller's whole transaction and lose the report.
 */
export async function enqueueIssueAlert(tx: Tx, reportId: number): Promise<"alert" | "digest"> {
  let allowed = false;
  try {
    allowed = await tx.transaction(async (sp) => {
      const counted = await consume(ISSUE_ALERT_BUCKET, "island", ISSUE_ALERTS_PER_HOUR, HOUR_MS, sp);
      return counted.allowed;
    });
  } catch (err) {
    logger.error({ err: safeError(err) }, "issue alert cap: counter failed; folded into the digest");
    return "digest";
  }
  if (!allowed) return "digest";
  await tx.insert(mailOutboxTable).values({
    purpose: "issue_alert",
    reportId,
    recipientHash: alertRecipientHash(),
    payload: { kind: "alert" } satisfies IssuePayload,
  });
  return "alert";
}

/**
 * The daily "Issue reports: N waiting" digest (spec §5.2). Called from the
 * mail drain, which has no clock of its own: the once-a-day guard is the
 * `issue_digest_runs` row for today's ATHENS date, claimed with
 * `insert … on conflict do nothing` in the SAME transaction that queues the
 * digest in the outbox. Two things follow:
 *   - two drains at the same moment queue it once (the loser waits on the
 *     unique key, then finds the day taken);
 *   - a failed send is the outbox's to retry, and the day is not lost, since
 *     claiming the day and queueing the email either both happen or neither.
 * It is queued only if there are open "Report an issue" rows, and a quiet day
 * claims nothing, so a report that arrives later that day still gets one.
 * The items are fixed here, so a retry sends the same body. No notes.
 */
export async function sendIssueDigestIfDue(): Promise<"queued" | "nothing_waiting" | "already_sent_today"> {
  return db.transaction(async (tx) => {
    const open = await tx.execute(sql`
      select r.reason, r.cat_id, c.name as cat_name, count(*)::int as n
        from welfare_reports r
        left join cats c on c.id = r.cat_id
       where r.kind = 'content' and r.state in ('new', 'looking')
       group by r.reason, r.cat_id, c.name
       order by min(r.created_at)
    `);
    const items = (open.rows as { reason: string; cat_id: number | null; cat_name: string | null; n: number }[]).map(
      (r): IssueDigestItem => ({ reason: r.reason, catId: r.cat_id, catName: r.cat_name, count: Number(r.n) }),
    );
    const waiting = items.reduce((sum, i) => sum + i.count, 0);
    if (waiting === 0) return "nothing_waiting";
    const claimed = await tx.execute(sql`
      insert into issue_digest_runs (day)
      values ((now() at time zone 'Europe/Athens')::date)
      on conflict (day) do nothing
      returning day::text as day
    `);
    const day = (claimed.rows[0] as { day: string } | undefined)?.day;
    if (!day) return "already_sent_today";
    await tx.insert(mailOutboxTable).values({
      purpose: "issue_alert",
      reportId: null,
      recipientHash: alertRecipientHash(),
      payload: { kind: "digest", day, waiting, digest: items } satisfies IssuePayload,
    });
    return "queued";
  });
}

/** A keep-safe row's payload. `to` and the tokens are gone once it's settled. */
export type KeepSafePayload = {
  expiresAt: string;
  to?: string;
  token?: string;
  forgetToken?: string;
  cleared?: true;
};

export const KEEP_SAFE_OUTBOX_PURPOSES: readonly KeepSafeMail[] = ["keep_safe_verify", "restore_link"];

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** An issue_alert row's payload (SYC-44 PR 5.2). */
type IssuePayload = {
  kind: "alert" | "digest";
  /** Digest only: the Athens day it covers, how many reports it counted and what it listed (fixed when queued, so a retry sends the same body). */
  day?: string;
  waiting?: number;
  digest?: IssueDigestItem[];
};

/** Queue a welfare alert inside the caller's transaction. */
export async function enqueueWelfareAlert(
  tx: Tx,
  reportId: number,
  kind: AlertKind,
  dueAt: Date | null,
): Promise<void> {
  await tx.insert(mailOutboxTable).values({
    purpose: "welfare_alert",
    reportId,
    recipientHash: alertRecipientHash(),
    payload: { kind } satisfies Payload,
    ...(dueAt ? { nextAttemptAt: dueAt } : {}),
  });
}

/**
 * Queue the alert for a report accepted UNCHECKED, inside the caller's
 * transaction: its own alert while fewer than 10 such alerts were queued in
 * the last hour; otherwise one "waiting" email, unless one was already queued
 * in the last hour. Returns which it did.
 */
export async function enqueueUncheckedWelfareAlert(
  tx: Tx,
  reportId: number,
  dueAt: Date | null,
): Promise<"alert" | "waiting" | "none"> {
  await tx.execute(sql`select pg_advisory_xact_lock(${UNCHECKED_ALERT_LOCK})`);
  if ((await uncheckedEmailsThisHour(tx)) < UNCHECKED_ALERTS_PER_HOUR) {
    await tx.insert(mailOutboxTable).values({
      purpose: "welfare_alert",
      reportId,
      recipientHash: alertRecipientHash(),
      payload: { kind: "alert", unchecked: true } satisfies Payload,
      ...(dueAt ? { nextAttemptAt: dueAt } : {}),
    });
    return "alert";
  }
  // Past the cap: this report must be covered by a "waiting" email. The
  // latest one covers it only if it hasn't counted yet (its count is fixed
  // at its first try). Otherwise queue the next one, an hour after the last
  // one went, so no unchecked report is ever left without an email (review
  // of #151, finding 3) and the team still gets at most one an hour.
  const latest = await tx.execute(sql`
    select (state in ('queued', 'sending') and not (payload ? 'waiting')) as covers,
           greatest(
             now() + make_interval(mins => ${UNCHECKED_WAITING_DELAY_MINUTES}),
             coalesce(sent_at, created_at + make_interval(mins => ${UNCHECKED_WAITING_DELAY_MINUTES})) + interval '1 hour'
           ) as next_due
      from mail_outbox
     where purpose = 'welfare_alert' and payload->>'kind' = ${UNCHECKED_WAITING}
     order by created_at desc, id desc
     limit 1
  `);
  const last = latest.rows[0] as { covers: boolean; next_due: Date | string } | undefined;
  if (last?.covers) return "none";
  await tx.insert(mailOutboxTable).values({
    purpose: "welfare_alert",
    reportId: null,
    recipientHash: alertRecipientHash(),
    payload: { kind: UNCHECKED_WAITING } satisfies Payload,
    nextAttemptAt: last
      ? new Date(last.next_due)
      : new Date(Date.now() + UNCHECKED_WAITING_DELAY_MINUTES * 60_000),
  });
  return "waiting";
}

/**
 * The photo follow-up for an unchecked report that had its own alert. It
 * counts toward the same 10 an hour as the alerts (review of #151, finding
 * 9), so the cap really is 10 unchecked emails an hour, not 20. Past the cap
 * it isn't sent: that report already had its own alert, and its photo is on
 * the queue page.
 */
export async function enqueueUncheckedPhotoFollowUp(tx: Tx, reportId: number): Promise<boolean> {
  await tx.execute(sql`select pg_advisory_xact_lock(${UNCHECKED_ALERT_LOCK})`);
  if ((await uncheckedEmailsThisHour(tx)) >= UNCHECKED_ALERTS_PER_HOUR) return false;
  await tx.insert(mailOutboxTable).values({
    purpose: "welfare_alert",
    reportId,
    recipientHash: alertRecipientHash(),
    payload: { kind: "photo", unchecked: true } satisfies Payload,
  });
  return true;
}

/**
 * Individual emails about unchecked reports (alerts and photo follow-ups)
 * queued in the last hour: the cap's count.
 */
async function uncheckedEmailsThisHour(tx: Tx): Promise<number> {
  const counted = await tx.execute(sql`
    select count(*)::int as n
      from mail_outbox
     where purpose = 'welfare_alert'
       and payload->>'kind' in ('alert', 'photo')
       and payload->>'unchecked' = 'true'
       and created_at > now() - interval '1 hour'
  `);
  return Number((counted.rows[0] as { n: number } | undefined)?.n ?? 0);
}

/**
 * Sent, still-open unchecked reports that never got an alert of their own:
 * what the "waiting" email counts.
 */
async function countUncheckedWithoutAlert(): Promise<number> {
  const result = await db.execute(sql`
    select count(*)::int as n from welfare_reports r
     where r.kind = 'welfare'
       and r.is_draft = false
       and r.token_checked = false
       and r.state in ('new', 'looking')
       and not exists (
         select 1 from mail_outbox m
          where m.report_id = r.id and m.purpose = 'welfare_alert'
       )
  `);
  return Number((result.rows[0] as { n: number } | undefined)?.n ?? 0);
}

async function processUncheckedWaiting(row: MailOutboxRow): Promise<"sent" | "retry" | "failed"> {
  const payload = (row.payload ?? {}) as Payload;
  // Fixed at the first try and stored, so a retry sends the same body under
  // the same idempotency key.
  let waiting = payload.waiting;
  if (typeof waiting !== "number") {
    waiting = await countUncheckedWithoutAlert();
    await db
      .update(mailOutboxTable)
      .set({ payload: { ...payload, waiting } })
      .where(eq(mailOutboxTable.id, row.id));
  }
  if (waiting === 0) {
    // The team already dealt with them: nothing to say.
    await markSent(row, null, { ...payload, waiting });
    return "sent";
  }
  const result = await sendMail({
    purpose: "welfare_alert",
    ...buildUncheckedWaiting(waiting),
    idempotencyKey: `welfare-unchecked-waiting-${row.id}-${row.createdAt.getTime()}`,
  });
  if (!result.ok) {
    await markRetry(row, `${result.reason}${result.detail ? `: ${result.detail}` : ""}`);
    return "retry";
  }
  await markSent(row, result.providerMessageId, { ...payload, waiting });
  return "sent";
}

/**
 * Queue a keep-safe email inside the caller's transaction. Returns the row id,
 * for `kickRow` once the transaction has committed.
 */
export async function enqueueKeepSafeMail(
  tx: Tx,
  mail: { purpose: KeepSafeMail; to: string; token: string; forgetToken?: string; expiresAt: Date },
): Promise<number> {
  const payload: KeepSafePayload = {
    expiresAt: mail.expiresAt.toISOString(),
    to: mail.to,
    token: mail.token,
    ...(mail.forgetToken ? { forgetToken: mail.forgetToken } : {}),
  };
  const [row] = await tx
    .insert(mailOutboxTable)
    .values({ purpose: mail.purpose, recipientHash: hashRecipient(mail.to, mail.purpose), payload })
    .returning({ id: mailOutboxTable.id });
  return row!.id;
}

/**
 * Never-shed purposes first (SYC-44 PR 5.2): a queue of issue alerts, however
 * long and however old, can never sit in front of a hurt cat's alert in the
 * batch the drain takes.
 */
const neverShedFirst = sql`(purpose in (${sql.join(
  NEVER_SHED_PURPOSES.map((p) => sql`${p}`),
  sql`, `,
)})) desc`;

/**
 * The pick is a MATERIALIZED CTE, so the limited, locking select runs exactly
 * once whatever join the planner chooses (SYC-537). As a bare `id in (select …
 * limit n for update skip locked)` it can be re-run per outer row, and rows
 * this statement has already updated are skipped by the lock, so each re-run
 * would pick the next batch: a drain once claimed all 501 due rows for a limit
 * of 25 and would have sent a burst.
 */
export async function claimDue(
  limit: number,
  onlyId?: number,
  exec: Pick<typeof db, "execute"> = db,
): Promise<MailOutboxRow[]> {
  const result = await exec.execute(sql`
    with picked as materialized (
      select id from mail_outbox
       where state in ('queued', 'sending')
         and next_attempt_at <= now()
         ${onlyId === undefined ? sql`` : sql`and id = ${onlyId}`}
       order by ${neverShedFirst}, next_attempt_at
       limit ${limit}
         for update skip locked
    )
    update mail_outbox
       set state = 'sending',
           attempts = attempts + 1,
           next_attempt_at = now() + ${LEASE}
     where id in (select id from picked)
    returning id
  `);
  const ids = (result.rows as { id: number }[]).map((r) => r.id);
  if (!ids.length) return [];
  return db
    .select()
    .from(mailOutboxTable)
    .where(sql`${mailOutboxTable.id} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
}

const DELIVERY_RECORDED: ReadonlySet<string> = new Set([
  "welfare_alert",
  "public_verify",
  "report_ack",
  "report_outcome",
]);

async function markSent(row: MailOutboxRow, providerMessageId: string | null, payload: Payload | Record<string, unknown>) {
  await db
    .update(mailOutboxTable)
    .set({
      state: "sent",
      sentAt: new Date(),
      providerMessageId,
      lastError: null,
      payload,
    })
    .where(eq(mailOutboxTable.id, row.id));
  // What happens to it next comes from Resend's webhook (SYC-42 Slice 3,
  // item 3.6), for the mail the queue shows: the alert and the reporter's
  // emails. Keep-safe mail isn't recorded, so its delivery records can't
  // outlive "Delete my data" (review of #181, finding 3). Best effort: the
  // email has gone, whatever this does.
  if (providerMessageId && DELIVERY_RECORDED.has(row.purpose)) {
    await db
      .execute(sql`
        insert into mail_deliveries (provider_message_id, purpose, report_id, recipient_hash)
        values (${providerMessageId}, ${row.purpose}, ${row.reportId}, ${row.recipientHash})
        on conflict (provider_message_id) do nothing
      `)
      .catch((err) => logger.error({ err: safeError(err), outboxId: row.id }, "mail_deliveries: not recorded"));
  }
}

async function markRetry(row: MailOutboxRow, error: string) {
  const minutes = backoffMinutes(row.attempts);
  await db
    .update(mailOutboxTable)
    .set({
      state: "queued",
      lastError: error.slice(0, 500),
      nextAttemptAt: new Date(Date.now() + minutes * 60_000),
    })
    .where(eq(mailOutboxTable.id, row.id));
  logger.error(
    { outboxId: row.id, purpose: row.purpose, attempts: row.attempts, retryInMinutes: minutes, error: error.slice(0, 200) },
    "mail outbox: send failed; will retry",
  );
}

async function markFailed(row: MailOutboxRow, error: string) {
  await db
    .update(mailOutboxTable)
    .set({ state: "failed", lastError: error })
    .where(eq(mailOutboxTable.id, row.id));
  logger.error({ outboxId: row.id, error }, "mail outbox: given up (nothing left to send)");
}

/** Give up on a keep-safe row, clearing its address and tokens. */
async function giveUpKeepSafe(row: MailOutboxRow, error: string) {
  const payload = (row.payload ?? {}) as KeepSafePayload;
  await db
    .update(mailOutboxTable)
    .set({ state: "failed", lastError: error, payload: { expiresAt: payload.expiresAt, cleared: true } })
    .where(eq(mailOutboxTable.id, row.id));
  logger.warn({ outboxId: row.id, purpose: row.purpose, error }, "mail outbox: keep-safe mail given up; address and link cleared");
}

/** Reasons a keep-safe send won't get better by trying again. */
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

async function processKeepSafe(row: MailOutboxRow, mail: KeepSafeMail): Promise<"sent" | "retry" | "failed"> {
  const payload = (row.payload ?? {}) as KeepSafePayload;
  const expiresAt = Date.parse(payload.expiresAt ?? "");
  if (!payload.to || !payload.token || !(expiresAt > Date.now())) {
    await giveUpKeepSafe(row, payload.to && payload.token ? "token_expired" : "nothing_to_send");
    return "failed";
  }
  let params: Record<string, string>;
  if (mail === "restore_link") {
    params = { restoreUrl: restoreUrl(payload.token) };
  } else {
    if (!payload.forgetToken) {
      await giveUpKeepSafe(row, "nothing_to_send");
      return "failed";
    }
    params = { confirmUrl: confirmUrl(payload.token), forgetUrl: forgetUrl(payload.forgetToken) };
  }
  const result: SendResult = await sendMail(
    {
      purpose: mail,
      to: payload.to,
      template: mail,
      params,
      // One per token: a retry after a lost response can't send a second email.
      idempotencyKey: `${mail}-${row.recipientHash.slice(0, 12)}-${row.id}-${row.createdAt.getTime()}`,
    },
    keepSafeSendDeps(mail),
  );
  if (!result.ok) {
    // A provider 4xx (except 429) is about this message, not a passing fault.
    const refusedByProvider =
      result.reason === "provider_error" && typeof result.status === "number" &&
      result.status >= 400 && result.status < 500 && result.status !== 429;
    if (FINAL.has(result.reason) || refusedByProvider) {
      await giveUpKeepSafe(row, result.reason);
      return "failed";
    }
    await markRetry(row, `${result.reason}${result.detail ? `: ${result.detail}` : ""}`);
    return "retry";
  }
  await markSent(row, result.providerMessageId, { expiresAt: payload.expiresAt, cleared: true } as Payload);
  return "sent";
}

/**
 * SYC-44 PR 5.2: the "Photo hidden" alert. Built from the report row, the
 * cat's name and the reported photo's bytes, read at send time. It never waits
 * for a photo (the photo is already in the catalogue, not uploaded later), and
 * a row that isn't a "Report an issue" row is given up, never sent with this
 * copy.
 */
async function processIssueAlert(row: MailOutboxRow): Promise<"sent" | "retry" | "failed"> {
  const payload = (row.payload ?? {}) as IssuePayload;
  if (payload.kind === "digest") return processIssueDigest(row, payload);
  if (row.reportId === null) {
    await markFailed(row, "report_gone");
    return "failed";
  }
  const [report] = await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.id, row.reportId));
  if (!report) {
    await markFailed(row, "report_gone");
    return "failed";
  }
  if (report.kind !== "content") {
    await markFailed(row, "wrong_kind");
    return "failed";
  }
  const [cat] =
    report.catId === null
      ? []
      : await db.select({ id: catsTable.id, name: catsTable.name }).from(catsTable).where(eq(catsTable.id, report.catId));
  const [stored] =
    report.photoId === null
      ? []
      : await db.select({ data: photosTable.data, mime: photosTable.mime }).from(photosTable).where(eq(photosTable.id, report.photoId));
  const bytes = stored?.data ? Buffer.from(stored.data, "base64") : null;
  const photo = bytes && bytes.length > 0 ? { bytes, mime: stored!.mime } : null;
  const result = await sendMail({
    purpose: "issue_alert",
    ...buildIssueAlert(report, cat ?? null, photo),
    // Names the report and whether the photo is attached, as the welfare alert does.
    idempotencyKey: `issue-${report.publicId}-${row.id}-${photo ? "photo" : "nophoto"}`,
  });
  if (!result.ok) {
    await markRetry(row, `${result.reason}${result.detail ? `: ${result.detail}` : ""}`);
    return "retry";
  }
  await markSent(row, result.providerMessageId, payload);
  return "sent";
}

async function processIssueDigest(row: MailOutboxRow, payload: IssuePayload): Promise<"sent" | "retry" | "failed"> {
  if (typeof payload.waiting !== "number" || !Array.isArray(payload.digest)) {
    await markFailed(row, "nothing_to_send");
    return "failed";
  }
  const result = await sendMail({
    purpose: "issue_alert",
    ...buildIssueDigest(payload.waiting, payload.digest),
    idempotencyKey: `issue-digest-${payload.day}-${row.id}-${row.createdAt.getTime()}`,
  });
  if (!result.ok) {
    await markRetry(row, `${result.reason}${result.detail ? `: ${result.detail}` : ""}`);
    return "retry";
  }
  await markSent(row, result.providerMessageId, payload);
  if (payload.day) {
    await db
      .execute(sql`update issue_digest_runs set sent_at = now() where day = ${payload.day}::date and sent_at is null`)
      .catch((err) => logger.error({ err: safeError(err), outboxId: row.id }, "issue digest: sent_at not recorded"));
  }
  return "sent";
}

async function processRow(row: MailOutboxRow): Promise<"sent" | "retry" | "failed"> {
  try {
    if ((KEEP_SAFE_OUTBOX_PURPOSES as readonly string[]).includes(row.purpose)) {
      return await processKeepSafe(row, row.purpose as KeepSafeMail);
    }
    // SYC-53 PR 1.1: invitations and access-change notices (personOutbox.ts).
    if ((PERSON_OUTBOX_PURPOSES as readonly string[]).includes(row.purpose)) {
      return await processPersonMail(row);
    }
    if ((REPORTER_PURPOSES as readonly string[]).includes(row.purpose)) {
      return await processReporterMail(row, { markSent, markRetry });
    }
    if (row.purpose === "issue_alert") {
      return await processIssueAlert(row);
    }
    if (row.purpose === "welfare_alert" && (row.payload as Payload | null)?.kind === UNCHECKED_WAITING) {
      return await processUncheckedWaiting(row);
    }
    if (row.purpose !== "welfare_alert" || row.reportId === null) {
      await markFailed(row, row.reportId === null ? "report_gone" : "unknown_purpose");
      return "failed";
    }
    const payload = (row.payload ?? {}) as Payload;
    const kind: AlertKind = payload.kind === "photo" ? "photo" : "alert";
    const [report] = await db
      .select()
      .from(welfareReportsTable)
      .where(eq(welfareReportsTable.id, row.reportId));
    if (!report) {
      await markFailed(row, "report_gone");
      return "failed";
    }
    // SYC-44 PR 4.1: a welfare alert is only ever built for a welfare report.
    // A "Report an issue" row has no position and its own `issue_alert`
    // email; if one is ever queued as a welfare alert it is given up, never
    // sent with the welfare copy.
    if (report.kind !== "welfare" || report.lat === null || report.lng === null) {
      await markFailed(row, "wrong_kind");
      return "failed";
    }
    const [photo] = await db
      .select({ bytes: welfareReportPhotosTable.bytes, mime: welfareReportPhotosTable.mime })
      .from(welfareReportPhotosTable)
      .where(eq(welfareReportPhotosTable.reportId, report.id));

    if (kind === "photo") {
      // If the main alert already carried the photo, the follow-up is moot.
      const [main] = await db
        .select({ payload: mailOutboxTable.payload })
        .from(mailOutboxTable)
        .where(
          and(
            eq(mailOutboxTable.reportId, report.id),
            sql`${mailOutboxTable.payload}->>'kind' = 'alert'`,
          ),
        );
      if ((main?.payload as Payload | undefined)?.photoIncluded || !photo) {
        await markSent(row, null, { ...payload, photoIncluded: Boolean(photo) });
        return "sent";
      }
    }

    // Map links go in only when the position is NOT within 50 m of a feeding
    // site (SYC-245, SYC-209 Decision 2B). If the check fails or takes longer
    // than 2 s the alert still goes, without links: an urgent alert is never
    // held up, and a failure never adds a link. The email says nothing about
    // why. The decision is made once and stored on the row, so a retry after
    // a lost response sends the same body (Resend refuses a reused
    // idempotency key whose body changed).
    let withMapLinks: boolean;
    if (typeof payload.withMapLinks === "boolean") {
      withMapLinks = payload.withMapLinks;
    } else {
      withMapLinks = false;
      try {
        withMapLinks = !(await withCheckTimeout(isNearFeedingSite(report.lat, report.lng)));
      } catch (err) {
        logger.error({ err: safeError(err) }, "feeding-site check failed; alert sent without map links");
      }
      payload.withMapLinks = withMapLinks;
      await db
        .update(mailOutboxTable)
        .set({ payload: { ...payload, kind } })
        .where(eq(mailOutboxTable.id, row.id));
    }
    const message = buildWelfareAlert(report, photo ?? null, kind, withMapLinks);
    // The recipient is WELFARE_ALERT_TO, resolved inside sendMail.
    const result = await sendMail({
      purpose: "welfare_alert",
      ...message,
      // Resend keeps idempotency keys for 24 hours: a retry after a lost
      // response can't produce a second email. The key includes whether the
      // photo is attached, because Resend refuses a reused key whose message
      // has changed, and the photo can arrive between two attempts. It names
      // the report too, so a reset table's reused row ids can't collide.
      idempotencyKey: `welfare-${report.publicId}-${row.id}-${photo ? "photo" : "nophoto"}`,
    });
    if (!result.ok) {
      await markRetry(row, `${result.reason}${result.detail ? `: ${result.detail}` : ""}`);
      return "retry";
    }
    await markSent(row, result.providerMessageId, { ...payload, kind, photoIncluded: Boolean(photo) });
    return "sent";
  } catch (err) {
    // Name and codes only: a database error message carries query params (review S1).
    await markRetry(row, JSON.stringify(safeError(err))).catch(() => undefined);
    return "retry";
  }
}

export type DrainResult = { claimed: number; sent: number; retry: number; failed: number; shed: number };

/**
 * Emails that actually went out today (UTC day, Resend's), for the shedding
 * budget. Rows marked sent with nothing sent (no provider id) don't count.
 */
async function sentToday(): Promise<number> {
  const result = await db.execute(sql`
    select count(*)::int as n from mail_outbox
     where state = 'sent'
       and provider_message_id is not null
       and sent_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
  `);
  return Number((result.rows[0] as { n: number } | undefined)?.n ?? 0);
}

/**
 * Drop a sheddable email: failed with the reason `shed`, which the queue's
 * mail-failure banner does not count (it isn't a fault, it's the budget doing
 * its job; the dashboard still shows the report itself).
 */
async function markShed(row: MailOutboxRow) {
  await db
    .update(mailOutboxTable)
    .set({ state: "failed", lastError: SHED })
    .where(eq(mailOutboxTable.id, row.id));
  logger.warn({ outboxId: row.id, purpose: row.purpose }, "mail outbox: shed (daily budget reached)");
}

/** Send up to `limit` due rows. Safe to call from several servers at once. */
export async function drainDue(limit: number, onlyId?: number): Promise<DrainResult> {
  const rows = await claimDue(limit, onlyId);
  const out: DrainResult = { claimed: rows.length, sent: 0, retry: 0, failed: 0, shed: 0 };
  // Counted lazily, once per drain, and only when a sheddable row is in the
  // batch; then kept up to date as this batch sends.
  let sent: number | null = null;
  for (const row of rows) {
    if (isSheddable(row.purpose)) {
      sent ??= await sentToday();
      if (sent >= shedThreshold()) {
        await markShed(row);
        out.shed += 1;
        continue;
      }
    }
    const outcome = await processRow(row);
    out[outcome] += 1;
    if (outcome === "sent" && sent !== null) sent += 1;
  }
  return out;
}

/** Welfare alerts still unsent an hour after they were queued. */
export async function overdueWelfareAlerts(): Promise<number> {
  const result = await db.execute(sql`
    select count(*)::int as n from mail_outbox
     where purpose = 'welfare_alert'
       and state in ('queued', 'sending')
       and created_at < now() - make_interval(mins => ${OVERDUE_MINUTES})
  `);
  return Number((result.rows[0] as { n: number } | undefined)?.n ?? 0);
}

// ── Layer 1 and 2: try now, without blocking the response ──────────────────

const inFlight = new Set<Promise<unknown>>();

/** Fire-and-forget a small drain; failures are logged, never thrown. */
export function kick(limit = 2): void {
  const p = drainDue(limit)
    .catch((err) => logger.error({ err }, "mail outbox: drain after commit failed"))
    .finally(() => inFlight.delete(p));
  inFlight.add(p);
}

/** Send one row now (a keep-safe email, right after its request commits). */
export function kickRow(id: number): void {
  const p = drainDue(1, id)
    .catch((err) => logger.error({ err: safeError(err) }, "mail outbox: immediate send failed"))
    .finally(() => inFlight.delete(p));
  inFlight.add(p);
}

/**
 * Clear the address and tokens from keep-safe rows whose link has expired but
 * that no drain has settled (the sweep calls this).
 */
export async function clearExpiredKeepSafePayloads(): Promise<number> {
  const result = await db.execute(sql`
    update mail_outbox
       set state = case when state = 'sent' then state else 'failed' end,
           last_error = case when state = 'sent' then last_error else 'token_expired' end,
           payload = jsonb_build_object('expiresAt', payload->>'expiresAt', 'cleared', true)
     where purpose in ('keep_safe_verify', 'restore_link')
       and (payload ? 'to' or payload ? 'token' or payload ? 'forgetToken')
       and (payload->>'expiresAt')::timestamptz <= now()
  `);
  return result.rowCount ?? 0;
}

/** Tests: wait for every kicked drain to finish. */
export async function settleOutbox(): Promise<void> {
  while (inFlight.size) await Promise.allSettled([...inFlight]);
}

let lastOpportunistic = 0;
const OPPORTUNISTIC_EVERY_MS = 15_000;

function opportunisticEnabled(): boolean {
  const flag = process.env["MAIL_DRAIN_ON_REQUEST"];
  if (flag === "off") return false;
  if (flag === "on") return true;
  return process.env["NODE_ENV"] !== "test";
}

/** Express middleware: after any API response, check for due rows (layer 2). */
export function opportunisticDrain(
  _req: unknown,
  res: { on(event: "finish", cb: () => void): unknown },
  next: () => void,
): void {
  if (opportunisticEnabled()) {
    res.on("finish", () => {
      const now = Date.now();
      if (now - lastOpportunistic < OPPORTUNISTIC_EVERY_MS) return;
      lastOpportunistic = now;
      kick(2);
    });
  }
  next();
}
