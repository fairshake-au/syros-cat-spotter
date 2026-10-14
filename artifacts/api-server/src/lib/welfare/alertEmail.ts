import type { WelfareReport } from "@workspace/db";
import { escapeHtml, type MailAttachment } from "../mail/send";

/**
 * The welfare alert to Syros Cats' shared inbox (SYC-42 plan, Slice 1 item
 * 1.5; spec §4.3).
 *
 * - Distinct subjects for urgent and needs-attention, so the inbox can filter
 *   on them (Decision 1 A: Syros Cats may set their own Gmail notification;
 *   nothing here pages anyone).
 * - The photo travels as an ATTACHMENT, never a link: a link into the team
 *   route would fail in a mailbox, and a public link would put the one
 *   restricted photo outside the gate (spec §4.3). It is also shown inline,
 *   through the attachment's content id (`cid:`), so a volunteer sees the cat
 *   without opening anything.
 * - No reporter contact. Slice 1 collects none (Decision 4).
 * - Everything the reporter typed is escaped in the HTML part; nothing typed
 *   goes into a header (the subject is fixed text).
 *
 * Layout (designed 3 Oct 2026, for a volunteer reading Gmail on a phone):
 * severity first, then the photo, then what the person saw, then one-tap map
 * buttons, then the details, then what the reporter was told. Table layout and
 * inline styles only, so it holds up in Gmail, Apple Mail and Outlook.
 */

export type AlertKind = "alert" | "photo";

export type AlertPhoto = { bytes: Buffer; mime: string };

/** The inline photo's content id, referenced from the HTML as `cid:cat-photo`. */
export const PHOTO_CONTENT_ID = "cat-photo";

export function alertSubject(
  report: Pick<WelfareReport, "severity" | "isLitter">,
  kind: AlertKind,
): string {
  const base =
    report.severity === "urgent"
      ? "Urgent cat report: badly hurt or in danger"
      : "Cat report: needs attention";
  const litter = report.isLitter ? " · kittens" : "";
  return `${base}${litter}${kind === "photo" ? " (photo)" : ""}`;
}

function athensTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Athens",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function mapLinks(lat: number, lng: number) {
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    apple: `https://maps.apple.com/?ll=${lat},${lng}&q=Cat%20report`,
  };
}

const LANGUAGE_NAMES: Record<string, string> = { en: "English", el: "Greek", fr: "French" };

function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

type Palette = { band: string; bandText: string; label: string; summary: string };

const URGENT: Palette = {
  band: "#B42318",
  bandText: "#FFFFFF",
  label: "Urgent",
  summary: "Badly hurt, collapsed, or in danger right now",
};
const ATTENTION: Palette = {
  band: "#B54708",
  bandText: "#FFFFFF",
  label: "Needs attention",
  summary: "Thin, limping, sore eye, or just not right",
};

function photoStatus(report: WelfareReport, photo: AlertPhoto | null): string {
  if (photo) return "Photo: attached.";
  if (report.photoState === "none") return "No photo was taken.";
  if (report.photoState === "failed") return "The photo couldn't be received, so this alert has none.";
  return "The photo is still uploading.";
}

/**
 * What the app showed the reporter before they sent it (spec §5.3(b) for
 * urgent, §5.3(c) for needs attention), so the team knows where things stand.
 */
function whatTheyWereTold(severity: string): string {
  return severity === "urgent"
    ? "The reporter was shown the advice for a badly hurt cat: take it to a vet, with the three Syros clinics' numbers. They were told that Syros Cats is a private sanctuary, not an emergency service, and can't provide immediate rescue or collection."
    : "The reporter was told that this goes to a small charity, not a rescue service; that nobody is on duty and it may be a few days before someone reads it; and that a vet is the fastest help if the cat gets worse.";
}

