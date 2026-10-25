import { logger } from "../logger";
import { addressFingerprint, type FingerprintLabel } from "./fingerprint";
import { KEEP_SAFE_TEMPLATES } from "./keepSafeTemplates";
import { REPORT_TEMPLATES } from "./reportTemplates";
import {
  colonyIdsOf,
  isAccessChange,
  renderAccessNotice,
  renderInvitation,
  type AccessChange,
} from "./personTemplates";
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
 * The priority budget (§2.10): the never-shed group below always goes out;
 * a SHEDDABLE purpose (so far only `issue_alert`, SYC-44 PR 5.2) is dropped
 * once the day's sends reach the budget less the reserve held back for the
 * never-shed group. The outbox does the dropping (`drainDue`); the numbers
 * and the lists live here.
 *
 * **People mail (SYC-53 PR 1.1; roles-and-invites.md §8.3, §8.5).** Two
 * purposes whose recipient is a PERSON ID, never an address: the caller
 * can't pass `to`, and a message carrying one is refused. `person_invite`
 * looks the address up itself and refuses unless that person is pending,
 * unexpired and not anonymised, so it can't be used to email a stranger.
 * `access_change_notice` goes only to a management member who is joined,
 * on the list and holds management now, and never to the person who made
 * the change. Both bodies are closed templates built here from the records
 * (personTemplates.ts).
 */

/** email-capture.md §5.1's closed message list, plus the team alert. */
export const MAIL_PURPOSES = [
  "welfare_alert",
  "issue_alert",
  "urgent_alert",
  "matcher_alert",
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
  "person_invite",
  "access_change_notice",
] as const;

export type MailPurpose = (typeof MAIL_PURPOSES)[number];
export type TeamPurpose = "welfare_alert" | "issue_alert" | "urgent_alert" | "matcher_alert";
export type PersonPurpose = "person_invite" | "access_change_notice";
export type PublicPurpose = Exclude<MailPurpose, TeamPurpose | PersonPurpose>;
export type MailIdentity = "transactional" | "news";

type PurposeRule = {
  identity: MailIdentity;
  from: string;
  /**
   * team: WELFARE_ALERT_TO, never the caller's choice.
   * unverified_public: the one fixed "is this you?" message, to any address
   *   not suppressed (it is the only thing an unverified address can get).
   * verified_public: only to an address its holder has confirmed (F7b).
   * person: a person id; the invitee's own address, only while she is
   *   pending, unexpired and not anonymised (SYC-53 PR 1.1).
   * management: a person id; a joined management member, never the actor.
   */
  recipient: "team" | "unverified_public" | "verified_public" | "person" | "management";
  body: "team_built" | "fixed_template";
  replyTo?: string;
};

const REPORTS_FROM = "Syros Cats via Cat Spotters <reports@mail.catspotters.com>";
const TRANSACTIONAL_FROM = "Cat Spotters <hello@mail.catspotters.com>";
/** The sign-in sender: an invitation comes from where the sign-in link will (C8). */
const SIGNIN_FROM = "Cat Spotters <signin@mail.catspotters.com>";
const NEWS_FROM = "Cat Spotters <news@news.catspotters.com>";
const SYROS_CATS = "admin@syroscats.com";

export const PURPOSE_RULES: Record<MailPurpose, PurposeRule> = {
  welfare_alert: { identity: "transactional", from: REPORTS_FROM, recipient: "team", body: "team_built" },
  // SYC-44 PR 5.2: the "Report an issue" emails to the same shared inbox.
  // Same team rule as welfare_alert, but sheddable (see SHEDDABLE_PURPOSES).
  issue_alert: { identity: "transactional", from: REPORTS_FROM, recipient: "team", body: "team_built" },
  urgent_alert: { identity: "transactional", from: REPORTS_FROM, recipient: "team", body: "team_built" },
  // SYC-532: "the look-alike check is failing" (and "working again"). Goes to
  // MATCHER_ALERT_TO, not the shared welfare inbox (Samuel, 25 Oct 2026).
  matcher_alert: { identity: "transactional", from: TRANSACTIONAL_FROM, recipient: "team", body: "team_built" },
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
  // SYC-53 PR 1.1. Both transactional; the invitation can be shed after
  // sign-in links and welfare mail (§8.5), so it is NOT in NEVER_SHED.
  person_invite: { identity: "transactional", from: SIGNIN_FROM, recipient: "person", body: "fixed_template" },
  access_change_notice: { identity: "transactional", from: TRANSACTIONAL_FROM, recipient: "management", body: "fixed_template" },
};

