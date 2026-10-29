import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { can, type CapabilityHolder } from "../capabilities";
import { catsFeeding } from "../catIdentity";
import type { TeamPerson } from "../welfareQueue";
import { brakeLimitNow, brakeTripped, reportHidesToday, type HideSkipped } from "./hide";

/**
 * The team's Issues section (SYC-44 PR 7.1; spec §5.3, §5.4; plan Slice 7):
 * "Report an issue" rows (`welfare_reports.kind = 'content'`), apart from the
 * welfare queue, which never shows them (PR 4.1).
 *
 * Only for holders of `view_welfare_queue` (the team and management). Every
 * caller checks it: the queue page and its JSON on their routes, the cat page's
 * strip through {@link issueStripFor}. A cat guardian never sees an issue
 * report, not even one about a cat in her own colony (§5.3: the promise that a
 * cat's guardian is never told who reported it).
 *
 * What never leaves this file: the reporter's device, contact and language,
 * and any photo's bytes. A reported photo is only ever a URL under
 * {@link TEAM_ISSUE_PHOTO_PREFIX}, which serves it to the team only.
 */

export const TEAM_ISSUE_PHOTO_PREFIX = "/api/team/issue-photos/";
const CLOSED_LIMIT = 50;
/**
 * Rows drawn per open group (review of 7.1, finding 5): a flood, of unchecked
 * reports during an outage say, can't make the page enormous. The group's
 * heading still counts them all (`totals`).
 */
export const ISSUE_GROUP_LIMIT = 100;
const STRIP_LIMIT = 50;

/** The two reasons that need a person to look (group 2). */
const NEEDS_PERSON: ReadonlySet<string> = new Set(["location_revealing", "cat_died"]);

/** Where a row sits in the section (spec §5.3's four groups, and the closed ones). */
export type IssueGroup = "hidden" | "needs_person" | "other" | "unchecked" | "closed";

export interface IssueReport {
  /** The report's public id: the only id that ever leaves the server. */
  id: string;
  /** One of the nine reason keys (spec §2). */
  reason: string;
  /** When it was sent. */
  at: string;
  /** What the reporter wrote (team only), or null. */
  note: string | null;
  state: "new" | "looking" | "done" | "nothing_needed";
  stateChangedAt: string | null;
  stateChangedBy: TeamPerson | null;
  teamNote: string | null;
  teamNoteAt: string | null;
  teamNoteBy: TeamPerson | null;
  cat: { id: number; name: string } | null;
  /**
   * The reported catalogue photo, through the team route only. `hidden`: hidden
   * from the public right now (by anyone). `removed`: deleted for good (SYC-462),
   * so there is nothing to show and nothing to restore.
   */
  photo: { url: string | null; hidden: boolean; removed: boolean } | null;
  /** This report hid the photo itself. */
  hiddenByReport: boolean;
  /** Why it could have hidden the photo and didn't, or null. */
  hideSkipped: HideSkipped | null;
  /**
   * Other OPEN reports in the same group (§5.3): the same photo and reason, or,
   * for a report about a cat rather than a photo, the same cat and reason.
   */
  others: number;
  /** Accepted while Cloudflare's check was unreachable (§9.5). */
  unchecked: boolean;
  group: IssueGroup;
  /**
   * A "That's a different cat" report about a photo that is a spot of the cat
   * it names: the spots to move (which-cat-is-which.md §5.1 way 3; SYC-150
   * PR 3.3). Null for any other report, a closed one, or a photo that isn't a
   * resolved spot of that cat.
   */
  moveFrom: { catId: number; sightingIds: number[] } | null;
}

export interface IssuesSection {
  /** 1. Photos hidden by a report and still hidden, waiting for the team. Longest wait first. */
  hidden: IssueReport[];
  /** 2. Location and "this cat has died". Newest first. */
  needsPerson: IssueReport[];
  /** 3. Everything else. Newest first. */
  other: IssueReport[];
  /** 4. Unchecked, in their own list, never mixed into the order above. Newest first. */
  unchecked: IssueReport[];
  /** How many open reports each group holds; each list above holds at most ISSUE_GROUP_LIMIT. */
  totals: { hidden: number; needsPerson: number; other: number; unchecked: number };
  /** The newest closed ones; `closedTotal` counts them all. */
  closed: IssueReport[];
  closedTotal: number;
  /**
   * The daily brake (spec D3): `on` once today's report-hides reach the limit;
   * read from the same count the hide itself uses. There is no resume.
   */
  brake: { on: boolean; hidesToday: number; limit: number };
}