export function buildWelfareAlert(
  report: WelfareReport,
  photo: AlertPhoto | null,
  kind: AlertKind,
  /**
   * Whether to include the Google and Apple map links. The mail outbox passes
   * false within 50 m of a feeding site, and whenever the distance check
   * fails (SYC-245, SYC-209 Decision 2B). Required, so no caller can get the
   * links by forgetting. When false the email leaves the links out silently:
   * no sentence in it may say why, because a line about a feeding site would
   * itself tell the mail provider where one is.
   */
  withMapLinks: boolean,
): { subject: string; text: string; html: string; attachments?: MailAttachment[] } {
  const subject = alertSubject(report, kind);
  const links = mapLinks(report.lat, report.lng);
  const mapTextLines = withMapLinks
    ? [`Google Maps: ${links.google}`, `Apple Maps: ${links.apple}`]
    : [];
  const when = `${athensTime(report.submittedAt ?? report.createdAt)} (Athens time)`;
  const palette = report.severity === "urgent" ? URGENT : ATTENTION;
  const status = photoStatus(report, photo);
  const typed = report.note?.trim() ?? "";
  const coords = `${report.lat}, ${report.lng}`;
  const language = languageName(report.reporterLanguage);

  // ---- Plain text: the same order as the HTML, for clients that show text.
  const textLines =
    kind === "photo"
      ? [
          `${palette.label.toUpperCase()}${report.isLitter ? " · KITTENS" : ""}: the photo for this report has now arrived. It is attached.`,
          "",
          `Where (exact): ${coords}`,
          ...mapTextLines,
          `Report: ${report.publicId}`,
        ]
      : [
          `${palette.label.toUpperCase()}: ${palette.summary}.`,
          ...(report.isLitter ? ["Kittens: yes, kittens or a mother with kittens."] : []),
          "",
          `What they saw: ${typed || "(nothing written)"}`,
          "",
          `Where (exact): ${coords}`,
          ...mapTextLines,
          "",
          `When: ${when}`,
          status,
          `Language: ${language}`,
          "No contact details were left.",
          `Report: ${report.publicId}`,
          "",
          whatTheyWereTold(report.severity),
          "",
          "Sent by Cat Spotters for Syros Cats.",
        ];
  const text = textLines.join("\n");

  // ---- HTML
  const esc = escapeHtml;
  const preheader =
    kind === "photo"
      ? "The photo for this report has arrived."
      : `${palette.label}${report.isLitter ? " · kittens" : ""} · ${when}${photo ? " · photo attached" : ""}`;

  const pill = (label: string) =>
    `<span style="display:inline-block;margin:6px 0 0;padding:2px 10px;border-radius:999px;background:#FFFFFF;color:${palette.band};font-size:13px;font-weight:600">${esc(label)}</span>`;

  const button = (href: string, label: string) =>
    `<td style="padding:0 8px 0 0"><a href="${esc(href)}" style="display:inline-block;padding:11px 16px;border-radius:8px;background:#1D4ED8;color:#FFFFFF;font-size:15px;font-weight:600;text-decoration:none">${esc(label)}</a></td>`;

  const fact = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#667085;font-size:14px;vertical-align:top;white-space:nowrap">${esc(label)}</td><td style="padding:6px 0;color:#101828;font-size:14px;vertical-align:top">${esc(value)}</td></tr>`;

  // With no photo, a banner line only when there's something to know (still
  // uploading, or couldn't be received); "no photo was taken" sits in the
  // details alone, so it isn't said twice.
  const photoBlock = photo
    ? `<tr><td style="padding:0"><img src="cid:${PHOTO_CONTENT_ID}" alt="Photo of the cat from the report" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0"></td></tr>`
    : report.photoState === "none"
      ? ""
      : `<tr><td style="padding:14px 24px 0;color:#B54708;font-size:14px">${esc(status)}</td></tr>`;

  const band =
    `<tr><td bgcolor="${palette.band}" style="padding:18px 24px;background:${palette.band};color:${palette.bandText}">` +
    `<div style="font-size:13px;letter-spacing:0.04em;text-transform:uppercase;opacity:0.9">Cat report</div>` +
    `<div style="font-size:22px;font-weight:700;line-height:1.25">${esc(palette.label)}</div>` +
    `<div style="font-size:15px;line-height:1.4">${esc(kind === "photo" ? "The photo for this report has now arrived." : palette.summary)}</div>` +
    (report.isLitter ? pill("Kittens, or a mother with kittens") : "") +
    `</td></tr>`;

  const mapButtons = !withMapLinks
    ? ""
    : `<tr><td style="padding:18px 24px 4px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    button(links.google, "Open in Google Maps") +
    button(links.apple, "Apple Maps") +
    `</tr></table></td></tr>`;

  const body =
    kind === "photo"
      ? band +
        photoBlock +
        mapButtons +
        `<tr><td style="padding:12px 24px 22px"><table role="presentation" cellpadding="0" cellspacing="0" border="0">` +
        fact("Where", coords) +
        fact("Report", report.publicId) +
        `</table></td></tr>`
      : band +
        photoBlock +
        `<tr><td style="padding:20px 24px 0">` +
        `<div style="color:#667085;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 6px">What they saw</div>` +
        (typed
          ? `<div style="border-left:3px solid ${palette.band};padding:2px 0 2px 12px;color:#101828;font-size:16px;line-height:1.5;white-space:pre-wrap">${esc(typed)}</div>`
          : `<div style="color:#667085;font-size:15px;font-style:italic">Nothing written.</div>`) +
        `</td></tr>` +
        mapButtons +
        `<tr><td style="padding:14px 24px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">` +
        fact("When", when) +
        fact("Where (exact)", coords) +
        fact("Photo", photo ? "Attached, and shown above." : status) +
        fact("Language", language) +
        fact("Contact", "No contact details were left.") +
        fact("Report", report.publicId) +
        `</table></td></tr>` +
        `<tr><td style="padding:16px 24px 22px"><div style="border-top:1px solid #EAECF0;padding-top:14px;color:#475467;font-size:13px;line-height:1.5">${esc(whatTheyWereTold(report.severity))}</div></td></tr>`;

  const html =
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#F2F4F7">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F2F4F7"><tr><td align="center" style="padding:16px 8px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" bgcolor="#FFFFFF" style="width:100%;max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">` +
    body +
    `</table>` +
    `<div style="max-width:560px;padding:12px 8px 0;color:#98A2B3;font-size:12px;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">Sent by Cat Spotters for Syros Cats.</div>` +
    `</td></tr></table></body></html>`;

  const attachments = photo
    ? [
        {
          filename: `cat-report-${report.publicId.slice(0, 8)}.${photo.mime === "image/png" ? "png" : "jpg"}`,
          content: photo.bytes,
          contentId: PHOTO_CONTENT_ID,
        },
      ]
    : undefined;
  return { subject, text, html, attachments };
}
