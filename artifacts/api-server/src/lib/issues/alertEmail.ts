import type { WelfareReport } from "@workspace/db";
import { escapeHtml, type MailAttachment } from "../mail/send";
import { publicAppOrigin } from "../keepSafe/links";

/**
 * The "Report an issue" emails to the shared inbox (SYC-44 PR 5.2; spec §5.2).
 *
 * Two emails, both under the `issue_alert` purpose, both built here from our
 * own text. Everything a reporter typed is escaped in the HTML part, and no
 * subject carries anything typed.
 *
 * - **Photo hidden** (one per report, at most 10 an hour): the reason, the
 *   reporter's note, the cat's name with a team link, and the reported photo
 *   as an ATTACHMENT, shown inline through `cid:` (the welfare alert's rule: a
 *   team link fails in a mailbox, and a public link would be wrong for a photo
 *   that was just hidden).
 * - **The daily digest** (`Issue reports: N waiting`): reasons and cats with
 *   team links, and NO notes.
 *
 * **No reporter details of any kind.** There is no email box on this form
 * (decision D9), and the builder is handed only the report's content, the
 * cat's name and the photo, never the device or the address. It takes no
 * arguments that could carry them.
 */

export const ISSUE_PHOTO_HIDDEN_SUBJECT = "Photo hidden: possible private or offensive content";

/** The reason keys in the words the team reads (the screen's wording is the app's, in §2). */
export const ISSUE_REASON_LABELS: Record<string, string> = {
  photo_private: "It shows a person or a private place",
  photo_inappropriate: "It's upsetting or offensive",
  photo_not_cat: "That's not a cat",
  wrong_cat: "That's a different cat",
  wrong_name: "The name is wrong, or not OK",
  wrong_info: "Something else about this cat is wrong",
  location_revealing: "The map spot or the words show where someone lives",
  cat_died: "This cat has died",
  other: "Something else",
};

export function reasonLabel(reason: string | null): string {
  return (reason && ISSUE_REASON_LABELS[reason]) || "Something else";
}

/** The cat's team page. Built from the fixed public origin, never from a request. */
export function teamCatUrl(catId: number): string {
  return `${publicAppOrigin()}/api/team/cats/${catId}`;
}

/** The photo as it arrives from the outbox: the bytes, if they are still there. */
export type IssuePhoto = { bytes: Buffer; mime: string } | null;

/** The inline photo's content id, referenced from the HTML as `cid:reported-photo`. */
export const ISSUE_PHOTO_CONTENT_ID = "reported-photo";

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function page(subject: string, preheader: string, body: string): string {
  const esc = escapeHtml;
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#F2F4F7">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F2F4F7"><tr><td align="center" style="padding:16px 8px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" bgcolor="#FFFFFF" style="width:100%;max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden;font-family:${FONT}">` +
    body +
    `</table>` +
    `<div style="max-width:560px;padding:12px 8px 0;color:#98A2B3;font-size:12px;line-height:1.5;font-family:${FONT}">Sent by Cat Spotters for Syros Cats.</div>` +
    `</td></tr></table></body></html>`
  );
}

const BAND =
  `<tr><td bgcolor="#475467" style="padding:18px 24px;background:#475467;color:#FFFFFF">` +
  `<div style="font-size:13px;letter-spacing:0.04em;text-transform:uppercase;opacity:0.9">Report an issue</div>`;

/**
 * The "Photo hidden" alert for one report. `cat` is null only if the cat has
 * since gone; `photo` is null when the photo's bytes are gone (deleted for
 * good), and the email then says so in a line instead of attaching it.
 */