const person = (name: string | null, leftAt: Date | string | null): TeamPerson | null =>
  name === null ? null : { name, left: leftAt !== null };

const iso = (d: Date | string | null): string | null => (d === null ? null : new Date(d).toISOString());

type Row = {
  id: number;
  public_id: string;
  reason: string;
  note: string | null;
  state: IssueReport["state"];
  state_changed_at: Date | string | null;
  team_note: string | null;
  team_note_at: Date | string | null;
  cat_id: number | null;
  cat_name: string | null;
  photo_id: number | null;
  photo_removed_at: Date | string | null;
  photo_hidden: boolean | null;
  hidden_by_report: boolean;
  hide_skipped: HideSkipped | null;
  token_checked: boolean | null;
  at: Date | string;
  changed_by_name: string | null;
  changed_by_left_at: Date | string | null;
  noted_by_name: string | null;
  noted_by_left_at: Date | string | null;
  others: number;
  move_cat_id: number | null;
  move_sightings: number[] | null;
};

/**
 * The one read of issue rows. Selects no reporter column: not the device, the
 * contact or the language. `extra` narrows it; `tail` orders and limits.
 */
async function issueRows(extra: SQL, tail: SQL): Promise<Row[]> {
  const res = await db.execute(sql`
    select r.id, r.public_id, r.reason, r.note, r.state, r.state_changed_at,
           r.team_note, r.team_note_at, r.cat_id, c.name as cat_name,
           r.photo_id, p.removed_at as photo_removed_at,
           (p.id is not null and (
              p.removed_at is not null
              or (select e.action from photo_visibility_events e
                   where e.photo_id = p.id order by e.id desc limit 1) = 'hide'
           )) as photo_hidden,
           r.hidden_by_report, r.hide_skipped, r.token_checked,
           coalesce(r.submitted_at, r.created_at) as at,
           changed.name as changed_by_name, changed.left_at as changed_by_left_at,
           noted.name as noted_by_name, noted.left_at as noted_by_left_at,
           (select count(*)::int from welfare_reports o
             where o.kind = 'content' and o.is_draft = false
               and o.state in ('new', 'looking')
               and o.id <> r.id
               and o.reason = r.reason
               and case when r.photo_id is not null then o.photo_id = r.photo_id
                        else o.photo_id is null and o.cat_id = r.cat_id end
           ) as others,
           coalesce(r.cat_id, r.reporter_cat_id) as move_cat_id,
           (select array_agg(s.id order by s.id)
              from sightings s
             where r.reason = 'wrong_cat'
               and r.photo_id is not null
               and s.status = 'resolved'
               and s.cat_id = coalesce(r.cat_id, r.reporter_cat_id)
               and (s.photo_id = r.photo_id
                    or exists (select 1 from sighting_photos sp where sp.sighting_id = s.id and sp.photo_id = r.photo_id))
           ) as move_sightings
      from welfare_reports r
      left join cats c on c.id = r.cat_id
      left join photos p on p.id = r.photo_id
      left join people changed on changed.id = r.state_changed_by
      left join people noted on noted.id = r.team_note_by
     where r.kind = 'content' and r.is_draft = false and ${extra}
     ${tail}
  `);
  return res.rows as Row[];
}

function groupOf(r: Row): IssueGroup {
  if (r.state === "done" || r.state === "nothing_needed") return "closed";
  if (r.token_checked === false) return "unchecked";
  if (r.hidden_by_report && r.photo_hidden === true) return "hidden";
  if (NEEDS_PERSON.has(r.reason)) return "needs_person";
  return "other";
}

