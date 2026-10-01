import {
  db,
  mailOutboxTable,
  welfareReportPhotosTable,
  welfareReportsTable,
  type MailOutboxRow,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../logger";
import { buildWelfareAlert, type AlertKind } from "../welfare/alertEmail";
import { hashRecipient, sendMail } from "./send";

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
 * Retries back off 1, 5, 15, 60 minutes, then hourly, forever. If any
 * welfare alert is still unsent an hour after it was queued, the drain call
 * fails, and GitHub emails Samuel about the failed run: a delivery path that
 * doesn't depend on Resend. That is about the system being broken, not about
 * a cat, and it pages nobody (F1).
 *
 * Rows are claimed with `FOR UPDATE SKIP LOCKED`, so two servers (or two
 * drains) never send the same alert. A claimed row holds a 5-minute lease in
 * `next_attempt_at`; if its server dies mid-send, the row is reclaimed after
 * that.
 */

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

type Payload = { kind?: AlertKind; photoIncluded?: boolean };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

async function claimDue(limit: number): Promise<MailOutboxRow[]> {
  const result = await db.execute(sql`
    update mail_outbox
       set state = 'sending',
           attempts = attempts + 1,
           next_attempt_at = now() + ${LEASE}
     where id in (
       select id from mail_outbox
        where state in ('queued', 'sending')
          and next_attempt_at <= now()
        order by next_attempt_at
        limit ${limit}
        for update skip locked
     )
    returning id
  `);
  const ids = (result.rows as { id: number }[]).map((r) => r.id);
  if (!ids.length) return [];
  return db
    .select()
    .from(mailOutboxTable)
    .where(sql`${mailOutboxTable.id} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
}

async function markSent(row: MailOutboxRow, providerMessageId: string | null, payload: Payload) {
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

async function processRow(row: MailOutboxRow): Promise<"sent" | "retry" | "failed"> {
  try {
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

    const message = buildWelfareAlert(report, photo ?? null, kind);
    const result = await sendMail({
      purpose: "welfare_alert",
      to: alertRecipient(),
      ...message,
      // Resend keeps idempotency keys for 24 hours: a retry after a lost
      // response can't produce a second email. The key includes whether the
      // photo is attached, because Resend refuses a reused key whose message
      // has changed, and the photo can arrive between two attempts.
      idempotencyKey: `welfare-outbox-${row.id}-${photo ? "photo" : "nophoto"}`,
    });
    if (!result.ok) {
      await markRetry(row, `${result.reason}${result.detail ? `: ${result.detail}` : ""}`);
      return "retry";
    }
    await markSent(row, result.providerMessageId, { ...payload, kind, photoIncluded: Boolean(photo) });
    return "sent";
  } catch (err) {
    await markRetry(row, String(err)).catch(() => undefined);
    return "retry";
  }
}

export type DrainResult = { claimed: number; sent: number; retry: number; failed: number };

/** Send up to `limit` due rows. Safe to call from several servers at once. */
export async function drainDue(limit: number): Promise<DrainResult> {
  const rows = await claimDue(limit);
  const out: DrainResult = { claimed: rows.length, sent: 0, retry: 0, failed: 0 };
  for (const row of rows) {
    out[await processRow(row)] += 1;
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