export function buildIssueAlert(
  report: Pick<WelfareReport, "publicId" | "reason" | "note" | "createdAt" | "submittedAt">,
  cat: { id: number; name: string } | null,
  photo: IssuePhoto,
): { subject: string; text: string; html: string; attachments?: MailAttachment[] } {
  const esc = escapeHtml;
  const subject = ISSUE_PHOTO_HIDDEN_SUBJECT;
  const label = reasonLabel(report.reason);
  const note = report.note?.trim() ?? "";
  const catName = cat?.name ?? "(this cat is no longer in the catalogue)";
  const catUrl = cat ? teamCatUrl(cat.id) : null;
  const photoLine = photo
    ? "The reported photo is attached."
    : "The reported photo is no longer available: its bytes have been deleted.";

  const text = [
    "A photo has been hidden from the public while the team takes a look.",
    "",
    `Why: ${label}`,
    `What they wrote: ${note || "(nothing written)"}`,
    "",
    `Cat: ${catName}`,
    ...(catUrl ? [`Team page: ${catUrl}`] : []),
    photoLine,
    `Report: ${report.publicId}`,
    "",
    "Sent by Cat Spotters for Syros Cats.",
  ].join("\n");

  const fact = (k: string, v: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#667085;font-size:14px;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;color:#101828;font-size:14px;vertical-align:top">${v}</td></tr>`;

  const photoBlock = photo
    ? `<tr><td style="padding:0"><img src="cid:${ISSUE_PHOTO_CONTENT_ID}" alt="The reported photo" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0"></td></tr>`
    : `<tr><td style="padding:14px 24px 0;color:#B54708;font-size:14px">${esc(photoLine)}</td></tr>`;

  const body =
    BAND +
    `<div style="font-size:22px;font-weight:700;line-height:1.25">${esc("Photo hidden")}</div>` +
    `<div style="font-size:15px;line-height:1.4">${esc("Hidden from the public until the team decides.")}</div>` +
    `</td></tr>` +
    photoBlock +
    `<tr><td style="padding:20px 24px 0">` +
    `<div style="color:#667085;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 6px">${esc("Why they reported it")}</div>` +
    `<div style="color:#101828;font-size:16px;line-height:1.5">${esc(label)}</div>` +
    (note
      ? `<div style="margin-top:10px;border-left:3px solid #475467;padding:2px 0 2px 12px;color:#101828;font-size:16px;line-height:1.5;white-space:pre-wrap">${esc(note)}</div>`
      : `<div style="margin-top:10px;color:#667085;font-size:15px;font-style:italic">Nothing written.</div>`) +
    `</td></tr>` +
    `<tr><td style="padding:14px 24px 22px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">` +
    fact("Cat", catUrl ? `<a href="${esc(catUrl)}" style="color:#1D4ED8">${esc(catName)}</a>` : esc(catName)) +
    fact("Report", esc(report.publicId)) +
    `</table></td></tr>`;

  const html = page(subject, `${label} · ${catName}`, body);
  const attachments = photo
    ? [
        {
          filename: `reported-photo-${report.publicId.slice(0, 8)}.${photo.mime === "image/png" ? "png" : "jpg"}`,
          content: photo.bytes,
          contentId: ISSUE_PHOTO_CONTENT_ID,
        },
      ]
    : undefined;
  return { subject, text, html, attachments };
}

/** One line of the digest: how many open reports share a reason and a cat. */
export type IssueDigestItem = { reason: string; catId: number | null; catName: string | null; count: number };

/**
 * The daily "N waiting" digest: reasons and cats with team links, never a
 * note. The items are fixed when the digest is queued, so a retry sends the
 * same body under the same idempotency key.
 */
export function buildIssueDigest(
  waiting: number,
  items: IssueDigestItem[],
): { subject: string; text: string; html: string } {
  const esc = escapeHtml;
  const subject = `Issue reports: ${waiting} waiting`;
  const line = (i: IssueDigestItem) => {
    const times = i.count > 1 ? ` (${i.count})` : "";
    const who = i.catId !== null ? `${i.catName ?? "A cat"} - ${teamCatUrl(i.catId)}` : "a cat that is no longer in the catalogue";
    return `${reasonLabel(i.reason)}${times}: ${who}`;
  };
  const text = [
    `${waiting} issue report${waiting === 1 ? " is" : "s are"} waiting for the team.`,
    "",
    ...items.map((i) => `- ${line(i)}`),
    "",
    "They are in the dashboard, in the Issues section. Notes are not shown here.",
    "",
    "Sent by Cat Spotters for Syros Cats.",
  ].join("\n");
  const rows = items
    .map((i) => {
      const times = i.count > 1 ? ` (${i.count})` : "";
      const who =
        i.catId !== null
          ? `<a href="${esc(teamCatUrl(i.catId))}" style="color:#1D4ED8">${esc(i.catName ?? "A cat")}</a>`
          : "a cat that is no longer in the catalogue";
      return `<tr><td style="padding:6px 24px;color:#101828;font-size:15px;line-height:1.4">${esc(reasonLabel(i.reason) + times)}: ${who}</td></tr>`;
    })
    .join("");
  const body =
    BAND +
    `<div style="font-size:22px;font-weight:700;line-height:1.25">${esc(`${waiting} waiting`)}</div>` +
    `</td></tr>` +
    rows +
    `<tr><td style="padding:14px 24px 22px;color:#475467;font-size:13px;line-height:1.5">${esc("They are in the dashboard, in the Issues section. Notes are not shown here.")}</td></tr>`;
  return { subject, text, html: page(subject, `${waiting} waiting`, body) };
}
