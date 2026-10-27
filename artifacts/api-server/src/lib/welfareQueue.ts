import {
  catsTable,
  db,
  peopleTable,
  photosTable,
  welfareReportPhotosTable,
  welfareReportsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { OVERDUE_MINUTES } from "./mail/outbox";
import { teamPhotoUrl } from "./teamCatView";
import { reporterOnClose, type ReporterOnClose } from "./welfare/reporterEmail";

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
// SYC-504: the cat whose page the reporter sent the report from
// (`reporter_cat_id`), joined apart from `cat` (the cat the team tied it to).
const suggestedCat = alias(catsTable, "suggested_cat");
const suggestedCatPhoto = alias(photosTable, "suggested_cat_photo");

/** What the queue reads about a suggested cat, for both reports and drafts. */
const SUGGESTED_CAT = {
  suggestedCatId: suggestedCat.id,
  suggestedCatName: suggestedCat.name,
  suggestedCatPhotoPublicId: suggestedCatPhoto.publicId,
};

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
  ...SUGGESTED_CAT,
  changedByName: changedBy.name,
  changedByLeftAt: changedBy.leftAt,
  notedByName: notedBy.name,
  notedByLeftAt: notedBy.leftAt,
};

export type PhotoStatus = "attached" | "pending" | "none" | "failed";
/**
 * `delivered` / `bounced` come from Resend's webhook (mail_deliveries, SYC-42
 * Slice 3 item 3.6); until it reports, an accepted email is `sent`.
 */
export type EmailToTeam = "sent" | "delivered" | "bounced" | "waiting" | "failed";
/**
 * The reporter's emails (SYC-42 Slice 3), never their address: `unconfirmed`
 * means they left an address but haven't confirmed it, so nothing but the
 * one "is this you?" can go. Otherwise the latest acknowledgement or outcome.
 */
export type EmailToReporter = "unconfirmed" | "confirmed" | "waiting" | "sent" | "delivered" | "bounced" | "failed";

export interface TeamPerson {
  name: string;
  left: boolean;
}

/**
 * SYC-504: the cat whose page the reporter sent this from. Only a suggestion;
 * the team's tie is what sets `cat`. `photoUrl` is the small team-route
 * photo, as the cat search gives it.
 */
export interface SuggestedCat {
  id: number;
  name: string;
  photoUrl: string | null;
}

