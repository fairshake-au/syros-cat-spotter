import {
  db,
  mailOutboxTable,
  peopleTable,
  welfareReportPhotosTable,
  welfareReportsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { OVERDUE_MINUTES } from "./mail/outbox";

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
  submittedAt: welfareReportsTable.submittedAt,
  createdAt: welfareReportsTable.createdAt,
  id: welfareReportsTable.id,
};

const SELECT = {
  ...QUEUE_COLUMNS,
  photoPublicId: welfareReportPhotosTable.publicId,
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
  /** Always false until SYC-42 Slice 3 (the address is never shown). */
  contactLeft: false;
  teamNote: string | null;
  teamNoteAt: string | null;
  teamNoteBy: TeamPerson | null;
  /** The alert email to Syros Cats; null when no alert is on record. */
  emailToTeam: EmailToTeam | null;
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
    contactLeft: false,
    teamNote: r.teamNote,
    teamNoteAt: r.teamNoteAt?.toISOString() ?? null,
    teamNoteBy: person(r.notedByName, r.notedByLeftAt),
    emailToTeam: emailState(mail.get(r.id) ?? []),
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
    .leftJoin(changedBy, eq(changedBy.id, welfareReportsTable.stateChangedBy))
    .leftJoin(notedBy, eq(notedBy.id, welfareReportsTable.teamNoteBy));
}

export async function mailHealth(): Promise<MailHealth> {
  const result = await db.execute(sql`
    select
      count(*) filter (
        where state = 'failed'
          and exists (
            select 1 from welfare_reports r
            where r.id = mail_outbox.report_id
              and r.is_draft = false
              and r.state in ('new', 'looking')
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
  const [openRows, closedRows, closedCount, draftRows, draftCount, mail] =
    await Promise.all([
      reportsQuery()
        .where(and(sent, inArray(welfareReportsTable.state, [...OPEN_STATES])))
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
        .select({
          publicId: welfareReportsTable.publicId,
          severity: welfareReportsTable.severity,
          lat: welfareReportsTable.lat,
          lng: welfareReportsTable.lng,
          createdAt: welfareReportsTable.createdAt,
        })
        .from(welfareReportsTable)
        .where(eq(welfareReportsTable.isDraft, true))
        .orderBy(
          desc(welfareReportsTable.createdAt),
          desc(welfareReportsTable.id),
        )
        .limit(DRAFT_LIMIT),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(welfareReportsTable)
        .where(eq(welfareReportsTable.isDraft, true)),
      mailHealth(),
    ]);

  const mailByReport = await mailStatesFor(
    [...openRows, ...closedRows].map((r) => r.id),
  );

  return {
    open: openRows.map((r) => toReport(r, mailByReport)),
    closed: closedRows.map((r) => toReport(r, mailByReport)),
    closedTotal: Number(closedCount[0]?.n ?? 0),
    drafts: draftRows.map((d) => ({
      id: d.publicId,
      severity: d.severity as QueueDraft["severity"],
      lat: d.lat,
      lng: d.lng,
      startedAt: d.createdAt.toISOString(),
    })),
    draftsTotal: Number(draftCount[0]?.n ?? 0),
    mail,
  };
}