const IDENTITY_KEY: Record<MailIdentity, string> = {
  transactional: "RESEND_API_KEY",
  news: "RESEND_NEWS_API_KEY",
};

// SYC-42 Slice 3 switches on the reporter's three: the one "is this you?"
// (news), then the acknowledgement and the outcome (mail.), verified only.
const DEFAULT_ENABLED: readonly MailPurpose[] = [
  "welfare_alert",
  "issue_alert",
  "matcher_alert",
  "keep_safe_verify",
  "restore_link",
  "public_verify",
  "report_ack",
  "report_outcome",
  "person_invite",
  "access_change_notice",
];
let enabledOverride: readonly MailPurpose[] | null = null;

/** Never shed under the priority budget (spec §2.10). A restore link is a sign-in (review A7). */
export const NEVER_SHED_PURPOSES: readonly MailPurpose[] = ["welfare_alert", "matcher_alert", "restore_link"];

/**
 * Purposes the outbox may drop (mark failed with `shed`) when the day's
 * sends near the account's allowance. Deliberately only `issue_alert` for now:
 * the reporter and keep-safe emails are retried, never dropped, until their
 * own shedding is designed (a dropped keep-safe email would leave its address
 * and link in the row; a dropped acknowledgement is a promise broken).
 */
export const SHEDDABLE_PURPOSES: readonly MailPurpose[] = ["issue_alert"];

/** Sheddable, and not also never-shed: the never-shed group always wins. */
export function isSheddable(purpose: string): boolean {
  return (
    (SHEDDABLE_PURPOSES as readonly string[]).includes(purpose) &&
    !(NEVER_SHED_PURPOSES as readonly string[]).includes(purpose)
  );
}

export const DEFAULT_MAIL_DAILY_BUDGET = 100;
export const DEFAULT_MAIL_NEVER_SHED_RESERVE = 20;

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isInteger(n) && n >= 0 ? n : fallback;
}

/**
 * Resend's daily allowance is account-wide. The defaults (100, with 20 held
 * back for the never-shed group) are Resend's free-plan limit; set
 * MAIL_DAILY_BUDGET to the real plan's figure when the account moves up.
 */
export function mailDailyBudget(): number {
  return positiveInt(process.env["MAIL_DAILY_BUDGET"], DEFAULT_MAIL_DAILY_BUDGET);
}

export function mailNeverShedReserve(): number {
  return positiveInt(process.env["MAIL_NEVER_SHED_RESERVE"], DEFAULT_MAIL_NEVER_SHED_RESERVE);
}

/** A sheddable purpose is dropped once today's sends reach this many. */
export function shedThreshold(): number {
  return Math.max(0, mailDailyBudget() - mailNeverShedReserve());
}

/** Which fingerprint label a purpose's recipient is hashed under (fingerprint.ts). */
export const PURPOSE_LABEL: Record<MailPurpose, Exclude<FingerprintLabel, "ip">> = {
  welfare_alert: "team",
  issue_alert: "team",
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
  person_invite: "team",
  access_change_notice: "team",
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

/** An invitation: to this person, never to an address (§8.5). */
export type PersonInviteMessage = {
  purpose: "person_invite";
  personId: string;
  idempotencyKey?: string;
};

/** A notice to one other management member about one change (§8.3). */
export type AccessChangeMessage = {
  purpose: "access_change_notice";
  recipientId: string;
  actorId: string;
  subjectId: string;
  change: AccessChange;
  idempotencyKey?: string;
};

export type PersonMessage = PersonInviteMessage | AccessChangeMessage;

export type MailMessage = TeamMessage | PublicMessage | PersonMessage;

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
        | "recipient_check_missing"
        | "not_pending"
        | "not_a_manager"
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
  /** Required for the people purposes: looks people up by id (SYC-53 PR 1.1). */
  people?: PersonMailLookups;
};

