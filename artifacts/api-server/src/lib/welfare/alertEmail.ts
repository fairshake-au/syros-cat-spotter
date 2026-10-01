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
 *   restricted photo outside the gate (spec §4.3).
 * - No reporter contact. Slice 1 collects none (Decision 4).
 * - Everything the reporter typed is escaped in the HTML part; nothing typed
 *   goes into a header (the subject is fixed text).
 */

export type AlertKind = "alert" | "photo";

export type AlertPhoto = { bytes: Buffer; mime: string };

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
    day: "numeric",
    month: "short",
    year: "numeric",
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

export function buildWelfareAlert(
  report: WelfareReport,
  photo: AlertPhoto | null,
  kind: AlertKind,
): { subject: string; text: string; html: string; attachments?: MailAttachment[] } {
  const subject = alertSubject(report, kind);
  const links = mapLinks(report.lat, report.lng);
  const when = athensTime(report.submittedAt ?? report.createdAt);
  const severityLine =
    report.severity === "urgent"
      ? "Urgent: badly hurt, collapsed, or in danger right now."
      : "Needs attention: thin, limping, sore eye, or just not right.";
  const photoLine = photo
    ? "Photo: attached."
    : report.photoState === "none"
      ? "No photo was taken."
      : "The photo is still uploading.";
  const note = report.note?.trim() ? report.note.trim() : "(nothing written)";

  const rows: [string, string][] = kind === "photo"
    ? [
        ["", "The photo for this report has now arrived. It is attached."],
        ["Report", report.publicId],
      ]
    : [
        ["", severityLine],
        ...(report.isLitter
          ? ([["Kittens", "yes: kittens, or a mother with kittens."]] as [string, string][])
          : []),
        ["What they saw", note],
        ["When", `${when} (Athens time)`],
        ["Where (exact)", `${report.lat}, ${report.lng}`],
        ["Google Maps", links.google],
        ["Apple Maps", links.apple],
        ["", photoLine],
        ["Report", report.publicId],
        ["Language", report.reporterLanguage],
        ["", "No contact details were left."],
      ];

  const text = rows
    .map(([label, value]) => (label ? `${label}: ${value}` : value))
    .join("\n");
  const html =
    `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">` +
    rows
      .map(([label, value]) => {
        const v = /^https:\/\//.test(value)
          ? `<a href="${escapeHtml(value)}">${escapeHtml(value)}</a>`
          : escapeHtml(value);
        return `<p style="margin:0 0 8px">${label ? `<strong>${escapeHtml(label)}:</strong> ` : ""}${v}</p>`;
      })
      .join("") +
    `</div>`;

  const attachments = photo
    ? [
        {
          filename: `cat-report-${report.publicId.slice(0, 8)}.${photo.mime === "image/png" ? "png" : "jpg"}`,
          content: photo.bytes,
        },
      ]
    : undefined;
  return { subject, text, html, attachments };
}