function toIssue(r: Row): IssueReport {
  const removed = r.photo_removed_at !== null;
  return {
    id: r.public_id,
    reason: r.reason,
    at: iso(r.at)!,
    note: r.note,
    state: r.state,
    stateChangedAt: iso(r.state_changed_at),
    stateChangedBy: person(r.changed_by_name, r.changed_by_left_at),
    teamNote: r.team_note,
    teamNoteAt: iso(r.team_note_at),
    teamNoteBy: person(r.noted_by_name, r.noted_by_left_at),
    cat: r.cat_id !== null && r.cat_name !== null ? { id: r.cat_id, name: r.cat_name } : null,
    photo:
      r.photo_id === null
        ? null
        : {
            url: removed ? null : `${TEAM_ISSUE_PHOTO_PREFIX}${encodeURIComponent(r.public_id)}`,
            hidden: r.photo_hidden === true,
            removed,
          },
    hiddenByReport: r.hidden_by_report,
    hideSkipped: r.hide_skipped,
    others: Number(r.others),
    unchecked: r.token_checked === false,
    group: groupOf(r),
    moveFrom:
      (r.state === "new" || r.state === "looking") && r.move_cat_id !== null && r.move_sightings && r.move_sightings.length > 0
        ? { catId: r.move_cat_id, sightingIds: r.move_sightings.map(Number) }
        : null,
  };
}

const at = (r: IssueReport) => Date.parse(r.at);

/**
 * The Issues section: every open issue report in its group, and the newest
 * closed ones. Never above a welfare report: the page draws it below them.
 */
export async function listIssues(): Promise<IssuesSection> {
  const [open, closed, closedCount, hidesToday] = await Promise.all([
    issueRows(sql`r.state in ('new', 'looking')`, sql`order by at desc, r.id desc`),
    issueRows(sql`r.state in ('done', 'nothing_needed')`, sql`order by at desc, r.id desc limit ${CLOSED_LIMIT}`),
    db.execute(sql`
      select count(*)::int as n from welfare_reports
       where kind = 'content' and is_draft = false and state in ('done', 'nothing_needed')`),
    reportHidesToday(),
  ]);
  const issues = open.map(toIssue);
  const pick = (g: IssueGroup) => issues.filter((i) => i.group === g);
  // Longest wait first (§5.3): the public is already safe from these.
  const hidden = pick("hidden").sort((a, b) => at(a) - at(b));
  const [needsPerson, other, unchecked] = [pick("needs_person"), pick("other"), pick("unchecked")];
  const cap = (list: IssueReport[]) => list.slice(0, ISSUE_GROUP_LIMIT);
  return {
    hidden: cap(hidden),
    needsPerson: cap(needsPerson),
    other: cap(other),
    unchecked: cap(unchecked),
    totals: {
      hidden: hidden.length,
      needsPerson: needsPerson.length,
      other: other.length,
      unchecked: unchecked.length,
    },
    closed: closed.map(toIssue),
    closedTotal: Number((closedCount.rows[0] as { n: number } | undefined)?.n ?? 0),
    brake: { on: brakeTripped(hidesToday), hidesToday, limit: brakeLimitNow() },
  };
}

/** One sent issue report, as the section shows it; null for an unknown id. */
export async function getIssueReport(publicId: string): Promise<IssueReport | null> {
  const [row] = await issueRows(sql`r.public_id = ${publicId}`, sql``);
  return row ? toIssue(row) : null;
}

/**
 * The strip on the team cat page (§5.3): this cat's issue reports, newest
 * first, **or null for anyone without `view_welfare_queue`**. Checked here, on
 * its own, not by the cat page's own check: a cat guardian may one day open
 * the team cat page for a cat in her colony, and must still get no strip.
 */
export async function issueStripFor(
  viewer: CapabilityHolder,
  catId: number,
): Promise<{ reports: IssueReport[]; total: number; open: number } | null> {
  if (!can(viewer, "view_welfare_queue")) return null;
  // Reports about every cat merged into this one show here too
  // (which-cat-is-which.md §9.3: welfare_reports readers on a cat page).
  const feeding = (await catsFeeding([catId])).get(catId)?.ids ?? [catId];
  const ids = sql.join(
    feeding.map((id) => sql`${id}`),
    sql`, `,
  );
  const [rows, count] = await Promise.all([
    issueRows(sql`r.cat_id in (${ids})`, sql`order by at desc, r.id desc limit ${STRIP_LIMIT}`),
    db.execute(sql`
      select count(*)::int as n,
              (count(*) filter (where state in ('new', 'looking')))::int as open
         from welfare_reports
        where kind = 'content' and is_draft = false and cat_id in (${ids})`),
  ]);
  // The heading counts them all, not just the newest STRIP_LIMIT drawn (ship review, finding 3).
  const c = count.rows[0] as { n: number; open: number } | undefined;
  return { reports: rows.map(toIssue), total: Number(c?.n ?? 0), open: Number(c?.open ?? 0) };
}
