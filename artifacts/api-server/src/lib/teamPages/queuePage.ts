import type {
  EmailToReporter,
  EmailToTeam,
  MailHealth,
  QueueDraft,
  QueueReport,
  TeamPerson,
  WelfareQueue,
} from "../welfareQueue";
import { CHANGED_MESSAGE, NOTE_MAX, REPORT_STATES } from "../welfareActions";
import { TIE_CHANGED_MESSAGE, TIE_SAME_MESSAGE } from "../welfareTie";
import { TEAM_SENTENCE_MAX } from "../mail/reportTemplates";
import type { IssueReport, IssuesSection } from "../issues/queue";
import { reasonLabel } from "../issues/alertEmail";
import { ISSUE_OUTCOME_TEXT } from "../issues/teamActions";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { position } from "./position";

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
  delivered: "Delivered",
  bounced: "Bounced. Syros Cats may not have been told by email.",
  waiting: "Waiting to send",
  failed: "Failed. Syros Cats may not have been told by email.",
};

// SYC-42 Slice 3. Never the address: only what happened.
const REPORTER_EMAIL: Record<EmailToReporter, string> = {
  unconfirmed: "Yes. They haven't confirmed the address yet, so nothing else goes to it.",
  confirmed: "Yes. They confirmed the address.",
  waiting: "Yes. An email to them is waiting to send.",
  sent: "Yes. Our last email to them was sent.",
  delivered: "Yes. Our last email to them was delivered.",
  bounced: "Yes, but our last email to them bounced.",
  failed: "Yes, but our last email to them could not be sent.",
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

// Positions print through position.ts (SYC-395, D9): an island-wide viewer
// gets "Open map" on every report and draft, near a feeding site or not. This
// replaces the queue's own link and its 50 m near-site rule (SYC-245,
// SYC-209 Decision 2B). The link is a plain one: leaving the dashboard sends
// nothing until it is tapped.

const row = (label: string, value: string) =>
  `<dt>${esc(label)}</dt><dd>${value}</dd>`;

function photoBlock(r: QueueReport): string {
  if (r.photo.url) {
    // A thumbnail on a phone: tap it for the photo at full size.
    return (
      `<a class="photolink" href="${esc(r.photo.url)}">` +
      `<img class="photo" src="${esc(r.photo.url)}" alt="Photo sent with this report" loading="lazy"></a>`
    );
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
function actionForms(
  r: Pick<QueueReport, "id" | "state" | "teamNote" | "contactLeft" | "emailToReporter">,
  noteOpen: boolean,
): string {
  const base = `/api/team/reports/${encodeURIComponent(r.id)}`;
  const buttons = REPORT_STATES.map((s) =>
    s === r.state
      ? `<button type="button" class="here" disabled aria-current="true">${esc(STATE[s])} (current)</button>`
      : `<button type="submit" name="to" value="${esc(s)}">${esc(STATE[s])}</button>`,
  ).join("");
  const noteId = `note-${r.id}`;
  const sentenceId = `sentence-${r.id}`;
  // SYC-42 Slice 3 (§5.3(h)): one optional line added to the reporter's
  // fixed "Done" email. Only when they left an address and it can still go.
  const sentence =
    // Only once they've confirmed: a line written before that would never
    // reach them (review of #181, finding 2).
    r.contactLeft && r.emailToReporter !== "unconfirmed" && r.state !== "done"
      ? `<label class="label" for="${esc(sentenceId)}">Add a line to the reporter's email (optional, sent with Done only) ` +
        '<span class="hint">This goes to a member of the public, added to the fixed message. Keep it short.</span></label>' +
        `<input id="${esc(sentenceId)}" name="reporterSentence" type="text" class="text" maxlength="${TEAM_SENTENCE_MAX}">`
      : "";
  return (
    '<div class="actions">' +
    `<form method="post" action="${esc(base)}/state">` +
    `<input type="hidden" name="from" value="${esc(r.state)}">` +
    '<p class="label">Move this report to</p>' +
    sentence +
    `<div class="states">${buttons}</div></form>` +
    // Folded away so a phone isn't mostly empty note boxes.
    `<details class="notebox"${noteOpen ? " open" : ""}><summary>${r.teamNote ? "Change the team note" : "Add a team note"}</summary>` +
    `<form method="post" action="${esc(base)}/note">` +
    `<label class="label" for="${esc(noteId)}">Team note ` +
    '<span class="hint">Team only. Never shown to the reporter.</span></label>' +
    // The first newline after <textarea> is dropped by browsers, so one is
    // added to keep a note that starts with a blank line as written.
    `<textarea id="${esc(noteId)}" name="note" rows="3" maxlength="${NOTE_MAX}">\n${esc(r.teamNote ?? "")}</textarea>` +
    '<button type="submit" class="save">Save note</button></form></details>' +
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
 *
 * SYC-504 (help-and-info spec §4.4): a report sent from a cat's page also
 * carries that cat as a suggestion. Four states:
 *   tied, suggestion same or none  -> as before
 *   tied to a different cat        -> as before, plus a muted "Sent from" line
 *   not tied, with a suggestion    -> the line, thumbnails side by side, and
 *                                     "Yes, it's X" for those who may tie
 *   not tied, no suggestion        -> as before
 * The suggestion is never applied by itself: the tie writes history.
 */
function catRow(r: QueueReport, canTie: boolean): string {
  const search = `/api/team/cats?tie=${encodeURIComponent(r.id)}`;
  const sg = r.suggestedCat;
  const sentFrom = (c: NonNullable<QueueReport["suggestedCat"]>) =>
    `Sent from <a class="catlink" href="/api/team/cats/${c.id}">${esc(c.name)}</a>'s page`;
  if (r.cat) {
    const different = sg !== null && sg.id !== r.cat.id;
    return row(
      "Which cat",
      `<a class="tap catlink" href="/api/team/cats/${r.cat.id}">${esc(r.cat.name)}</a>` +
        `<a class="tap sublink" href="${esc(search)}">Wrong cat? Choose another</a>` +
        (different ? `<p class="muted">${sentFrom(sg)}</p>` : ""),
    );
  }
  if (sg) {
    const thumbs =
      (r.photo.url
        ? `<figure><img src="${esc(r.photo.url)}" alt="Photo sent with this report" loading="lazy" width="72" height="72"><figcaption>This report</figcaption></figure>`
        : "") +
      (sg.photoUrl
        ? `<figure><img src="${esc(sg.photoUrl)}" alt="${esc(`Photo of ${sg.name}`)}" loading="lazy" width="72" height="72"><figcaption>${esc(sg.name)}</figcaption></figure>`
        : "");
    const yes = canTie
      ? `<form method="post" action="/api/team/reports/${esc(encodeURIComponent(r.id))}/cat">` +
        `<input type="hidden" name="catId" value="${sg.id}">` +
        '<input type="hidden" name="expectedCatId" value="">' +
        `<button type="submit" class="tiebtn">Yes, it's ${esc(sg.name)}</button></form>`
      : "";
    return row(
      "Which cat",
      `<p class="muted">${sentFrom(sg)}</p>` +
        (thumbs ? `<div class="compare">${thumbs}</div>` : "") +
        yes +
        `<a class="tap sublink" href="${esc(search)}">Choose another cat</a>`,
    );
  }
  return row(
    "Which cat",
    `<a class="tap" href="${esc(search)}">Match to a known cat</a>`,
  );
}

function reportCard(
  r: QueueReport,
  now: Date,
  closed: boolean,
  changedId: string | undefined,
  tied: TiedNotice | undefined,
  island: boolean,
  canTie: boolean,
  noted?: string,
): string {
  const classes = [
    "report",
    r.severity === "urgent" ? "urgent" : "",
    closed ? "closed" : "",
    r.photo.url && !closed ? "has-photo" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const landed =
    r.id === changedId || r.id === noted || (tied !== undefined && r.id === tied.id);
  const tags =
    `<span class="tag ${r.severity === "urgent" ? "urgent" : "attention"}">${esc(SEVERITY[r.severity])}</span>` +
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
  const body =
    photoBlock(r) +
    (r.id === changedId
      ? `<p class="notice" role="status">${esc(CHANGED_MESSAGE)}</p>`
      : "") +
    // Own keys only: ?tied=constructor must not reach Object.prototype.
    (tied && r.id === tied.id && Object.hasOwn(TIED_TEXT, tied.key)
      ? `<p class="notice" role="status">${esc(TIED_TEXT[tied.key]!)}</p>`
      : "") +
    (r.id === noted ? '<p class="notice" role="status">Saved. The team note is updated.</p>' : "") +
    (closed ? "" : `<div class="head">${tags}</div>`) +
    "<dl>" +
    row("Where", position(r.lat, r.lng, { link: island })) +
    row(
      "What they said",
      r.note
        ? `<span class="note">${esc(r.note)}</span>`
        : '<span class="ago">Nothing written</span>',
    ) +
    catRow(r, canTie) +
    row(
      "Contact left",
      r.emailToReporter
        ? `<span${r.emailToReporter === "bounced" || r.emailToReporter === "failed" ? ' class="bad"' : ""}>${esc(REPORTER_EMAIL[r.emailToReporter])}</span>`
        : "No",
    ) +
    row("Team note", note) +
    moved +
    row("Email to Syros Cats", email) +
    "</dl>" +
    actionForms(r, landed);
  if (!closed) return `<article class="${classes}" id="r-${esc(r.id)}">${body}</article>`;
  // A closed report is one line until it's opened: open after an action on it.
  return (
    `<article class="${classes}" id="r-${esc(r.id)}">` +
    `<details${landed ? " open" : ""}><summary><span class="head">${tags}</span>` +
    `<span class="said1">${r.note ? esc(r.note) : "Nothing written"}</span></summary>` +
    `<div${r.photo.url ? ' class="has-photo"' : ""}>${body}</div></details></article>`
  );
}

function draftCard(d: QueueDraft, now: Date, island: boolean): string {
  // SYC-504: where the reporter began it from. A line only: the tie refuses
  // drafts, so there are no buttons.
  const from = d.suggestedCat
    ? `<p class="muted">Sent from <a class="catlink" href="/api/team/cats/${d.suggestedCat.id}">${esc(d.suggestedCat.name)}</a>'s page</p>`
    : "";
  return (
    `<article class="report draft${d.severity === "urgent" ? " urgent" : ""}" id="d-${esc(d.id)}">` +
    '<div class="head">' +
    `<span class="tag ${d.severity === "urgent" ? "urgent" : "attention"}">${esc(SEVERITY[d.severity])}</span>` +
    `<span class="ago">started ${ago(d.startedAt, now)}</span></div>` +
    `<dl>${row("Where", position(d.lat, d.lng, { link: island }))}</dl>${from}</article>`
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
  island: boolean,
  canTie: boolean,
  noted: string | undefined,
): string {
  const { reports, reportsTotal, drafts, draftsTotal } = queue.unchecked;
  const list = reports.length
    ? '<p class="empty">These arrived while the safety check couldn\'t reach Cloudflare. Most will be real reports sent during an outage, but some may not be, so they are kept apart from the queue above.</p>' +
      reports.map((r) => reportCard(r, now, false, changedId, tied, island, canTie, noted)).join("") +
      (reportsTotal > reports.length
        ? `<p class="empty">Showing the newest ${reports.length} of ${reportsTotal}.</p>`
        : "")
    : // True for null rows too: sent before the check existed, or with it off
      // or only observing (review of #151, finding 7).
      '<p class="empty">None. No report arrived while the safety check was unreachable. Reports above were either checked or sent before the safety check existed.</p>';
  const folded = drafts.length
    ? `<details class="unchecked-drafts"><summary>Unchecked drafts (${draftsTotal})</summary>` +
      drafts.map((d) => draftCard(d, now, island)).join("") +
      (draftsTotal > drafts.length
        ? `<p class="empty">Showing the newest ${drafts.length} of ${draftsTotal}.</p>`
        : "") +
      "</details>"
    : "";
  return (
    `<section id="unchecked"><h2>Unchecked (Cloudflare was unreachable) (${reportsTotal})</h2>` +
    list +
    folded +
    "</section>"
  );
}

// ── SYC-44 PR 7.1: the Issues section (spec §5.3, §5.4) ─────────────────────
//
// "Report an issue" reports, in their own section at the very bottom of the
// page, so never above a welfare report (§5.3; T7-2): a colour band AND an
// "Issue" text label on every row, so it never depends on colour alone. The
// reporter is "a member of the public": nothing else about them exists here.
// No "Which cat is this?" on these rows (PR 4.1: a tie writes evidence of life).

/** `hide_skipped` in words (plan PR 4.1). */
const HIDE_SKIPPED: Record<NonNullable<IssueReport["hideSkipped"]>, string> = {
  already_hidden: "Already hidden when this was sent",
  restored_before: "Not hidden: the team restored this photo before, so a report can't hide it again",
  address_limit: "Not hidden: hide limit reached for the sender",
  brake: "Not hidden: daily brake (automatic hiding was paused for the day)",
  unchecked: "Not hidden: unchecked (the safety check couldn't reach Cloudflare)",
};

function issuePhotoWords(i: IssueReport): string {
  if (!i.photo) return "Not about one photo";
  if (i.photo.removed) return "Deleted for good";
  if (!i.photo.hidden) return "Public";
  return i.hiddenByReport ? "Hidden from the public by this report" : "Hidden from the public";
}

/** Plain links to the cat page's own forms (§5.4): rename, a death, marking a statement wrong. */
function catLinks(i: IssueReport): string {
  if (!i.cat) return "";
  const page = `/api/team/cats/${i.cat.id}`;
  const links = [`<a class="tap" href="${esc(page)}">Open the cat's page</a>`];
  if (i.reason === "wrong_name") links.push(`<a class="tap sublink" href="${esc(page)}#corrections">Rename the cat</a>`);
  if (i.reason === "cat_died") links.push(`<a class="tap sublink" href="${esc(page)}/died">Record that the cat has died</a>`);
  if (i.reason === "wrong_info") links.push(`<a class="tap sublink" href="${esc(page)}#history">Mark something wrong</a>`);
  return `<p class="issuelinks">${links.join("")}</p>`;
}

/**
 * The photo buttons (§5.4), each a plain form posting to its own route, which
 * checks the capability again. A photo hidden now: Keep hidden and Restore
 * (Keep hidden only, once it's deleted for good). A public one: Hide this photo.
 */
function issueButtons(i: IssueReport): string {
  if (!i.photo) return "";
  const base = `/api/team/issues/${encodeURIComponent(i.id)}`;
  const from = `<input type="hidden" name="from" value="${esc(i.state)}">`;
  const button = (path: string, words: string, withFrom: boolean) =>
    `<form method="post" action="${esc(base)}/${path}">${withFrom ? from : ""}<button type="submit">${esc(words)}</button></form>`;
  const buttons = i.photo.hidden
    ? button("keep-hidden", "Keep hidden (Done)", true) +
      (i.photo.removed ? "" : button("restore", "Restore the photo (Nothing needed)", true))
    : button("hide", "Hide this photo", false);
  return `<div class="actions issueacts"><p class="label">The photo</p><div class="states">${buttons}</div></div>`;
}

/** What happened after an Issues action, by the fixed key the route sent back. */
export type IssueNotice = { id: string; key: string };

function issueCard(
  i: IssueReport,
  now: Date,
  closed: boolean,
  changedId: string | undefined,
  issueNotice: IssueNotice | undefined,
  noted: string | undefined,
): string {
  const landed = i.id === changedId || i.id === noted || i.id === issueNotice?.id;
  const classes = ["report", "issue", closed ? "closed" : "", i.photo?.url && !closed ? "has-photo" : ""]
    .filter(Boolean)
    .join(" ");
  const tags =
    '<span class="tag issue">Issue</span>' +
    (i.photo?.hidden ? '<span class="tag hiddennow">Photo hidden</span>' : "") +
    (i.unchecked ? '<span class="tag unchecked">Unchecked</span>' : "") +
    `<span class="tag state">${esc(STATE[i.state])}</span>` +
    `<span class="ago">${ago(i.at, now)}</span>`;
  const photo = i.photo?.url
    ? `<a class="photolink" href="${esc(i.photo.url)}">` +
      `<img class="photo" src="${esc(i.photo.url)}" alt="The reported photo" loading="lazy"></a>`
    : i.photo?.removed
      ? '<div class="nophoto">The photo was deleted for good</div>'
      : "";
  const outcome =
    issueNotice && i.id === issueNotice.id && Object.hasOwn(ISSUE_OUTCOME_TEXT, issueNotice.key)
      ? `<p class="notice" role="status">${esc(ISSUE_OUTCOME_TEXT[issueNotice.key as keyof typeof ISSUE_OUTCOME_TEXT])}</p>`
      : "";
  const note = i.teamNote
    ? `<span class="note">${esc(i.teamNote)}</span>` +
      (i.teamNoteBy && i.teamNoteAt ? ` <span class="ago">${esc(who(i.teamNoteBy))}, ${ago(i.teamNoteAt, now)}</span>` : "")
    : '<span class="ago">None yet</span>';
  const body =
    photo +
    (i.id === changedId ? `<p class="notice" role="status">${esc(CHANGED_MESSAGE)}</p>` : "") +
    outcome +
    (i.id === noted ? '<p class="notice" role="status">Saved. The team note is updated.</p>' : "") +
    (closed ? "" : `<div class="head">${tags}</div>`) +
    "<dl>" +
    row("What's wrong", `<strong>${esc(reasonLabel(i.reason))}</strong>`) +
    row("Which cat", i.cat ? `<a class="tap catlink" href="/api/team/cats/${i.cat.id}">${esc(i.cat.name)}</a>` : "Not known") +
    row("The photo", esc(issuePhotoWords(i))) +
    (i.hideSkipped ? row("Hiding", esc(HIDE_SKIPPED[i.hideSkipped])) : "") +
    row("What they said", i.note ? `<span class="note">${esc(i.note)}</span>` : '<span class="ago">Nothing written</span>') +
    row("Sent by", "A member of the public") +
    row(
      "Others",
      i.others > 0
        ? `<strong>${esc(i.others === 1 ? "1 other reported this" : `${i.others} others reported this`)}</strong>`
        : '<span class="ago">No one else, among the open reports</span>',
    ) +
    row("Team note", note) +
    (i.stateChangedAt && i.stateChangedBy ? row("Last moved", `${esc(who(i.stateChangedBy))}, ${ago(i.stateChangedAt, now)}`) : "") +
    "</dl>" +
    catLinks(i) +
    (closed ? "" : issueButtons(i)) +
    actionForms({ ...i, contactLeft: false, emailToReporter: null }, landed);
  if (!closed) return `<article class="${classes}" id="r-${esc(i.id)}">${body}</article>`;
  return (
    `<article class="${classes}" id="r-${esc(i.id)}">` +
    `<details${landed ? " open" : ""}><summary><span class="head">${tags}</span>` +
    `<span class="said1">${esc(reasonLabel(i.reason))}${i.cat ? ` · ${esc(i.cat.name)}` : ""}</span></summary>` +
    `<div${i.photo?.url ? ' class="has-photo"' : ""}>${body}</div></details></article>`
  );
}

/** The brake banner (D3): shown while today's report-hides are at the limit. No resume, anywhere. */
function brakeBanner(b: IssuesSection["brake"]): string {
  if (!b.on) return "";
  return (
    '<div class="banner" role="status">' +
    "<strong>Automatic hiding is paused until midnight, Athens time.</strong> " +
    `Reports hid ${b.hidesToday} ${b.hidesToday === 1 ? "photo" : "photos"} today, the most allowed in a day. ` +
    "New reports are still saved and listed here, but they won't hide a photo. You can still hide a photo yourself." +
    "</div>"
  );
}

/** How many photos a report has hidden that wait for the team: the line at the top of the page. */
export function hiddenWaitingLine(issues: IssuesSection | undefined): string {
  const n = issues?.hidden.length ?? 0;
  if (n === 0) return "";
  return (
    `<p class="notice issuewait"><a href="#issues-hidden">${esc(
      n === 1 ? "1 photo hidden by a report is waiting for you" : `${n} photos hidden by a report are waiting for you`,
    )}</a></p>`
  );
}

function issuesSection(
  issues: IssuesSection,
  now: Date,
  changedId: string | undefined,
  issueNotice: IssueNotice | undefined,
  noted: string | undefined,
): string {
  const open = issues.hidden.length + issues.needsPerson.length + issues.other.length + issues.unchecked.length;
  const group = (id: string, title: string, list: IssueReport[], empty: string, intro = "") =>
    `<h3 id="${id}">${esc(title)} (${list.length})</h3>` +
    intro +
    (list.length
      ? list.map((i) => issueCard(i, now, false, changedId, issueNotice, noted)).join("")
      : `<p class="empty">${esc(empty)}</p>`);
  const closed = issues.closed.length
    ? `<h3 id="issues-closed">Closed issues (${issues.closedTotal})</h3>` +
      issues.closed.map((i) => issueCard(i, now, true, changedId, issueNotice, noted)).join("") +
      (issues.closedTotal > issues.closed.length
        ? `<p class="empty">Showing the newest ${issues.closed.length} of ${issues.closedTotal}.</p>`
        : "")
    : "";
  return (
    `<section id="issues" class="issues"><h2>Issues (${open})</h2>` +
    '<p class="hint">Problems the public reported with a photo, a name or what a cat\'s page says. Team only: a cat guardian never sees these.</p>' +
    brakeBanner(issues.brake) +
    group("issues-hidden", "Hidden, waiting for you", issues.hidden, "None. No photo hidden by a report is waiting.") +
    group("issues-needs", "Location, and cats reported as died", issues.needsPerson, "None.") +
    group("issues-other", "Everything else", issues.other, "None.") +
    group(
      "issues-unchecked",
      "Unchecked (Cloudflare was unreachable)",
      issues.unchecked,
      "None.",
      issues.unchecked.length
        ? "<p class=\"empty\">These arrived while the safety check couldn't reach Cloudflare. None of them hid a photo.</p>"
        : "",
    ) +
    closed +
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
  island: boolean,
  /** The report whose team note was just saved (?noted=). */
  noted?: string,
  /** May the viewer tie a report to a cat (`change_report_state`)? Shows "Yes, it's X". */
  canTie = false,
  /** SYC-44 PR 7.1: the Issues section, and what an Issues action just did (?issue=&r=). */
  issues?: IssuesSection,
  issueNotice?: IssueNotice,
): string {
  const open = queue.open.length
    ? queue.open.map((r) => reportCard(r, now, false, changedId, tied, island, canTie, noted)).join("")
    : '<p class="empty">No reports are waiting for the team.</p>';
  const drafts = queue.drafts.length
    ? "<h2>Started but not sent</h2>" +
      '<p class="empty">Someone began a report and did not send it. They may still be worried about a cat here.</p>' +
      queue.drafts.map((d) => draftCard(d, now, island)).join("") +
      (queue.draftsTotal > queue.drafts.length
        ? `<p class="empty">Showing the newest ${queue.drafts.length} of ${queue.draftsTotal}.</p>`
        : "")
    : "";
  const closed = queue.closed.length
    ? `<h2>Closed (${queue.closedTotal})</h2>` +
      queue.closed.map((r) => reportCard(r, now, true, changedId, tied, island, canTie, noted)).join("") +
      (queue.closedTotal > queue.closed.length
        ? `<p class="empty">Showing the newest ${queue.closed.length} of ${queue.closedTotal}.</p>`
        : "")
    : "";
  return renderPage({
    // Named as the menu names it (SYC-450).
    title: "Queue",
    active: "queue",
    mainClass: "wide",
    personName,
    banner: mailBanner(queue.mail),
    // The Issues section comes last: never above any welfare report (§5.3).
    body:
      hiddenWaitingLine(issues) +
      `<h2>Waiting for the team (${queue.open.length})</h2>${open}${drafts}${closed}${uncheckedSection(queue, now, changedId, tied, island, canTie, noted)}` +
      (issues ? issuesSection(issues, now, changedId, issueNotice, noted) : ""),
  });
}
