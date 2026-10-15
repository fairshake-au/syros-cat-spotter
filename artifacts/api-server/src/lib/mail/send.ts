import { logger } from "../logger";
import { addressFingerprint, type FingerprintLabel } from "./fingerprint";
import { KEEP_SAFE_TEMPLATES } from "./keepSafeTemplates";
import { REPORT_TEMPLATES } from "./reportTemplates";
import { resendSend } from "./resend";

/**
 * The ONE send function for the API's mail (spec §2.10, §8.3; DECISIONS D2).
 *
 * SYC-42 plan, Slice 0 item 0.1. Built to the interface the SYC-3 plan
 * specifies (docs/superpowers/plans/syc-3-keep-my-spots-safe.md, Slice 1
 * step 2 and test 14), so SYC-3 switches its purposes on here rather than
 * writing a second sender.
 *
 * Everything about a message that could be abused is decided by its PURPOSE,
 * from the closed list below, never by the caller:
 *
 * - **Who it goes to.** Team purposes (the welfare alert) go to
 *   WELFARE_ALERT_TO, resolved here; a caller can't name a recipient, so this
 *   function can't be used to send a stranger anything. Public purposes take
 *   one address and need an injected suppression check (and, for anything
 *   but the "is this you?" message, a verification check: F7b).
 * - **What it says.** Team purposes carry text built by our own code (the
 *   alert). Public purposes carry NO caller text at all: only a fixed
 *   template id and parameters, rendered by a template registered here
 *   (none yet; SYC-3 and SYC-42 Slice 3 add theirs).
 * - **Who it's from, the Reply-To, and which key signs it.** Transactional
 *   mail (`mail.`) uses RESEND_API_KEY; news mail (`news.`) uses
 *   RESEND_NEWS_API_KEY (spec §2.10: separate keys, so either can be
 *   rotated or revoked alone).
 * - **Whether it's switched on.** SYC-42 switched on `welfare_alert`, and
 *   in Slice 3 `public_verify`, `report_ack` and `report_outcome`; SYC-3
 *   switches on `keep_safe_verify` and `restore_link`. `forget` stays off: the
 *   build sends no "you've been forgotten" email (plan review A9).
 *   `urgent_alert` is reserved and OFF: Samuel kept F1 on 1 Oct 2026
 *   ("Nothing pages a human, by design"). Switching it on reverses F1 and
 *   needs his decision, not a code edit.
 *
 * A failed send is logged loudly and returned; it is never swallowed. The
 * recipient is only ever logged as a hash, and any address echoed back in a
 * provider error is redacted before it's logged or returned. Subjects are
 * stripped of CR/LF and a recipient must be exactly one address, so nothing
 * typed can become a header.
 *
 * The priority budget (§2.10) exists here as the never-shed group only;
 * shedding arrives with the first purpose that can be shed.
 */

/** email-capture.md §5.1's closed message list, plus the team alert. */
export const MAIL_PURPOSES = [
  "welfare_alert",
  "urgent_alert",
  "public_verify",
  "report_ack",
  "report_outcome",
  "cat_news",
  "visit_summary",
  "promise_withdrawn",
  "donation_receipt",
  "keep_safe_verify",
  "restore_link",
  "forget",
] as const;

export type MailPurpose = (typeof MAIL_PURPOSES)[number];
export type TeamPurpose = "welfare_alert" | "urgent_alert";
export type PublicPurpose = Exclude<MailPurpose, TeamPurpose>;
export type MailIdentity = "transactional" | "news";

type PurposeRule = {
  identity: MailIdentity;
  from: string;
  /**
   * team: WELFARE_ALERT_TO, never the caller's choice.
   * unverified_public: the one fixed "is this you?" message, to any address
   *   not suppressed (it is the only thing an unverified address can get).
   * verified_public: only to an address its holder has confirmed (F7b).
   */
  recipient: "team" | "unverified_public" | "verified_public";
  body: "team_built" | "fixed_template";
  replyTo?: string;
};