function suggestedCatOf(r: {
  suggestedCatId: number | null;
  suggestedCatName: string | null;
  suggestedCatPhotoPublicId: string | null;
}): SuggestedCat | null {
  if (r.suggestedCatId === null || r.suggestedCatName === null) return null;
  return {
    id: r.suggestedCatId,
    name: r.suggestedCatName,
    photoUrl: r.suggestedCatPhotoPublicId
      ? `${teamPhotoUrl(r.suggestedCatPhotoPublicId)}/small`
      : null,
  };
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
  /** The cat whose page the reporter sent it from (SYC-504), or null. */
  suggestedCat: SuggestedCat | null;
  /** The reporter left an email address (never shown: spec §3.1). */
  contactLeft: boolean;
  /** What happened to the reporter's emails; null when they left no address. */
  emailToReporter: EmailToReporter | null;
  /**
   * SYC-515: what happens to the reporter if this closes. Only when asked
   * for (`{ onClose: true }`): the JSON routes show it, the pages don't, so
   * the Queue and Home never work it out.
   */
  onClose?: ReporterOnClose;
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
  /** The cat whose page the reporter began it from (SYC-504), or null. */
  suggestedCat: SuggestedCat | null;
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

type MailRow = { state: string; delivery: string | null };

function emailState(rows: MailRow[]): EmailToTeam | null {
  if (!rows.length) return null;
  if (rows.some((r) => r.state === "failed")) return "failed";
  if (rows.some((r) => r.state === "queued" || r.state === "sending")) return "waiting";
  if (rows.some((r) => r.delivery === "bounced" || r.delivery === "complained")) return "bounced";
  if (rows.every((r) => r.delivery === "delivered")) return "delivered";
  return "sent";
}

/** What the queue knows about one report's mail: never an address. */
export type ReportMail = {
  team: MailRow[];
  contact: "unconfirmed" | "confirmed" | null;
  /** The latest acknowledgement or outcome, if any. */
  reporter: MailRow | null;
};

function reporterState(m: ReportMail | undefined): EmailToReporter | null {
  if (!m?.contact) return null;
  if (m.contact === "unconfirmed") return "unconfirmed";
  // Confirmed, with nothing of its own to send (its acknowledgement was
  // within another report's 24 hours): not "waiting" (review of #181, finding 6).
  if (!m.reporter) return "confirmed";
  const r = m.reporter;
  if (r.state === "failed") return "failed";
  if (r.state === "queued" || r.state === "sending") return "waiting";
  if (r.delivery === "bounced" || r.delivery === "complained") return "bounced";
  if (r.delivery === "delivered") return "delivered";
  return "sent";
}

type Row = Awaited<ReturnType<typeof reportsQuery>>[number];

/**
 * SYC-515: each report's "what happens to the reporter if this closes?",
 * from the same function the state route uses. A report with no address on
 * file is "none" without asking.
 */
async function onCloseFor(
  ids: number[],
  mail: Map<number, ReportMail>,
): Promise<Map<number, ReporterOnClose>> {
  const out = new Map<number, ReporterOnClose>();
  await Promise.all(
    ids.map(async (id) => {
      out.set(id, mail.get(id)?.contact ? await reporterOnClose(db, id) : "none");
    }),
  );
  return out;
}

function toReport(r: Row, mail: Map<number, ReportMail>, onClose: ReporterOnClose | undefined): QueueReport {
  const status = r.photoState as PhotoStatus;
  const hasPhoto = status === "attached" && r.photoPublicId !== null;
  return {
    id: r.publicId,
    severity: r.severity as QueueReport["severity"],
    isLitter: r.isLitter,
    // Welfare rows always have a position (welfare_reports_position_ck); the
    // column is nullable only for "Report an issue" rows, filtered out above.
    lat: r.lat!,
    lng: r.lng!,
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
    suggestedCat: suggestedCatOf(r),
    contactLeft: Boolean(mail.get(r.id)?.contact),
    emailToReporter: reporterState(mail.get(r.id)),
    ...(onClose === undefined ? {} : { onClose }),
    teamNote: r.teamNote,
    teamNoteAt: r.teamNoteAt?.toISOString() ?? null,
    teamNoteBy: person(r.notedByName, r.notedByLeftAt),
    emailToTeam: emailState(mail.get(r.id)?.team ?? []),
    unchecked: r.tokenChecked === false,
  };
}

const reportTime = sql`coalesce(${welfareReportsTable.submittedAt}, ${welfareReportsTable.createdAt})`;

/**
 * SYC-44 PR 4.1: this queue is the "needs help" queue. A "Report an issue"
 * row (`kind = 'content'`) shares the table but never appears here; it gets
 * its own query in the Issues section. Every read below carries this.
 */
const isWelfare = eq(welfareReportsTable.kind, "welfare");

/** The queue's report rows, welfare kind only, narrowed by `where`. */
function reportsQuery(where: SQL | undefined) {
  return db
    .select(SELECT)
    .from(welfareReportsTable)
    .leftJoin(
      welfareReportPhotosTable,
      eq(welfareReportPhotosTable.reportId, welfareReportsTable.id),
    )
    .leftJoin(catsTable, eq(catsTable.id, welfareReportsTable.catId))
    .leftJoin(suggestedCat, eq(suggestedCat.id, welfareReportsTable.reporterCatId))
    .leftJoin(
      suggestedCatPhoto,
      // A photo removed for good gives no thumbnail, not a broken one.
      and(eq(suggestedCatPhoto.id, suggestedCat.primaryPhotoId), isNull(suggestedCatPhoto.removedAt)),
    )
    .leftJoin(changedBy, eq(changedBy.id, welfareReportsTable.stateChangedBy))
    .leftJoin(notedBy, eq(notedBy.id, welfareReportsTable.teamNoteBy))
    .where(and(isWelfare, where));
}

/** The report-photo types the team's report-photo route serves (routes/teamReports.ts IMAGE_TYPES). */
export const REPORT_PHOTO_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png"]);

/**
 * SYC-492: a sent welfare report's photo, read on the server for Find from a
 * photo's "Use the report's photo". The same rule as the Queue showing it
 * (a welfare report, never a draft or an issue, whose photo is marked
 * attached and is stored: toReport's `hasPhoto`) and as the team's
 * report-photo route serving it (a JPEG or PNG). Anything else is null, so
 * a photo the team can't see is never sent anywhere.
 */
export async function reportPhotoForFind(publicId: string): Promise<Buffer | null> {
  const [row] = await db
    .select({ bytes: welfareReportPhotosTable.bytes, mime: welfareReportPhotosTable.mime })
    .from(welfareReportsTable)
    .innerJoin(welfareReportPhotosTable, eq(welfareReportPhotosTable.reportId, welfareReportsTable.id))
    .where(
      and(
        isWelfare,
        eq(welfareReportsTable.publicId, publicId),
        eq(welfareReportsTable.isDraft, false),
        eq(welfareReportsTable.photoState, "attached"),
      ),
    );
  if (!row || !REPORT_PHOTO_TYPES.has(row.mime)) return null;
  return row.bytes;
}

/** The queue's draft rows, with the cat each was begun from (SYC-504). */
function draftsQuery(where: SQL | undefined) {
  return db
    .select({
      publicId: welfareReportsTable.publicId,
      severity: welfareReportsTable.severity,
      lat: welfareReportsTable.lat,
      lng: welfareReportsTable.lng,
      createdAt: welfareReportsTable.createdAt,
      ...SUGGESTED_CAT,
    })
    .from(welfareReportsTable)
    .leftJoin(suggestedCat, eq(suggestedCat.id, welfareReportsTable.reporterCatId))
    .leftJoin(
      suggestedCatPhoto,
      // A photo removed for good gives no thumbnail, not a broken one.
      and(eq(suggestedCatPhoto.id, suggestedCat.primaryPhotoId), isNull(suggestedCatPhoto.removedAt)),
    )
    .where(and(isWelfare, where));
}

export async function mailHealth(): Promise<MailHealth> {
  const result = await db.execute(sql`
    select
      count(*) filter (
        where state = 'failed'
          -- SYC-44 PR 5.2: a row the daily budget dropped is not a fault.
          and last_error is distinct from 'shed'
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
    where purpose in ('welfare_alert', 'issue_alert')
  `);
  const row = result.rows[0] as { failed: number; late: number } | undefined;
  return { failed: Number(row?.failed ?? 0), late: Number(row?.late ?? 0) };
}

/**
 * The alert emails' states for these reports, and the reporter's (contact
 * status and latest acknowledgement or outcome), keyed by report row id.
 * Delivery comes from mail_deliveries. Only states: no address, no contact id.
 */
async function mailStatesFor(ids: number[]): Promise<Map<number, ReportMail>> {
  const byReport = new Map<number, ReportMail>();
  if (!ids.length) return byReport;
  const get = (id: number) => {
    let m = byReport.get(id);
    if (!m) byReport.set(id, (m = { team: [], contact: null, reporter: null }));
    return m;
  };
  const list = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const mailRows = (
    await db.execute(sql`
      select m.report_id, m.purpose, m.state, d.state as delivery
        from mail_outbox m
        left join mail_deliveries d on d.provider_message_id = m.provider_message_id
       where m.report_id in (${list})
         and m.purpose in ('welfare_alert', 'report_ack', 'report_outcome')
       order by m.id
    `)
  ).rows as { report_id: number; purpose: string; state: string; delivery: string | null }[];
  for (const m of mailRows) {
    const row = { state: m.state, delivery: m.delivery };
    if (m.purpose === "welfare_alert") get(m.report_id).team.push(row);
    else get(m.report_id).reporter = row;
  }
  const contacts = (
    await db.execute(sql`
      select r.id, c.status from welfare_reports r
        join email_contacts c on c.id = r.reporter_contact_id
       where r.id in (${list})
    `)
  ).rows as { id: number; status: string }[];
  for (const c of contacts) get(c.id).contact = c.status === "confirmed" ? "confirmed" : "unconfirmed";
  return byReport;
}

/**
 * One sent report, as the queue shows it (the new row, for the state and note
 * routes' JSON answers). Null for an unknown id or a draft.
 */
export async function getQueueReport(
  publicId: string,
  opts: { onClose?: boolean } = {},
): Promise<QueueReport | null> {
  const [row] = await reportsQuery(
    and(
      eq(welfareReportsTable.publicId, publicId),
      eq(welfareReportsTable.isDraft, false),
    ),
  );
  if (!row) return null;
  const mail = await mailStatesFor([row.id]);
  const onClose = opts.onClose === true ? (await onCloseFor([row.id], mail)).get(row.id) : undefined;
  return toReport(row, mail, onClose);
}

/**
 * Sent reports, urgent first and then newest; the closed ones below, newest
 * first; the drafts apart (spec §3.1, §4.2). Never throws on mail trouble:
 * a failing mail system is reported in `mail`, not by hiding the queue.
 */
export async function listWelfareQueue(
  opts: {
    /**
     * Read the drafts too (the default). The Queue and Home pass false
     * (SYC-519, decision 519-B): they no longer show unfinished reports, so
     * the four draft queries are skipped. The JSON route keeps them.
     */
    drafts?: boolean;
    /**
     * Work out each report's `onClose` (a query per report with an address
     * on file). Only the JSON route asks; the Queue page and Home show it
     * nowhere, so they leave it off.
     */
    onClose?: boolean;
  } = {},
): Promise<WelfareQueue> {
  const withDrafts = opts.drafts !== false;
  const sent = eq(welfareReportsTable.isDraft, false);
  const draft = eq(welfareReportsTable.isDraft, true);
  // null (before Turnstile) and true are both "checked" for the queue.
  const checked = sql`${welfareReportsTable.tokenChecked} is distinct from false`;
  const unchecked = sql`${welfareReportsTable.tokenChecked} = false`;
  const isOpen = inArray(welfareReportsTable.state, [...OPEN_STATES]);
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
      reportsQuery(and(sent, isOpen, checked))
        .orderBy(
          desc(sql`(${welfareReportsTable.severity} = 'urgent')`),
          desc(reportTime),
          desc(welfareReportsTable.id),
        ),
      reportsQuery(
        and(sent, inArray(welfareReportsTable.state, [...CLOSED_STATES])),
      )
        .orderBy(desc(reportTime), desc(welfareReportsTable.id))
        .limit(CLOSED_LIMIT),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(welfareReportsTable)
        .where(
          and(
            isWelfare,
            sent,
            inArray(welfareReportsTable.state, [...CLOSED_STATES]),
          ),
        ),
      withDrafts
        ? draftsQuery(and(draft, checked))
            .orderBy(
              desc(welfareReportsTable.createdAt),
              desc(welfareReportsTable.id),
            )
            .limit(DRAFT_LIMIT)
        : Promise.resolve([]),
      withDrafts
        ? db
            .select({ n: sql<number>`count(*)::int` })
            .from(welfareReportsTable)
            .where(and(isWelfare, draft, checked))
        : Promise.resolve([{ n: 0 }]),
      // Unchecked: newest first, urgent or not (never the urgent-first order).
      reportsQuery(and(sent, isOpen, unchecked))
        .orderBy(desc(reportTime), desc(welfareReportsTable.id))
        .limit(UNCHECKED_LIMIT),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(welfareReportsTable)
        .where(and(isWelfare, sent, isOpen, unchecked)),
      withDrafts
        ? draftsQuery(and(draft, unchecked))
            .orderBy(
              desc(welfareReportsTable.createdAt),
              desc(welfareReportsTable.id),
            )
            .limit(DRAFT_LIMIT)
        : Promise.resolve([]),
      withDrafts
        ? db
            .select({ n: sql<number>`count(*)::int` })
            .from(welfareReportsTable)
            .where(and(isWelfare, draft, unchecked))
        : Promise.resolve([{ n: 0 }]),
      mailHealth(),
    ]);

  const mailByReport = await mailStatesFor(
    [...openRows, ...closedRows, ...uncheckedRows].map((r) => r.id),
  );
  const onClose =
    opts.onClose === true
      ? await onCloseFor([...openRows, ...closedRows, ...uncheckedRows].map((r) => r.id), mailByReport)
      : new Map<number, ReporterOnClose>();
  const toDraft = (d: (typeof draftRows)[number]): QueueDraft => ({
    id: d.publicId,
    severity: d.severity as QueueDraft["severity"],
    lat: d.lat!,
    lng: d.lng!,
    startedAt: d.createdAt.toISOString(),
    suggestedCat: suggestedCatOf(d),
  });

  return {
    open: openRows.map((r) => toReport(r, mailByReport, onClose.get(r.id))),
    closed: closedRows.map((r) => toReport(r, mailByReport, onClose.get(r.id))),
    closedTotal: Number(closedCount[0]?.n ?? 0),
    drafts: draftRows.map(toDraft),
    draftsTotal: Number(draftCount[0]?.n ?? 0),
    unchecked: {
      reports: uncheckedRows.map((r) => toReport(r, mailByReport, onClose.get(r.id))),
      reportsTotal: Number(uncheckedCount[0]?.n ?? 0),
      drafts: uncheckedDraftRows.map(toDraft),
      draftsTotal: Number(uncheckedDraftCount[0]?.n ?? 0),
    },
    mail,
  };
}
