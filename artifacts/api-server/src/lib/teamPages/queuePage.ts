import { keptLine } from "./signedOutPage";
import { toPublicDay } from "../catHelpers";
import type {
  EmailToReporter,
  EmailToTeam,
  MailHealth,
  QueueReport,
  TeamPerson,
  WelfareQueue,
} from "../welfareQueue";
import { CHANGED_MESSAGE, NOTE_MAX, REPORT_STATES } from "../welfareActions";
import { TIE_CHANGED_MESSAGE, TIE_SAME_MESSAGE } from "../welfareTie";
import type { IssueReport, IssuesSection } from "../issues/queue";
import { reasonLabel } from "../issues/alertEmail";
import { ISSUE_OUTCOME_TEXT } from "../issues/teamActions";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { placeLabel } from "../areas/placeLabel";
import { place } from "./position";
import { firstWords } from "./noteWords";

// The welfare queue page (SYC-43 part 2 plan, PR 1; spec §3.1, §4.2, §8.3).
// Read-only. Server-drawn, no scripts. Every value goes through escapeHtml.
//
// Not on this page, by rule (spec §3.1, §3.6, F1): nothing that hands a
// report to someone, sets a deadline, or pages anybody. Test P1-6 pins the
// words.

const STATE: Record<QueueReport["state"], string> = {
  new: "New",
  looking: "Looking at it",
  done: "Done",
  nothing_needed: "Nothing needed",
};

// The team's alert about a report (SYC-519: plain words).
const EMAIL: Record<EmailToTeam, string> = {
  sent: "We emailed the team about it",
  delivered: "We emailed the team about it, and it arrived",
  bounced: "Our email to the team didn't arrive. Nothing is lost: it's here.",
  waiting: "Our email to the team is waiting to send",
  failed: "Our email to the team didn't arrive. Nothing is lost: it's here.",
};

