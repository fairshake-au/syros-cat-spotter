import { escapeHtml } from "./mail/send";
import { publicAppOrigin } from "./keepSafe/links";

/**
 * The two emails about the look-alike check (SYC-532): "failing" and
 * "working again". Fixed words and numbers only. No photo, cat, person or
 * position goes in (the ticket's rule), so the body can't leak anything.
 */

export const MATCHER_DOWN_SUBJECT = "Look-alike check is failing";
export const MATCHER_UP_SUBJECT = "Look-alike check is working again";

const homeUrl = () => `${publicAppOrigin()}/api/team/home`;

function mail(subject: string, lines: string[]): { subject: string; text: string; html: string } {
  const text = [...lines, "", `Dashboard Home: ${homeUrl()}`, "", "Sent by Cat Spotters for Syros Cats."].join("\n");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#101828;max-width:560px">` +
    `<h2 style="margin:0 0 12px">${escapeHtml(subject)}</h2>` +
    lines.map((l) => `<p style="margin:0 0 10px">${escapeHtml(l)}</p>`).join("") +
    `<p style="margin:14px 0"><a href="${escapeHtml(homeUrl())}" style="color:#1D4ED8">Open dashboard Home</a></p>` +
    `<p style="color:#475467;font-size:13px">Sent by Cat Spotters for Syros Cats.</p></div>`;
  return { subject, text, html };
}

export function buildMatcherDown(failed: number, windowMinutes: number) {
  return mail(MATCHER_DOWN_SUBJECT, [
    `${failed} photo checks failed in the last ${windowMinutes} minutes.`,
    "Spotters are seeing \"We couldn't check this photo right now\". If they still choose \"It's a new cat\", that cat may already be in the catalogue.",
    "Home shows a notice while this lasts, and a list of the new cats named in the meantime so you can check them for duplicates. You won't get another email until it is working again.",
  ]);
}

export function buildMatcherUp() {
  return mail(MATCHER_UP_SUBJECT, [
    "Photo checks are working again: none has failed in the last 15 minutes.",
    "New cats named while it was failing are listed on Home under \"New cats to check\".",
  ]);
}
