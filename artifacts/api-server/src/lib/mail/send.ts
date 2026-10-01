import { createHash } from "node:crypto";
import { logger } from "../logger";
import { resendSend } from "./resend";

/**
 * The ONE send function for the API's mail (spec §2.10, §8.3; DECISIONS D2).
 *
 * SYC-42 plan, Slice 0 item 0.1. Built exactly to the interface the SYC-3 plan
 * specifies (docs/superpowers/plans/syc-3-keep-my-spots-safe.md, Slice 1
 * step 2), so SYC-3 switches its purposes on here rather than writing a
 * second sender:
 *
 * - Every send declares a purpose from a closed TypeScript union. There is no
 *   free-text path: the purpose decides the sending identity (the "from"),
 *   and a purpose not on the list is refused at compile time and at run time.
 * - A purpose is refused unless it is switched on below. Slice 1 switches on
 *   `welfare_alert` only. `urgent_alert` is reserved and OFF: Samuel kept F1
 *   on 1 Oct 2026 ("Nothing pages a human, by design"). Switching it on is a
 *   reversal of F1 and needs his decision, not a code edit.
 * - Resend through `fetch` (resend.ts). With no key it refuses and says so,
 *   loudly, in the log and in the start-up lines (`describeMail`).
 * - A failed send is logged loudly and returned; it is never swallowed.
 * - The recipient is only ever logged as a hash. Subjects are stripped of
 *   CR/LF, and a recipient containing CR/LF, a comma or angle brackets is
 *   refused, so nothing a person typed can become a header.
 *
 * The priority budget (§2.10) exists here as the never-shed group only;
 * shedding arrives with the first purpose that can be shed (SYC-3 or
 * SYC-42 Slice 3).
 */

/** email-capture.md §5.1's closed message list, plus the team alert. */
export const MAIL_PURPOSES = [
  // SYC-42: the alert to Syros Cats' shared inbox (spec §4.3).
  "welfare_alert",
  // Reserved, OFF (Decision 1 / F1). Nothing pages a person.
  "urgent_alert",
  // email-capture.md §5.1, switched on by their own slices.
  "public_verify",
  "report_ack",
  "report_outcome",
  "cat_news",
  "visit_summary",
  "promise_withdrawn",
  "donation_receipt",
  // SYC-3.
  "keep_safe_verify",
  "restore_link",
  "forget",
] as const;

export type MailPurpose = (typeof MAIL_PURPOSES)[number];

const ENABLED: ReadonlySet<MailPurpose> = new Set<MailPurpose>(["welfare_alert"]);

/** Never shed under the priority budget (spec §2.10). */
export const NEVER_SHED_PURPOSES: readonly MailPurpose[] = ["welfare_alert"];

const TRANSACTIONAL_REPORTS = "Syros Cats via Cat Spotters <reports@mail.catspotters.com>";
const TRANSACTIONAL = "Cat Spotters <hello@mail.catspotters.com>";
const NEWS = "Cat Spotters <news@news.catspotters.com>";

/** The sending identity is decided by purpose, never by the caller. */
const FROM: Record<MailPurpose, string> = {
  welfare_alert: TRANSACTIONAL_REPORTS,
  urgent_alert: TRANSACTIONAL_REPORTS,
  report_ack: TRANSACTIONAL_REPORTS,
  report_outcome: TRANSACTIONAL_REPORTS,
  public_verify: NEWS,
  cat_news: NEWS,
  visit_summary: NEWS,
  promise_withdrawn: NEWS,
  donation_receipt: TRANSACTIONAL,
  keep_safe_verify: TRANSACTIONAL,
  restore_link: TRANSACTIONAL,
  forget: TRANSACTIONAL,
};

export type MailAttachment = { filename: string; content: Buffer };

export type MailMessage = {
  purpose: MailPurpose;
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  attachments?: MailAttachment[];
  idempotencyKey?: string;
};

export type SendResult =
  | { ok: true; providerMessageId: string }
  | {
      ok: false;
      reason:
        | "unknown_purpose"
        | "purpose_disabled"
        | "not_configured"
        | "bad_recipient"
        | "provider_error";
      detail?: string;
    };

type Log = Pick<typeof logger, "error" | "info" | "warn">;

export function isPurposeEnabled(purpose: MailPurpose): boolean {
  return ENABLED.has(purpose);
}

export function hashRecipient(address: string): string {
  return createHash("sha256")
    .update(address.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function headerSafe(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

const RECIPIENT = /^[^\s@,<>"]+@[^\s@,<>"]+\.[^\s@,<>"]+$/;

export function describeMail(): string[] {
  return process.env["RESEND_API_KEY"]
    ? ["mail: RESEND_API_KEY present"]
    : [
        "WARNING: mail: RESEND_API_KEY is not set. Welfare alerts stay queued in mail_outbox and nothing is sent until it is.",
      ];
}

export async function sendMail(
  message: MailMessage,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; log?: Log } = {},
): Promise<SendResult> {
  const log = opts.log ?? logger;
  const purpose = message.purpose;
  if (!(MAIL_PURPOSES as readonly string[]).includes(purpose)) {
    log.error({ purpose: String(purpose) }, "mail: refused, unknown purpose");
    return { ok: false, reason: "unknown_purpose" };
  }
  if (!isPurposeEnabled(purpose)) {
    log.error({ purpose }, "mail: refused, purpose is not switched on");
    return { ok: false, reason: "purpose_disabled" };
  }
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    log.error(
      { purpose },
      "mail: refused, RESEND_API_KEY is not set; nothing was sent",
    );
    return { ok: false, reason: "not_configured" };
  }
  const to = message.to.trim();
  if (!RECIPIENT.test(to)) {
    log.error({ purpose }, "mail: refused, recipient is not a single address");
    return { ok: false, reason: "bad_recipient" };
  }
  const recipientHash = hashRecipient(to);
  const result = await resendSend(
    apiKey,
    {
      from: FROM[purpose],
      to,
      subject: headerSafe(message.subject),
      text: message.text,
      html: message.html,
      replyTo: message.replyTo ? headerSafe(message.replyTo) : undefined,
      attachments: message.attachments?.map((a) => ({
        filename: headerSafe(a.filename),
        content: a.content.toString("base64"),
      })),
      idempotencyKey: message.idempotencyKey,
    },
    { fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs },
  );
  if (!result.ok) {
    log.error(
      { purpose, recipientHash, status: result.status, error: result.error },
      "mail: SEND FAILED",
    );
    return { ok: false, reason: "provider_error", detail: result.error };
  }
  log.info(
    { purpose, recipientHash, providerMessageId: result.id },
    "mail: sent",
  );
  return { ok: true, providerMessageId: result.id };
}