const REPORTS_FROM = "Syros Cats via Cat Spotters <reports@mail.catspotters.com>";
const TRANSACTIONAL_FROM = "Cat Spotters <hello@mail.catspotters.com>";
const NEWS_FROM = "Cat Spotters <news@news.catspotters.com>";
const SYROS_CATS = "admin@syroscats.com";

export const PURPOSE_RULES: Record<MailPurpose, PurposeRule> = {
  welfare_alert: { identity: "transactional", from: REPORTS_FROM, recipient: "team", body: "team_built" },
  urgent_alert: { identity: "transactional", from: REPORTS_FROM, recipient: "team", body: "team_built" },
  // email-capture.md §7.3 (the D2 amendment): public verification is news.
  public_verify: { identity: "news", from: NEWS_FROM, recipient: "unverified_public", body: "fixed_template" },
  report_ack: { identity: "transactional", from: REPORTS_FROM, recipient: "verified_public", body: "fixed_template", replyTo: SYROS_CATS },
  report_outcome: { identity: "transactional", from: REPORTS_FROM, recipient: "verified_public", body: "fixed_template", replyTo: SYROS_CATS },
  cat_news: { identity: "news", from: NEWS_FROM, recipient: "verified_public", body: "fixed_template" },
  visit_summary: { identity: "news", from: NEWS_FROM, recipient: "verified_public", body: "fixed_template" },
  promise_withdrawn: { identity: "news", from: NEWS_FROM, recipient: "verified_public", body: "fixed_template" },
  donation_receipt: { identity: "transactional", from: TRANSACTIONAL_FROM, recipient: "verified_public", body: "fixed_template" },
  // SYC-3: keep-safe messages are transactional (email-capture.md §8.3).
  keep_safe_verify: { identity: "transactional", from: TRANSACTIONAL_FROM, recipient: "unverified_public", body: "fixed_template" },
  restore_link: { identity: "transactional", from: TRANSACTIONAL_FROM, recipient: "verified_public", body: "fixed_template" },
  forget: { identity: "transactional", from: TRANSACTIONAL_FROM, recipient: "verified_public", body: "fixed_template" },
};

const IDENTITY_KEY: Record<MailIdentity, string> = {
  transactional: "RESEND_API_KEY",
  news: "RESEND_NEWS_API_KEY",
};

// SYC-42 Slice 3 switches on the reporter's three: the one "is this you?"
// (news), then the acknowledgement and the outcome (mail.), verified only.
const DEFAULT_ENABLED: readonly MailPurpose[] = [
  "welfare_alert",
  "keep_safe_verify",
  "restore_link",
  "public_verify",
  "report_ack",
  "report_outcome",
];
let enabledOverride: readonly MailPurpose[] | null = null;

/** Never shed under the priority budget (spec §2.10). A restore link is a sign-in (review A7). */
export const NEVER_SHED_PURPOSES: readonly MailPurpose[] = ["welfare_alert", "restore_link"];

/** Which fingerprint label a purpose's recipient is hashed under (fingerprint.ts). */
export const PURPOSE_LABEL: Record<MailPurpose, Exclude<FingerprintLabel, "ip">> = {
  welfare_alert: "team",
  urgent_alert: "team",
  public_verify: "news",
  report_ack: "report",
  report_outcome: "report",
  cat_news: "news",
  visit_summary: "news",
  promise_withdrawn: "news",
  donation_receipt: "all",
  keep_safe_verify: "keep_safe",
  restore_link: "keep_safe",
  forget: "keep_safe",
};

/** `contentId` lets the HTML show the attachment inline with `cid:<contentId>`. */
export type MailAttachment = { filename: string; content: Buffer; contentId?: string };

/** A message built by our own code, to the team address. */
export type TeamMessage = {
  purpose: TeamPurpose;
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
  idempotencyKey?: string;
};

/** A message to a member of the public: a fixed template, nothing typed. */
export type PublicMessage = {
  purpose: PublicPurpose;
  to: string;
  template: string;
  params: Record<string, string>;
  idempotencyKey?: string;
};

export type MailMessage = TeamMessage | PublicMessage;

export type RenderedTemplate = { subject: string; text: string; html: string };
export type FixedTemplate = (params: Record<string, string>) => RenderedTemplate;

