import type {
  EmailToTeam,
  MailHealth,
  QueueDraft,
  QueueReport,
  TeamPerson,
  WelfareQueue,
} from "../welfareQueue";
import { CHANGED_MESSAGE, NOTE_MAX, REPORT_STATES } from "../welfareActions";
import { TIE_CHANGED_MESSAGE, TIE_SAME_MESSAGE } from "../welfareTie";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";

// The welfare queue page (SYC-43 part 2 plan, PR 1; spec §3.1, §4.2, §8.3).
// Read-only. Server-drawn, no scripts. Every value goes through escapeHtml.
//
// Not on this page, by rule (spec §3.1, §3.6, F1): nothing that hands a
// report to someone, sets a deadline, or pages anybody. Test P1-6 pins the
// words.

const SEVERITY: Record<QueueReport["severity"], string> = {
  urgent: "Urgent",
  attention: "Needs attention",
};

const STATE: Record<QueueReport["state"], string> = {
  new: "New",
  looking: "Looking at it",
  done: "Done",
  nothing_needed: "Nothing needed",
};

const EMAIL: Record<EmailToTeam, string> = {
  sent: "Sent",
  waiting: "Waiting to send",
  failed: "Failed. Syros Cats may not have been told by email.",
};

/** "3 hours ago". Older than a month: the date. */
export function timeAgo(iso: string, now: Date): string {
  const seconds = Math.max(
    0,
    Math.round((now.getTime() - Date.parse(iso)) / 1000),
  );
  const plural = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return plural(Math.floor(seconds / 60), "minute");
  if (seconds < 86_400) return plural(Math.floor(seconds / 3600), "hour");
  if (seconds < 30 * 86_400) return plural(Math.floor(seconds / 86_400), "day");
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const ago = (iso: string, now: Date) =>
  `<time datetime="${esc(iso)}">${esc(timeAgo(iso, now))}</time>`;

const who = (p: TeamPerson) => (p.left ? `${p.name} (left)` : p.name);

/**
 * Which reports (by public id) are within 50 m of a feeding site. Null means
 * the check failed: then no link is shown at all, since a failure must never
 * add one.
 */
export type NearSites = ReadonlySet<string> | null;

// Decision 2B (SYC-245): the one team page that keeps a link to a map company,
// because a welfare call-out needs directions. Within 50 m of any feeding site
// the link is replaced by a line of text, so nothing near a site is sent to
// the map company. The link is a plain one: leaving the dashboard sends
// nothing until it is tapped.
const place = (lat: number, lng: number, id: string, near: NearSites) => {
  const here = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  if (near === null) return esc(here);
  if (near.has(id)) {
    return `${esc(here)} &middot; <span class="ago">Near a feeding site: see the dashboard map</span>`;
  }
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
  return `${esc(here)} &middot; <a href="${esc(map)}" rel="noopener noreferrer">Open map</a>`;
};

const row = (label: string, value: string) =>
  `<dt>${esc(label)}</dt><dd>${value}</dd>`;

function photoBlock(r: QueueReport): string {
  if (r.photo.url) {
    return `<img class="photo" src="${esc(r.photo.url)}" alt="Photo sent with this report" loading="lazy">`;
  }
  const text =
    r.photo.status === "pending"
      ? "Photo still uploading"
      : r.photo.status === "failed"
        ? "No photo: the photo could not be received"
        : "No photo";
  return `<div class="nophoto">${esc(text)}</div>`;
}

/**
 * The two forms on a sent report (PR 2): move it, and the team note. Plain
 * forms posting to the routes in routes/teamReports.ts; the browser sends
 * the Origin the routes check. `from` is the state this page showed.
 */
function actionForms(r: QueueReport): string {
  const base = `/api/team/reports/${encodeURIComponent(r.id)}`;
  const buttons = REPORT_STATES.map((s) =>
    s === r.state
      ? `<button type="button" class="here" disabled aria-current="true">${esc(STATE[s])} (now)</button>`
      : `<button type="submit" name="to" value="${esc(s)}">${esc(STATE[s])}</button>`,
  ).join("");
  const noteId = `note-${r.id}`;
  return (
    '<div class="actions">' +
    `<form method="post" action="${esc(base)}/state">` +
    `<input type="hidden" name="from" value="${esc(r.state)}">` +
    '<p class="label">Move this report to</p>' +
    `<div class="states">${buttons}</div></form>` +
    `<form method="post" action="${esc(base)}/note">` +
    `<label class="label" for="${esc(noteId)}">Team note ` +
    '<span class="hint">Team only. Never shown to the reporter.</span></label>' +
    // The first newline after <textarea> is dropped by browsers, so one is
    // added to keep a note that starts with a blank line as written.
    `<textarea id="${esc(noteId)}" name="note" rows="3" maxlength="${NOTE_MAX}">\n${esc(r.teamNote ?? "")}</textarea>` +
    '<button type="submit" class="save">Save note</button></form>' +
    "</div>"
  );
}

/** What happened to a tie, by the fixed key the tie route sent back. */
export type TiedNotice = { id: string; key: string };

const TIED_TEXT: Record<string, string> = {
  ok: "Saved. This report is now tied to the cat shown below.",
  changed: TIE_CHANGED_MESSAGE,
  same: TIE_SAME_MESSAGE,
};

/**
 * Which cat this is (PR 5): the cat's name linking to the team's cat page
 * with a way to choose another, or a plain link into the cat search.
 * Plain links only: the search carries the report's public id and shows a
 * "This is the cat" form beside each result.
 */
function catRow(r: QueueReport): string {
  const search = `/api/team/cats?tie=${encodeURIComponent(r.id)}`;
  if (r.cat) {
    return row(
      "Which cat",
      `<a class="tap catlink" href="/api/team/cats/${r.cat.id}">${esc(r.cat.name)}</a>` +
        `<a class="tap sublink" href="${esc(search)}">Wrong cat? Choose another</a>`,
    );
  }
  return row(
    "Which cat",
    `<a class="tap" href="${esc(search)}">This is a cat we know</a>`,
  );
}

function reportCard(
  r: QueueReport,
  now: Date,
  closed: boolean,
  changedId: string | undefined,
  tied: TiedNotice | undefined,
  near: NearSites,
): string {
  const classes = [
    "report",
    r.severity === "urgent" ? "urgent" : "",
    closed ? "closed" : "",
    r.photo.url ? "has-photo" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const tags =
    `<span class="tag${r.severity === "urgent" ? " urgent" : ""}">${esc(SEVERITY[r.severity])}</span>` +
    (r.isLitter ? '<span class="tag kittens">Kittens</span>' : "") +
    (r.unchecked ? '<span class="tag unchecked">Unchecked</span>' : "") +
    `<span class="tag state">${esc(STATE[r.state])}</span>` +
    `<span class="ago">${ago(r.at, now)}</span>`;
  const moved =
    r.stateChangedAt && r.stateChangedBy
      ? row(
          "Last moved",
          `${esc(who(r.stateChangedBy))}, ${ago(r.stateChangedAt, now)}`,
        )
      : "";
  const note = r.teamNote
    ? `<span class="note">${esc(r.teamNote)}</span>` +
      (r.teamNoteBy && r.teamNoteAt
        ? ` <span class="ago">${esc(who(r.teamNoteBy))}, ${ago(r.teamNoteAt, now)}</span>`
        : "")
    : '<span class="ago">None yet</span>';
  const email = r.emailToTeam
    ? `<span${r.emailToTeam === "failed" ? ' class="bad"' : ""}>${esc(EMAIL[r.emailToTeam])}</span>`
    : '<span class="ago">None on record</span>';
  return (
    `<article class="${classes}" id="r-${esc(r.id)}">` +
    photoBlock(r) +
    (r.id === changedId
      ? `<p class="notice" role="status">${esc(CHANGED_MESSAGE)}</p>`
      : "") +
    // Own keys only: ?tied=constructor must not reach Object.prototype.
    (tied && r.id === tied.id && Object.hasOwn(TIED_TEXT, tied.key)
      ? `<p class="notice" role="status">${esc(TIED_TEXT[tied.key]!)}</p>`
      : "") +
    `<div class="head">${tags}</div>` +
    "<dl>" +
    row("Where", place(r.lat, r.lng, r.id, near)) +
    row(
      "What they said",
      r.note
        ? `<span class="note">${esc(r.note)}</span>`
        : '<span class="ago">Nothing written</span>',
    ) +
    catRow(r) +
    row("Contact left", "No") +
    row("Team note", note) +
    moved +
    row("Email to Syros Cats", email) +
    "</dl>" +
    actionForms(r) +
    "</article>"
  );
}

function draftCard(d: QueueDraft, now: Date, near: NearSites): string {
  return (
    `<article class="report draft${d.severity === "urgent" ? " urgent" : ""}" id="d-${esc(d.id)}">` +
    '<div class="head">' +
    `<span class="tag${d.severity === "urgent" ? " urgent" : ""}">${esc(SEVERITY[d.severity])}</span>` +
    `<span class="ago">started ${ago(d.startedAt, now)}</span></div>` +
    `<dl>${row("Where", place(d.lat, d.lng, d.id, near))}</dl></article>`
  );
}

/**
 * SYC-170 (spec §9.5, §5.3): reports accepted while Cloudflare's check was
 * unreachable, in their own list below every checked report, newest first.
 * The count shows even at zero, as an early sign the check is broken. The
 * unchecked drafts are folded away (a plain <details>, no script).
 */
function uncheckedSection(
  queue: WelfareQueue,
  now: Date,
  changedId: string | undefined,
  tied: TiedNotice | undefined,
  near: NearSites,
): string {
  const { reports, drafts, draftsTotal } = queue.unchecked;
  const list = reports.length
    ? '<p class="empty">These arrived while the safety check couldn\'t reach Cloudflare. Most will be real reports sent during an outage, but some may not be, so they are kept apart from the queue above.</p>' +
      reports.map((r) => reportCard(r, now, false, changedId, tied, near)).join("")
    : '<p class="empty">None. Every report above passed the safety check.</p>';
  const folded = drafts.length
    ? `<details class="unchecked-drafts"><summary>Unchecked drafts (${draftsTotal})</summary>` +
      drafts.map((d) => draftCard(d, now, near)).join("") +
      (draftsTotal > drafts.length
        ? `<p class="empty">Showing the newest ${drafts.length} of ${draftsTotal}.</p>`
        : "") +
      "</details>"
    : "";
  return (
    `<section id="unchecked"><h2>Unchecked (Cloudflare was unreachable) (${reports.length})</h2>` +
    list +
    folded +
    "</section>"
  );
}

function mailBanner(mail: MailHealth): string {
  if (mail.failed === 0 && mail.late === 0) return "";
  const problems = [
    mail.failed > 0 ? "could not be sent" : "",
    mail.late > 0 ? "are more than an hour late" : "",
  ].filter(Boolean);
  return (
    '<div class="banner" role="status">' +
    `<strong>Some emails telling Syros Cats about new reports ${problems.join(" or ")}.</strong> ` +
    "Every report is still safe in the queue below, and nothing has been lost. " +
    "Please tell whoever looks after the app." +
    "</div>"
  );
}

export function renderQueuePage(
  queue: WelfareQueue,
  personName: string,
  now: Date = new Date(),
  changedId: string | undefined,
  tied: TiedNotice | undefined,
  near: NearSites,
): string {
  const open = queue.open.length
    ? queue.open.map((r) => reportCard(r, now, false, changedId, tied, near)).join("")
    : '<p class="empty">No reports are waiting for the team.</p>';
  const drafts = queue.drafts.length
    ? "<h2>Started but not sent</h2>" +
      '<p class="empty">Someone began a report and did not send it. They may still be worried about a cat here.</p>' +
      queue.drafts.map((d) => draftCard(d, now, near)).join("") +
      (queue.draftsTotal > queue.drafts.length
        ? `<p class="empty">Showing the newest ${queue.drafts.length} of ${queue.draftsTotal}.</p>`
        : "")
    : "";
  const closed = queue.closed.length
    ? `<h2>Closed (${queue.closedTotal})</h2>` +
      queue.closed.map((r) => reportCard(r, now, true, changedId, tied, near)).join("") +
      (queue.closedTotal > queue.closed.length
        ? `<p class="empty">Showing the newest ${queue.closed.length} of ${queue.closedTotal}.</p>`
        : "")
    : "";
  return renderPage({
    title: "Welfare queue",
    active: "queue",
    personName,
    banner: mailBanner(queue.mail),
    body: `<h2>Waiting for the team (${queue.open.length})</h2>${open}${drafts}${closed}${uncheckedSection(queue, now, changedId, tied, near)}`,
  });
}