// SYC-42 Slice 3. Never the address: only what happened.
const REPORTER_EMAIL: Record<EmailToReporter, string> = {
  unconfirmed: "They left an email but haven't confirmed it yet.",
  confirmed: "They left an email and confirmed it.",
  waiting: "They left an email. A message to them is waiting to send.",
  sent: "They left an email. Our last message to them was sent.",
  delivered: "They left an email. Our last message to them arrived.",
  bounced: "They left an email, but our last message to them didn't arrive.",
  failed: "They left an email, but our last message to them didn't arrive.",
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
  // The Syros day (SYC-637): at 22:30 UTC it is already tomorrow on the island.
  return new Date(`${toPublicDay(iso)}T12:00:00Z`).toLocaleDateString("en-GB", {
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
  // Plain "no photo" has no tile on the row line (SYC-619 §6.2), so it is said here.
  // Still uploading, or not received, says why.
  if (r.photo.status === "pending") return `<div class="nophoto">${esc("Photo still uploading")}</div>`;
  if (r.photo.status === "failed") return `<div class="nophoto">${esc("No photo: the photo could not be received")}</div>`;
  return `<div class="nophoto">${esc("No photo")}</div>`;
}

/**
 * The usual next step, filled in so the team sees it (SYC-619 §6.1): New goes
 * to Looking at it, and Looking at it to Done. Done and Nothing needed fill
 * nothing, since reopening should be a choice. Null too when the step isn't
 * among the states offered (an issue with a hidden photo can't offer Done).
 */
export function nextStep(
  state: (typeof REPORT_STATES)[number],
  offered: readonly (typeof REPORT_STATES)[number][],
): (typeof REPORT_STATES)[number] | null {
  const to = state === "new" ? "looking" : state === "looking" ? "done" : null;
  return to && offered.includes(to) ? to : null;
}

/**
 * The two forms on a sent report (PR 2): move it, and the team note. Plain
 * forms posting to the routes in routes/teamReports.ts; the browser sends
 * the Origin the routes check. `from` is the state this page showed.
 */
function actionForms(
  r: Pick<QueueReport, "id" | "state" | "teamNote" | "contactLeft" | "emailToReporter">,
  noteOpen: boolean,
  /**
   * The states offered (default all four). SYC-44 PR 7.1: an issue whose photo
   * is still hidden is closed only by Keep hidden or Restore, so a plain
   * "Nothing needed" can't leave a privacy photo hidden with nothing listing it.
   */
  offered: readonly (typeof REPORT_STATES)[number][] = REPORT_STATES,
  closeHint = "",
  /** A team note kept while signed out (SYC-516 C3), filled in again. */
  keptNote?: string,
): string {
  const base = `/api/team/reports/${encodeURIComponent(r.id)}`;
  const next = nextStep(r.state, offered);
  const buttons = REPORT_STATES.filter((s) => s !== r.state && offered.includes(s)).map((s) =>
    `<button type="submit" name="to" value="${esc(s)}"${s === next ? ' class="go"' : ""}>${esc(STATE[s])}</button>`,
  ).join("");
  const noteId = `note-${r.id}`;
  return (
    '<div class="actions">' +
    `<form method="post" action="${esc(base)}/state">` +
    `<input type="hidden" name="from" value="${esc(r.state)}">` +
    `<p class="now">Now: ${esc(STATE[r.state])}</p>` +
    '<p class="label">Move this report to</p>' +
    closeHint +
    `<div class="states">${buttons}</div></form>` +
    // Folded away so a phone isn't mostly empty note boxes.
    `<details class="notebox"${noteOpen ? " open" : ""}><summary>${r.teamNote ? "Change the team note" : "Add a team note"}</summary>` +
    `<form method="post" action="${esc(base)}/note">` +
    `<label class="label" for="${esc(noteId)}">Team note ` +
    '<span class="hint">Team only. Never shown to the reporter.</span></label>' +
    // The first newline after <textarea> is dropped by browsers, so one is
    // added to keep a note that starts with a blank line as written.
    `<textarea id="${esc(noteId)}" name="note" rows="3" maxlength="${NOTE_MAX}">\n${esc(keptNote ?? r.teamNote ?? "")}</textarea>` +
    '<button type="submit" class="save">Save note</button></form></details>' +
    "</div>"
  );
}

/** A team note that wasn't saved because the sign-in lapsed (SYC-516 C3), for one report. */
export type KeptNote = { id: string; note: string };


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

export interface ReportRowOptions {
  /** Is the fold open? (Just acted on, tied, noted, or linked with ?open=.) */
  open: boolean;
  /** Island-wide viewer: Open map on the position. */
  island: boolean;
  /** A closed report (Done / Nothing needed). */
  closed: boolean;
  /** Notice paragraphs shown at the top of the body (already escaped HTML). */
  notices: string;
  /** May the viewer tie a report to a cat? Shows "Yes, it's X". */
  canTie?: boolean;
  /** Open the team-note fold too. */
  noteOpen?: boolean;
  /** Kept team-note text to fill the box with (SYC-516 C3). */
  keptNote?: string;
}

/** What differs between a welfare row and an Issues row: the first line's pieces, and the opened body. */
interface RowParts {
  /** Extra classes on the <article> ("urgent", "issue"). */
  classes: string[];
  thumbUrl: string | null;
  /** The line's bold words: the place, or what's wrong. Plain text. */
  where: string;
  /** Tag chips on the first line (already escaped HTML). */
  tags: string;
  /** The second line: the first words they said. Plain text. */
  said: string;
  /** Everything inside the fold (already escaped HTML). */
  body: string;
}

/** An Issues row ("Report an issue", SYC-44 PR 7.1) rather than a welfare report. */
const isIssue = (r: QueueReport | IssueReport): r is IssueReport => "reason" in r && "group" in r;

/**
 * One report as one line that opens in place (SYC-519; spec §5): photo, place,
 * how long ago, the first words they said, and its state. The body holds
 * everything: the full note, which cat, contact, team note and the buttons. It
 * is a plain <details>, no script. The anchor stays on the <article>, outside
 * the fold, so old #r-<id> links still scroll to it. The one row for every
 * report on the page: the Issues section (SYC-44 PR 7.1) draws its rows here
 * too, with what's wrong in place of the place name.
 */
export function reportRow(r: QueueReport | IssueReport, now: Date, opts: ReportRowOptions): string {
  const p = isIssue(r) ? issueParts(r, now, opts) : welfareParts(r, now, opts);
  const classes = ["report", ...p.classes, opts.closed ? "closed" : ""].filter(Boolean).join(" ");
  const thumb = p.thumbUrl
    ? `<img class="hthumb" src="${esc(p.thumbUrl)}" alt="" loading="lazy" width="56" height="56">`
    : "";
  const line =
    `<summary class="rowline">${thumb}<span class="rtext">` +
    `<span class="rwhere"><strong>${esc(p.where)}</strong> · ${ago(r.at, now)}${p.tags ? ` ${p.tags}` : ""}</span>` +
    `<span class="said1">${p.said ? esc(p.said) : "Nothing written"}</span></span>` +
    `<span class="rtags"><span class="tag state">${esc(STATE[r.state])}</span></span></summary>`;
  return (
    `<article class="${classes}" id="r-${esc(r.id)}">` +
    `<details${opts.open ? " open" : ""}>${line}<div class="rbody">${p.body}</div></details></article>`
  );
}

function welfareParts(r: QueueReport, now: Date, opts: ReportRowOptions): RowParts {
  // Urgent, kittens and unchecked sit on the first line; the state is the chip on the right.
  const tags =
    (r.severity === "urgent" ? '<span class="tag urgent">Urgent</span>' : "") +
    (r.isLitter ? '<span class="tag kittens">Kittens</span>' : "") +
    (r.unchecked ? '<span class="tag unchecked">Unchecked</span>' : "");
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
    opts.notices +
    "<dl>" +
    row("Where", place(r.lat, r.lng, { link: opts.island })) +
    row(
      "What they said",
      r.note
        ? `<span class="note">${esc(r.note)}</span>`
        : '<span class="ago">Nothing written</span>',
    ) +
    catRow(r, opts.canTie === true) +
    row(
      "Their email",
      r.emailToReporter
        ? `<span${r.emailToReporter === "bounced" || r.emailToReporter === "failed" ? ' class="bad"' : ""}>${esc(REPORTER_EMAIL[r.emailToReporter])}</span>`
        : "No email left",
    ) +
    row("Team note", note) +
    moved +
    row("Team alert", email) +
    "</dl>" +
    actionForms(r, opts.noteOpen === true, REPORT_STATES, "", opts.keptNote);
  return {
    classes: [r.severity === "urgent" ? "urgent" : ""],
    thumbUrl: r.photo.url,
    where: placeLabel(r),
    tags,
    said: firstWords(r.note),
    body,
  };
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
  kept?: KeptNote,
  open?: string,
): string {
  const keptNote = kept !== undefined && r.id === kept.id ? kept.note : undefined;
  const landed =
    r.id === changedId || r.id === noted || (tied !== undefined && r.id === tied.id) || keptNote !== undefined;
  const notices =
    (r.id === changedId
      ? `<p class="notice" role="status">${esc(CHANGED_MESSAGE)}</p>`
      : "") +
    // Own keys only: ?tied=constructor must not reach Object.prototype.
    (tied && r.id === tied.id && Object.hasOwn(TIED_TEXT, tied.key)
      ? `<p class="notice" role="status">${esc(TIED_TEXT[tied.key]!)}</p>`
      : "") +
    (r.id === noted ? '<p class="notice" role="status">Saved. The team note is updated.</p>' : "");
  return reportRow(r, now, {
    open: landed || r.id === open,
    island,
    closed,
    notices,
    canTie,
    noteOpen: landed,
    keptNote,
  });
}

/**
 * SYC-170 (spec §9.5, §5.3): reports accepted while Cloudflare's check was
 * unreachable, in their own list below every checked report, newest first.
 * SYC-519: nothing at all when there are none, and plain words when there are.
 */
function uncheckedSection(
  queue: WelfareQueue,
  now: Date,
  changedId: string | undefined,
  tied: TiedNotice | undefined,
  island: boolean,
  canTie: boolean,
  noted: string | undefined,
  kept?: KeptNote,
  open?: string,
): string {
  const { reports, reportsTotal } = queue.unchecked;
  if (reportsTotal === 0) return "";
  return (
    `<section id="unchecked"><h2>Arrived while our spam check was down (${reportsTotal})</h2>` +
    `<p class="empty">${esc("Our spam check couldn't be reached when these arrived. Most are real; check before acting.")}</p>` +
    reports.map((r) => reportCard(r, now, false, changedId, tied, island, canTie, noted, kept, open)).join("") +
    (reportsTotal > reports.length
      ? `<p class="empty">Showing the newest ${reports.length} of ${reportsTotal}.</p>`
      : "") +
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
  unchecked: "Not hidden: our spam check couldn't be reached when this was sent",
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
  // A report that carries a photo opens the Photos tab, so the photos are in front of you (SYC-655 §3.2).
  const open = i.photo ? `${page}#tab-photos` : page;
  const links = [`<a class="tap" href="${esc(open)}">Open the cat's page</a>`];
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

/** An Issues row's line and body (SYC-44 PR 7.1, §5.3–5.4), drawn by reportRow. */
function issueParts(i: IssueReport, now: Date, opts: ReportRowOptions): RowParts {
  // The "Issue" label on every row, beside the colour band: never colour alone (T7-2).
  const tags =
    '<span class="tag issue">Issue</span>' +
    (i.photo?.hidden ? '<span class="tag hiddennow">Photo hidden</span>' : "") +
    (i.unchecked ? '<span class="tag unchecked">Unchecked</span>' : "");
  const photo = i.photo?.url
    ? `<a class="photolink" href="${esc(i.photo.url)}">` +
      `<img class="photo" src="${esc(i.photo.url)}" alt="The reported photo" loading="lazy"></a>`
    : i.photo?.removed
      ? '<div class="nophoto">The photo was deleted for good</div>'
      : "";
  const note = i.teamNote
    ? `<span class="note">${esc(i.teamNote)}</span>` +
      (i.teamNoteBy && i.teamNoteAt ? ` <span class="ago">${esc(who(i.teamNoteBy))}, ${ago(i.teamNoteAt, now)}</span>` : "")
    : '<span class="ago">None yet</span>';
  const forms = { ...i, contactLeft: false, emailToReporter: null };
  const body =
    photo +
    opts.notices +
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
    (opts.closed ? "" : issueButtons(i)) +
    (i.photo?.hidden && !i.photo.removed && !opts.closed
      ? actionForms(forms, opts.noteOpen === true, ["new", "looking"],
          '<p class="hint">To close it, keep the photo hidden or restore it, above.</p>', opts.keptNote)
      : actionForms(forms, opts.noteOpen === true, REPORT_STATES, "", opts.keptNote));
  return {
    classes: ["issue"],
    thumbUrl: i.photo?.url ?? null,
    where: reasonLabel(i.reason),
    tags,
    said: [i.cat?.name ?? "", firstWords(i.note)].filter(Boolean).join(" · "),
    body,
  };
}

function issueCard(
  i: IssueReport,
  now: Date,
  closed: boolean,
  changedId: string | undefined,
  issueNotice: IssueNotice | undefined,
  noted: string | undefined,
  kept?: KeptNote,
  openId?: string,
): string {
  const keptNote = kept !== undefined && i.id === kept.id ? kept.note : undefined;
  // An Issues action's notice (?issue=&r=) opens its row too, in view.
  const landed = i.id === changedId || i.id === noted || i.id === issueNotice?.id || keptNote !== undefined;
  const notices =
    (i.id === changedId ? `<p class="notice" role="status">${esc(CHANGED_MESSAGE)}</p>` : "") +
    (issueNotice && i.id === issueNotice.id && Object.hasOwn(ISSUE_OUTCOME_TEXT, issueNotice.key)
      ? `<p class="notice" role="status">${esc(ISSUE_OUTCOME_TEXT[issueNotice.key as keyof typeof ISSUE_OUTCOME_TEXT])}</p>`
      : "") +
    (i.id === noted ? '<p class="notice" role="status">Saved. The team note is updated.</p>' : "");
  return reportRow(i, now, {
    open: landed || i.id === openId,
    island: false,
    closed,
    notices,
    noteOpen: landed,
    keptNote,
  });
}

/** The brake banner (D3): shown while today's report-hides are at the limit. No resume, anywhere. */
function brakeBanner(b: IssuesSection["brake"]): string {
  if (!b.on) return "";
  return (
    // Its own class beside "banner": the page's mail-failure banner is the
    // only plain "banner" (tests look for it), and this one lives in the section.
    '<div class="banner brake" role="status">' +
    "<strong>Automatic hiding is paused until midnight, Athens time.</strong> " +
    `Reports hid ${b.hidesToday} ${b.hidesToday === 1 ? "photo" : "photos"} today, the most allowed in a day. ` +
    "New reports are still saved and listed here, but they won't hide a photo. You can still hide a photo yourself." +
    "</div>"
  );
}

/** How many photos a report has hidden that wait for the team: the line at the top of the page. */
export function hiddenWaitingLine(issues: IssuesSection | undefined): string {
  const n = issues?.totals.hidden ?? 0;
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
  kept?: KeptNote,
  openId?: string,
): string {
  const t = issues.totals;
  const open = t.hidden + t.needsPerson + t.other + t.unchecked;
  const group = (id: string, title: string, list: IssueReport[], total: number, empty: string, intro = "") =>
    `<h3 id="${id}">${esc(title)} (${total})</h3>` +
    intro +
    (list.length
      ? list.map((i) => issueCard(i, now, false, changedId, issueNotice, noted, kept, openId)).join("") +
        (total > list.length ? `<p class="empty">Showing ${list.length} of ${total}.</p>` : "")
      : `<p class="empty">${esc(empty)}</p>`);
  const closed = issues.closed.length
    ? `<h3 id="issues-closed">Closed issues (${issues.closedTotal})</h3>` +
      issues.closed.map((i) => issueCard(i, now, true, changedId, issueNotice, noted, kept, openId)).join("") +
      (issues.closedTotal > issues.closed.length
        ? `<p class="empty">Showing the newest ${issues.closed.length} of ${issues.closedTotal}.</p>`
        : "")
    : "";
  return (
    `<section id="issues" class="issues"><h2>Issues (${open})</h2>` +
    '<p class="hint">Problems the public reported with a photo, a name or what a cat\'s page says. Team only: a cat guardian never sees these.</p>' +
    brakeBanner(issues.brake) +
    group("issues-hidden", "Hidden, waiting for you", issues.hidden, t.hidden, "None. No photo hidden by a report is waiting.") +
    group("issues-needs", "Location, and cats reported as died", issues.needsPerson, t.needsPerson, "None.") +
    group("issues-other", "Everything else", issues.other, t.other, "None.") +
    // SYC-519: like the welfare list's, nothing at all when there are none.
    (t.unchecked > 0
      ? group(
          "issues-unchecked",
          "Arrived while our spam check was down",
          issues.unchecked,
          t.unchecked,
          "None.",
          `<p class="empty">${esc("Our spam check couldn't be reached when these arrived. None of them hid a photo.")}</p>`,
        )
      : "") +
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
    "Please email hello@catspotters.com." +
    "</div>"
  );
}

/**
 * The reports whose cards this page draws (each with its note form): open,
 * closed and unchecked, and the Issues section's rows (SYC-44 PR 7.1). A kept
 * note is used only for one of these (SYC-516 C3), so a row is never used up
 * with no card to show it.
 */
export function drawnReportIds(queue: WelfareQueue, issues?: IssuesSection): Set<string> {
  const issueRows = issues
    ? [...issues.hidden, ...issues.needsPerson, ...issues.other, ...issues.unchecked, ...issues.closed]
    : [];
  return new Set([...queue.open, ...queue.closed, ...queue.unchecked.reports, ...issueRows].map((r) => r.id));
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
  /** A team note kept while signed out (SYC-516 C3): that card opens with it filled in. */
  kept?: KeptNote,
  /** A report to open (?open=), already checked against the id shape. Matches no report: nothing happens. */
  openId?: string,
  /** SYC-44 PR 7.1: the Issues section, and what an Issues action just did (?issue=&r=). */
  issues?: IssuesSection,
  issueNotice?: IssueNotice,
): string {
  const openList = queue.open.length
    ? queue.open.map((r) => reportCard(r, now, false, changedId, tied, island, canTie, noted, kept, openId)).join("")
    : '<p class="empty">No reports are waiting for the team.</p>';
  const closed = queue.closed.length
    ? `<h2>Closed (${queue.closedTotal})</h2>` +
      queue.closed.map((r) => reportCard(r, now, true, changedId, tied, island, canTie, noted, kept, openId)).join("") +
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
      (kept ? keptLine() : "") +
      hiddenWaitingLine(issues) +
      `<h2>Waiting for the team (${queue.open.length})</h2>${openList}${closed}${uncheckedSection(queue, now, changedId, tied, island, canTie, noted, kept, openId)}` +
      (issues ? issuesSection(issues, now, changedId, issueNotice, noted, kept, openId) : ""),
  });
}
