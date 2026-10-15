import {
  catsTable,
  db,
  mailOutboxTable,
  peopleTable,
  welfareReportPhotosTable,
  welfareReportsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { OVERDUE_MINUTES } from "./mail/outbox";
import { logger, safeError } from "./logger";
import { pointsNearFeedingSite, withCheckTimeout } from "./feedingSiteProximity";

/**
 * The welfare queue's data (SYC-43 part 2 plan, PR 1; spec §3.1, §4.2).
 * One function feeds both the dashboard page and GET /api/team/reports.
 *
 * What never leaves this file: the reporter's device id and the reporter's
 * contact id (spec §3.1: the reporter's address is never on the queue), and
 * the bytes of a photo. A report's photo is only ever a URL under
 * /api/team/report-photos/ (spec §4.3). So those columns are not selected,
 * and QUEUE_COLUMNS is exported so a test can pin that.
 */

export const TEAM_REPORT_PHOTO_PREFIX = "/api/team/report-photos/";
const CLOSED_LIMIT = 50;
const DRAFT_LIMIT = 50;
export const UNCHECKED_LIMIT = 50;
const CLOSED_STATES = ["done", "nothing_needed"] as const;
const OPEN_STATES = ["new", "looking"] as const;

const changedBy = alias(peopleTable, "changed_by_person");
const notedBy = alias(peopleTable, "noted_by_person");

/** Exactly what the queue reads from welfare_reports. */
export const QUEUE_COLUMNS = {
  publicId: welfareReportsTable.publicId,
  severity: welfareReportsTable.severity,
  isLitter: welfareReportsTable.isLitter,
  lat: welfareReportsTable.lat,
  lng: welfareReportsTable.lng,
  note: welfareReportsTable.note,
  state: welfareReportsTable.state,
  stateChangedAt: welfareReportsTable.stateChangedAt,
  teamNote: welfareReportsTable.teamNote,
  teamNoteAt: welfareReportsTable.teamNoteAt,
  photoState: welfareReportsTable.photoState,
  catId: welfareReportsTable.catId,
  submittedAt: welfareReportsTable.submittedAt,
  createdAt: welfareReportsTable.createdAt,
  tokenChecked: welfareReportsTable.tokenChecked,
  id: welfareReportsTable.id,
};

const SELECT = {
  ...QUEUE_COLUMNS,
  photoPublicId: welfareReportPhotosTable.publicId,
  catName: catsTable.name,
  changedByName: changedBy.name,
  changedByLeftAt: changedBy.leftAt,
  notedByName: notedBy.name,
  notedByLeftAt: notedBy.leftAt,
};

export type PhotoStatus = "attached" | "pending" | "none" | "failed";
export type EmailToTeam = "sent" | "waiting" | "failed";

export interface TeamPerson {
  name: string;
  left: boolean;
}

export interface QueueReport {
  /** The report's public id: the only id that ever leaves the server. */
  id: string;
  severity: "attention" | "urgent";
  isLitter: boolean;
  lat: number;
  lng: number;
  /** When the report was sent (falls back to when its row was made). */
  at: string;
  note: string | null;
  state: "new" | "looking" | "done" | "nothing_needed";
  stateChangedAt: string | null;
  stateChangedBy: TeamPerson | null;
  photo: { status: PhotoStatus; url: string | null };
  /** The cat the team tied this report to (SYC-43 part 2, PR 5), or null. */
  cat: { id: number; name: string } | null;
  /** Always false until SYC-42 Slice 3 (the address is never shown). */
  contactLeft: false;
  teamNote: string | null;
  teamNoteAt: string | null;
  teamNoteBy: TeamPerson | null;
  /** The alert email to Syros Cats; null when no alert is on record. */
  emailToTeam: EmailToTeam | null;
  /**
   * SYC-170: accepted while Cloudflare's check was unreachable. Open ones sit
   * in `unchecked`, never in `open`; a closed one is in `closed`, marked.
   */
  unchecked: boolean;
}

export interface QueueDraft {
  id: string;
  severity: "attention" | "urgent";
  lat: number;
  lng: number;
  startedAt: string;
}

export interface MailHealth {
  /**
   * Alerts the mail system gave up on, for reports still open. Once a report
   * is closed the team has dealt with it, so its old failure no longer keeps
   * the banner up.
   */
  failed: number;
  /** Alerts still unsent an hour after they were queued. */
  late: number;
}

export interface WelfareQueue {
  open: QueueReport[];
  closed: QueueReport[];
  /** How many closed reports exist; `closed` holds the newest few. */
  closedTotal: number;
  drafts: QueueDraft[];
  /** How many drafts exist; `drafts` holds the newest few. */
  draftsTotal: number;
  /**
   * SYC-170 (spec §9.5, §5.3): reports and drafts accepted while Cloudflare
   * was unreachable. Their own list, below every checked report and never in
   * the urgent-first order; newest first. Should be empty almost always, so
   * its count is an early sign the check is broken.
   */
  unchecked: {
    /** The newest 50 open unchecked reports (review of #151, finding 6). */
    reports: QueueReport[];
    /** How many open unchecked reports there are. */
    reportsTotal: number;
    drafts: QueueDraft[];
    draftsTotal: number;
  };
  mail: MailHealth;
}

const person = (name: string | null, leftAt: Date | null): TeamPerson | null =>
  name === null ? null : { name, left: leftAt !== null };

function emailState(states: string[]): EmailToTeam | null {
  if (!states.length) return null;
  if (states.includes("failed")) return "failed";
  if (states.some((s) => s === "queued" || s === "sending")) return "waiting";
  return "sent";
}

type Row = Awaited<ReturnType<typeof reportsQuery>>[number];

function toReport(r: Row, mail: Map<number, string[]>): QueueReport {
  const status = r.photoState as PhotoStatus;
  const hasPhoto = status === "attached" && r.photoPublicId !== null;
  return {
    id: r.publicId,
    severity: r.severity as QueueReport["severity"],
    isLitter: r.isLitter,
    lat: r.lat,
    lng: r.lng,
    at: (r.submittedAt ?? r.createdAt).toISOString(),
    note: r.note,
    state: r.state as QueueReport["state"],
    stateChangedAt: r.stateChangedAt?.toISOString() ?? null,
    stateChangedBy: person(r.changedByName, r.changedByLeftAt),
    photo: {
      status: hasPhoto ? "attached" : status === "attached" ? "none" : status,
      url: hasPhoto ? `${TEAM_REPORT_PHOTO_PREFIX}${r.photoPublicId}` : null,
    },
    cat: r.catId !== null && r.catName !== null ? { id: r.catId, name: r.catName } : null,
    contactLeft: false,
    teamNote: r.teamNote,
    teamNoteAt: r.teamNoteAt?.toISOString() ?? null,
    teamNoteBy: person(r.notedByName, r.notedByLeftAt),
    emailToTeam: emailState(mail.get(r.id) ?? []),
    unchecked: r.tokenChecked === false,
  };
}

const reportTime = sql`coalesce(${welfareReportsTable.submittedAt}, ${welfareReportsTable.createdAt})`;

function reportsQuery() {
  return db
    .select(SELECT)
    .from(welfareReportsTable)
    .leftJoin(
      welfareReportPhotosTable,
      eq(welfareReportPhotosTable.reportId, welfareReportsTable.id),
    )
    .leftJoin(catsTable, eq(catsTable.id, welfareReportsTable.catId))
    .leftJoin(changedBy, eq(changedBy.id, welfareReportsTable.stateChangedBy))
    .leftJoin(notedBy, eq(notedBy.id, welfareReportsTable.teamNoteBy));
}

export async function mailHealth(): Promise<MailHealth> {
  const result = await db.execute(sql`
    select
      count(*) filter (
        where state = 'failed'
          and (
            exists (
              select 1 from welfare_reports r
              where r.id = mail_outbox.report_id
                and r.is_draft = false
                and r.state in ('new', 'looking')
            )
            -- SYC-170: the "N unchecked reports waiting" email has no report
            -- row of its own, so a failed one counts by its kind (review of
            -- #151, finding 8).
            or (mail_outbox.report_id is null and mail_outbox.payload->>'kind' = 'unchecked_waiting')
          )
      )::int as failed,
      count(*) filter (
        where state in ('queued', 'sending')
          and created_at < now() - make_interval(mins => ${OVERDUE_MINUTES})
      )::int as late
    from mail_outbox
    where purpose = 'welfare_alert'
  `);
  const row = result.rows[0] as { failed: number; late: number } | undefined;
  return { failed: Number(row?.failed ?? 0), late: Number(row?.late ?? 0) };
}

/** The alert emails' states for these reports, keyed by report row id. */
async function mailStatesFor(ids: number[]): Promise<Map<number, string[]>> {
  const mailByReport = new Map<number, string[]>();
  if (!ids.length) return mailByReport;
  const mailRows = await db
    .select({
      reportId: mailOutboxTable.reportId,
      state: mailOutboxTable.state,
    })
    .from(mailOutboxTable)
    .where(
      and(
        eq(mailOutboxTable.purpose, "welfare_alert"),
        inArray(mailOutboxTable.reportId, ids),
      ),
    );
  for (const m of mailRows) {
    if (m.reportId === null) continue;
    mailByReport.set(m.reportId, [
      ...(mailByReport.get(m.reportId) ?? []),
      m.state,
    ]);
  }
  return mailByReport;
}

/**
 * One sent report, as the queue shows it (the new row, for the state and note
 * routes' JSON answers). Null for an unknown id or a draft.
 */
export async function getQueueReport(
  publicId: string,
): Promise<QueueReport | null> {
  const [row] = await reportsQuery().where(
    and(
      eq(welfareReportsTable.publicId, publicId),
      eq(welfareReportsTable.isDraft, false),
    ),
  );
  if (!row) return null;
  return toReport(row, await mailStatesFor([row.id]));
}

/**
 * Sent reports, urgent first and then newest; the closed ones below, newest
 * first; the drafts apart (spec §3.1, §4.2). Never throws on mail trouble:
 * a failing mail system is reported in `mail`, not by hiding the queue.
 */
export async function listWelfareQueue(): Promise<WelfareQueue> {
  const sent = eq(welfareReportsTable.isDraft, false);
  const draft = eq(welfareReportsTable.isDraft, true);
  // null (before Turnstile) and true are both "checked" for the queue.
  const checked = sql`${welfareReportsTable.tokenChecked} is distinct from false`;
  const unchecked = sql`${welfareReportsTable.tokenChecked} = false`;
  const isOpen = inArray(welfareReportsTable.state, [...OPEN_STATES]);
  const draftColumns = {
    publicId: welfareReportsTable.publicId,
    severity: welfareReportsTable.severity,
    lat: welfareReportsTable.lat,
    lng: welfareReportsTable.lng,
    createdAt: welfareReportsTable.createdAt,
  };
  const [
    openRows,
    closedRows,
    closedCount,
    draftRows,
    draftCount,
    uncheckedRows,
    uncheckedCount,
    uncheckedDraftRows,
    uncheckedDraftCount,
    mail,
  ] =
    await Promise.all([
      reportsQuery()
        .where(and(sent, isOpen, checked))
        .orderBy(
          desc(sql`(${welfareReportsTable.severity} = 'urgent')`),
          desc(reportTime),
          desc(welfareReportsTable.id),
        ),
      reportsQuery()
        .where(
          and(sent, inArray(welfareReportsTable.state, [...CLOSED_STATES])),
        )
        .orderBy(desc(reportTime), desc(welfareReportsTable.id))
        .limit(CLOSED_LIMIT),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(welfareReportsTable)
        .where(
          and(sent, inArray(welfareReportsTable.state, [...CLOSED_STATES])),
        ),
      db
        .select(draftColumns)
        .from(welfareReportsTable)
        .where(and(draft, checked))
        .orderBy(
          desc(welfareReportsTable.createdAt),
          desc(welfareReportsTable.id),
        )
        .limit(DRAFT_LIMIT),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(welfareReportsTable)
        .where(and(draft, checked)),
      // Unchecked: newest first, urgent or not (never the urgent-first order).
      reportsQuery()
        .where(and(sent, isOpen, unchecked))
        .orderBy(desc(reportTime), desc(welfareReportsTable.id))
        .limit(UNCHECKED_LIMIT),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(welfareReportsTable)
        .where(and(sent, isOpen, unchecked)),
      db
        .select(draftColumns)
        .from(welfareReportsTable)
        .where(and(draft, unchecked))
        .orderBy(
          desc(welfareReportsTable.createdAt),
          desc(welfareReportsTable.id),
        )
        .limit(DRAFT_LIMIT),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(welfareReportsTable)
        .where(and(draft, unchecked)),
      mailHealth(),
    ]);

  const mailByReport = await mailStatesFor(
    [...openRows, ...closedRows, ...uncheckedRows].map((r) => r.id),
  );
  const toDraft = (d: (typeof draftRows)[number]): QueueDraft => ({
    id: d.publicId,
    severity: d.severity as QueueDraft["severity"],
    lat: d.lat,
    lng: d.lng,
    startedAt: d.createdAt.toISOString(),
  });

  return {
    open: openRows.map((r) => toReport(r, mailByReport)),
    closed: closedRows.map((r) => toReport(r, mailByReport)),
    closedTotal: Number(closedCount[0]?.n ?? 0),
    drafts: draftRows.map(toDraft),
    draftsTotal: Number(draftCount[0]?.n ?? 0),
    unchecked: {
      reports: uncheckedRows.map((r) => toReport(r, mailByReport)),
      reportsTotal: Number(uncheckedCount[0]?.n ?? 0),
      drafts: uncheckedDraftRows.map(toDraft),
      draftsTotal: Number(uncheckedDraftCount[0]?.n ?? 0),
    },
    mail,
  };
}

/**
 * Which of the queue's reports and drafts (by public id) are within 50 m of a
 * feeding site, in ONE query (SYC-245, SYC-209 Decision 2B). The page shows no
 * map link for these. Null when the check fails: the page then shows no link
 * for any of them, because a failed check must never add a link.
 */
export async function queueNearFeedingSites(
  queue: WelfareQueue,
): Promise<Set<string> | null> {
  try {
    return await withCheckTimeout(
      pointsNearFeedingSite(
        [
          ...queue.open,
          ...queue.closed,
          ...queue.drafts,
          ...(queue.unchecked?.reports ?? []),
          ...(queue.unchecked?.drafts ?? []),
        ].map((r) => ({
          key: r.id,
          lat: r.lat,
          lng: r.lng,
        })),
      ),
    );
  } catch (err) {
    logger.error({ err: safeError(err) }, "feeding-site check failed for the queue");
    return null;
  }
}