/** Fixed templates for public purposes. */
const DEFAULT_TEMPLATES: Record<string, FixedTemplate> = { ...KEEP_SAFE_TEMPLATES, ...REPORT_TEMPLATES };
let templatesOverride: Record<string, FixedTemplate> | null = null;

export type SendResult =
  | { ok: true; providerMessageId: string }
  | {
      ok: false;
      reason:
        | "unknown_purpose"
        | "purpose_disabled"
        | "recipient_not_allowed"
        | "bad_recipient"
        | "suppression_check_missing"
        | "verification_check_missing"
        | "suppressed"
        | "unverified"
        | "unknown_template"
        | "not_configured"
        | "provider_error";
      detail?: string;
      /** The provider's HTTP status, when it answered. */
      status?: number | null;
    };

type Log = Pick<typeof logger, "error" | "info" | "warn">;

export type SendDeps = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  log?: Log;
  /** Required for every public purpose (bounces, complaints, opt-outs). */
  isSuppressed?: (address: string) => Promise<boolean>;
  /** Required for every verified-only public purpose (F7b). */
  isVerified?: (address: string) => Promise<boolean>;
};

function enabled(): readonly MailPurpose[] {
  return enabledOverride ?? DEFAULT_ENABLED;
}

export function isPurposeEnabled(purpose: MailPurpose): boolean {
  return enabled().includes(purpose);
}

/** Tests only: switch purposes on to exercise their rules. */
export function __setEnabledPurposesForTest(purposes: readonly MailPurpose[] | null): void {
  if (process.env["NODE_ENV"] !== "test") throw new Error("test only");
  enabledOverride = purposes;
}

/** Tests only: stand-in fixed templates. */
export function __setTemplatesForTest(templates: Record<string, FixedTemplate> | null): void {
  if (process.env["NODE_ENV"] !== "test") throw new Error("test only");
  templatesOverride = templates;
}

/**
 * The recipient as it appears in logs and `mail_outbox.recipient_hash`: the
 * same keyed fingerprint as `email_contacts.address_hmac`, under the
 * purpose's label (SYC-179). Never an unkeyed hash: with no key it's `nokey`.
 */
