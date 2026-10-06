import type {
  EmailToTeam,
  MailHealth,
  QueueDraft,
  QueueReport,
  TeamPerson,
  WelfareQueue,
} from "../welfareQueue";
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
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
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

const place = (lat: number, lng: number) => {
  const here = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  // A plain link: leaving the dashboard sends nothing until it is tapped.
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

function reportCard(r: QueueReport, now: Date, closed: boolean): string {
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
    `<div class="head">${tags}</div>` +
    "<dl>" +
    row("Where", place(r.lat, r.lng)) +
    row(
      "What they said",
      r.note
        ? `<span class="note">${esc(r.note)}</span>`
        : '<span class="ago">Nothing written</span>',
    ) +
    row("Contact left", "No") +
    row("Team note", note) +
    moved +
    row("Email to Syros Cats", email) +
    "</dl></article>"
  );
}

function draftCard(d: QueueDraft, now: Date): string {
  return (
    `<article class="report draft${d.severity === "urgent" ? " urgent" : ""}" id="d-${esc(d.id)}">` +
    '<div class="head">' +
    `<span class="tag${d.severity === "urgent" ? " urgent" : ""}">${esc(SEVERITY[d.severity])}</span>` +
    `<span class="ago">started ${ago(d.startedAt, now)}</span></div>` +
    `<dl>${row("Where", place(d.lat, d.lng))}</dl></article>`
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
): string {
  const open = queue.open.length
    ? queue.open.map((r) => reportCard(r, now, false)).join("")
    : '<p class="empty">No reports are waiting for the team.</p>';
  const drafts = queue.drafts.length
    ? "<h2>Started but not sent</h2>" +
      '<p class="empty">Someone began a report and did not send it. They may still be worried about a cat here.</p>' +
      queue.drafts.map((d) => draftCard(d, now)).join("")
    : "";
  const closed = queue.closed.length
    ? `<h2>Closed (${queue.closedTotal})</h2>` +
      queue.closed.map((r) => reportCard(r, now, true)).join("") +
      (queue.closedTotal > queue.closed.length
        ? `<p class="empty">Showing the newest ${queue.closed.length} of ${queue.closedTotal}.</p>`
        : "")
    : "";
  return renderPage({
    title: "Welfare queue",
    active: "queue",
    personName,
    banner: mailBanner(queue.mail),
    body: `<h2>Waiting for the team (${queue.open.length})</h2>${open}${drafts}${closed}`,
  });
}