/** How the people purposes find their recipient and words, by id only. */
export type PersonMailLookups = {
  /** The invitee, only while pending, unexpired and not anonymised. */
  invitee(personId: string): Promise<{
    email: string;
    language: string;
    roles: string[];
    colonies: { id: number; name: string }[];
    /** A cat guardian with no colony yet (SYC-439); absent reads as no. */
    starting?: boolean;
  } | null>;
  /** A joined management member with management in force now. */
  manager(personId: string): Promise<{ email: string; language: string } | null>;
  names(ids: string[]): Promise<ReadonlyMap<string, string>>;
  colonyNames(ids: number[]): Promise<ReadonlyMap<number, string>>;
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

/**
 * The recipient and words of a people message, from the records, or why
 * there are none. Never from the caller: the message holds only ids.
 */
async function buildPersonMail(
  message: PersonMessage,
  people: PersonMailLookups,
): Promise<
  | { ok: true; to: string; content: RenderedTemplate }
  | { ok: false; reason: "not_pending" | "not_a_manager" | "recipient_not_allowed" | "unknown_template" }
> {
  if (message.purpose === "person_invite") {
    if (typeof message.personId !== "string") return { ok: false, reason: "recipient_not_allowed" };
    const invitee = await people.invitee(message.personId);
    if (!invitee) return { ok: false, reason: "not_pending" };
    return {
      ok: true,
      to: invitee.email,
      content: renderInvitation({
        language: invitee.language,
        roles: invitee.roles,
        colonies: invitee.colonies.map((c) => c.name),
        starting: invitee.starting === true,
      }),
    };
  }
  const { recipientId, actorId, subjectId, change } = message;
  if (typeof recipientId !== "string" || typeof actorId !== "string" || typeof subjectId !== "string") {
    return { ok: false, reason: "recipient_not_allowed" };
  }
  // Never the person who made the change (§8.3).
  if (recipientId === actorId) return { ok: false, reason: "recipient_not_allowed" };
  if (!isAccessChange(change)) return { ok: false, reason: "unknown_template" };
  const manager = await people.manager(recipientId);
  if (!manager) return { ok: false, reason: "not_a_manager" };
  const names = await people.names([actorId, subjectId]);
  const colonyNames = await people.colonyNames(colonyIdsOf(change));
  return {
    ok: true,
    to: manager.email,
    content: renderAccessNotice({
      language: manager.language,
      // `self` and `cli:` actors have no name on the list.
      actorName: names.get(actorId) ?? "Syros Cats",
      subjectName: names.get(subjectId) ?? "someone",
      change,
      colonyNames,
    }),
  };
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
  if (rule.recipient === "person" || rule.recipient === "management") {
    // A person id only: an address, a template or any caller text is refused.
    for (const field of ["to", "template", "params", "subject", "text", "html", "attachments"]) {
      if (field in m) {
        log.error({ purpose, field }, "mail: refused, people mail takes a person id, never an address or text");
        return { ok: false, reason: "recipient_not_allowed" };
      }
    }
    if (!deps.people || !deps.isSuppressed) {
      log.error({ purpose }, "mail: refused, no people lookup or suppression check supplied");
      return { ok: false, reason: "recipient_check_missing" };
    }
    const built = await buildPersonMail(message as PersonMessage, deps.people);
    if (!built.ok) {
      log.warn({ purpose, reason: built.reason }, "mail: not sent, the recipient check failed");
      return { ok: false, reason: built.reason };
    }
    to = built.to.trim();
    if (!SINGLE_ADDRESS.test(to)) {
      log.error({ purpose }, "mail: refused, recipient is not a single address");
      return { ok: false, reason: "bad_recipient" };
    }
    if (await deps.isSuppressed(to)) {
      log.warn({ purpose, recipientHash: hashRecipient(to, purpose) }, "mail: not sent, address is suppressed");
      return { ok: false, reason: "suppressed" };
    }
    content = built.content;
  } else if (rule.recipient === "team") {
    if ("to" in m) {
      log.error({ purpose }, "mail: refused, team mail takes no caller-chosen recipient");
      return { ok: false, reason: "recipient_not_allowed" };
    }
    const toVar = purpose === "matcher_alert" ? "MATCHER_ALERT_TO" : "WELFARE_ALERT_TO";
    to = (process.env[toVar] ?? "").trim();
    if (!SINGLE_ADDRESS.test(to)) {
      log.error({ purpose }, `mail: refused, ${toVar} is not set to a single address`);
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