export function hashRecipient(address: string, purpose: MailPurpose = "welfare_alert"): string {
  try {
    return addressFingerprint(PURPOSE_LABEL[purpose], address);
  } catch {
    return "nokey";
  }
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

function redactAddresses(text: string): string {
  return text.replace(/[^\s@"'<>,:;()]+@[^\s@"'<>,:;()]+/g, "[address]");
}

const SINGLE_ADDRESS = /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/;

export function describeMail(): { level: "info" | "warn"; line: string }[] {
  const lines: { level: "info" | "warn"; line: string }[] = [];
  for (const identity of ["transactional", "news"] as const) {
    const name = IDENTITY_KEY[identity];
    const needed = enabled().some((p) => PURPOSE_RULES[p].identity === identity);
    if (process.env[name]) {
      lines.push({ level: "info", line: `mail: ${identity} key (${name}) present` });
    } else {
      lines.push({
        level: needed ? "warn" : "info",
        line: needed
          ? `WARNING: mail: ${identity} key (${name}) is not set; ${identity} mail is refused until it is.`
          : `mail: ${identity} key (${name}) not set (nothing switched on uses it yet)`,
      });
    }
  }
  if (process.env["RESEND_API_BASE"] && process.env["NODE_ENV"] === "production") {
    lines.push({ level: "warn", line: "WARNING: mail: RESEND_API_BASE is ignored in production." });
  }
  return lines;
}

export async function sendMail(message: MailMessage, deps: SendDeps = {}): Promise<SendResult> {
  const log = deps.log ?? logger;
  const purpose = message.purpose;
  if (!(MAIL_PURPOSES as readonly string[]).includes(purpose)) {
    log.error({ purpose: String(purpose) }, "mail: refused, unknown purpose");
    return { ok: false, reason: "unknown_purpose" };
  }
  if (!isPurposeEnabled(purpose)) {
    log.error({ purpose }, "mail: refused, purpose is not switched on");
    return { ok: false, reason: "purpose_disabled" };
  }
  const rule = PURPOSE_RULES[purpose];
  const m = message as unknown as Record<string, unknown>;
  if ("replyTo" in m || "from" in m || "cc" in m || "bcc" in m) {
    log.error({ purpose }, "mail: refused, the caller tried to set a header");
    return { ok: false, reason: "recipient_not_allowed" };
  }

  let to: string;
  let content: RenderedTemplate & { attachments?: MailAttachment[] };
  if (rule.recipient === "team") {
    if ("to" in m) {
      log.error({ purpose }, "mail: refused, team mail takes no caller-chosen recipient");
      return { ok: false, reason: "recipient_not_allowed" };
    }
    to = (process.env["WELFARE_ALERT_TO"] ?? "").trim();
    if (!SINGLE_ADDRESS.test(to)) {
      log.error({ purpose }, "mail: refused, WELFARE_ALERT_TO is not set to a single address");
      return { ok: false, reason: "bad_recipient" };
    }
    const team = message as TeamMessage;
    content = { subject: team.subject, text: team.text, html: team.html, attachments: team.attachments };
  } else {
    const pub = message as PublicMessage;
    if ("subject" in m || "text" in m || "html" in m || "attachments" in m) {
      log.error({ purpose }, "mail: refused, public mail carries no caller text");
      return { ok: false, reason: "unknown_template" };
    }
    to = String(pub.to ?? "").trim();
    if (!SINGLE_ADDRESS.test(to)) {
      log.error({ purpose }, "mail: refused, recipient is not a single address");
      return { ok: false, reason: "bad_recipient" };
    }
    if (!deps.isSuppressed) {
      log.error({ purpose }, "mail: refused, no suppression check supplied for a public recipient");
      return { ok: false, reason: "suppression_check_missing" };
    }
    if (rule.recipient === "verified_public" && !deps.isVerified) {
      log.error({ purpose }, "mail: refused, no verification check supplied (F7b)");
      return { ok: false, reason: "verification_check_missing" };
    }
    const template = (templatesOverride ?? DEFAULT_TEMPLATES)[pub.template];
    if (!template) {
      log.error({ purpose }, "mail: refused, unknown template");
      return { ok: false, reason: "unknown_template" };
    }
    if (await deps.isSuppressed(to)) {
      log.warn({ purpose, recipientHash: hashRecipient(to, purpose) }, "mail: not sent, address is suppressed");
      return { ok: false, reason: "suppressed" };
    }
    if (rule.recipient === "verified_public" && !(await deps.isVerified!(to))) {
      log.warn({ purpose, recipientHash: hashRecipient(to, purpose) }, "mail: not sent, address is not verified (F7b)");
      return { ok: false, reason: "unverified" };
    }
    content = template(pub.params ?? {});
  }

  const keyName = IDENTITY_KEY[rule.identity];
  const apiKey = process.env[keyName];
  if (!apiKey) {
    log.error({ purpose }, `mail: refused, ${keyName} is not set; nothing was sent`);
    return { ok: false, reason: "not_configured" };
  }

  const recipientHash = hashRecipient(to, purpose);
  const result = await resendSend(
    apiKey,
    {
      from: rule.from,
      to,
      subject: headerSafe(content.subject),
      text: content.text,
      html: content.html,
      replyTo: rule.replyTo,
      attachments: content.attachments?.map((a) => ({
        filename: headerSafe(a.filename),
        content: a.content.toString("base64"),
        ...(a.contentId ? { content_id: headerSafe(a.contentId) } : {}),
      })),
      idempotencyKey: message.idempotencyKey,
    },
    { fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs },
  );
  if (!result.ok) {
    const error = redactAddresses(result.error);
    log.error({ purpose, recipientHash, status: result.status, error }, "mail: SEND FAILED");
    return { ok: false, reason: "provider_error", detail: error, status: result.status };
  }
  log.info({ purpose, recipientHash, providerMessageId: result.id }, "mail: sent");
  return { ok: true, providerMessageId: result.id };
}
