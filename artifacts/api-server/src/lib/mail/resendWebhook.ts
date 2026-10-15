import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { addressFingerprint } from "./fingerprint";

/**
 * Resend's delivery webhook (SYC-42 plan, Slice 3 item 3.6; spec §2.10,
 * §8.3).
 *
 * Resend signs each call the Svix way: `svix-id`, `svix-timestamp` and
 * `svix-signature` headers, an HMAC-SHA256 over `id.timestamp.body` under the
 * endpoint's `whsec_` secret (RESEND_WEBHOOK_SECRET, a Replit deployment
 * secret; never in a file or a prompt, §2.11). Anything unsigned, wrongly
 * signed or more than five minutes old is refused before it's read.
 *
 * What a verified event does:
 * - `email.delivered` / `email.bounced` / `email.complained` move the
 *   message's `mail_deliveries` row on (never backwards: a late "delivered"
 *   can't hide a bounce). Messages we didn't send through the outbox (the
 *   sign-in Worker shares the Resend account) have no row and are skipped.
 * - A bounce (unless Resend says it was temporary) or a complaint puts the
 *   address on the suppression list for every purpose (scope `all`), which
 *   also blocks every later "is this you?" email (§2.10). Only the keyed
 *   fingerprint is stored, and the address is never logged.
 */

export const RESEND_WEBHOOK_PATH = "/api/internal/resend/webhook";
const TOLERANCE_SECONDS = 5 * 60;

export type WebhookCheck = "ok" | "not_configured" | "bad_signature" | "stale";

export function verifyResendSignature(
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer,
  now: number = Date.now(),
): WebhookCheck {
  const secret = process.env["RESEND_WEBHOOK_SECRET"] ?? "";
  if (!secret.startsWith("whsec_")) return "not_configured";
  const one = (name: string) => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] ?? "" : v ?? "";
  };
  const id = one("svix-id");
  const timestamp = one("svix-timestamp");
  const signatures = one("svix-signature");
  if (!id || !/^\d{1,12}$/.test(timestamp) || !signatures) return "bad_signature";
  if (Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return "stale";
  let key: Buffer;
  try {
    key = Buffer.from(secret.slice("whsec_".length), "base64");
  } catch {
    return "not_configured";
  }
  if (!key.length) return "not_configured";
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.`)
    .update(rawBody)
    .digest();
  for (const part of signatures.split(" ")) {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) continue;
    let given: Buffer;
    try {
      given = Buffer.from(value, "base64");
    } catch {
      continue;
    }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return "ok";
  }
  return "bad_signature";
}

/** Delivery states, in the order they can only move forward. */
const RANK: Record<string, number> = { accepted: 0, delivered: 1, suppressed: 2, bounced: 3, complained: 4 };

const EVENTS: Record<string, "delivered" | "bounced" | "complained"> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

export type WebhookEvent = {
  type?: unknown;
  data?: { email_id?: unknown; to?: unknown; bounce?: { type?: unknown } };
};

export type WebhookOutcome = { handled: boolean; delivery: "updated" | "unknown_message" | "ignored"; suppressed: number };

export async function handleResendEvent(event: WebhookEvent): Promise<WebhookOutcome> {
  const state = typeof event.type === "string" ? EVENTS[event.type] : undefined;
  if (!state) return { handled: false, delivery: "ignored", suppressed: 0 };
  const messageId = typeof event.data?.email_id === "string" ? event.data.email_id : "";
  let delivery: WebhookOutcome["delivery"] = "unknown_message";
  if (messageId) {
    const updated = await db.execute(sql`
      update mail_deliveries set state = ${state}, updated_at = now()
       where provider_message_id = ${messageId}
         and (case state
                when 'accepted' then 0 when 'delivered' then 1 when 'suppressed' then 2
                when 'bounced' then 3 when 'complained' then 4 else 0 end) < ${RANK[state]!}
    `);
    if ((updated.rowCount ?? 0) > 0) delivery = "updated";
    else {
      const known = await db.execute(sql`select 1 from mail_deliveries where provider_message_id = ${messageId}`);
      if (known.rows.length) delivery = "updated";
    }
  }
  let suppressed = 0;
  const temporary = state === "bounced" && String(event.data?.bounce?.type ?? "").toLowerCase() === "transient";
  if ((state === "bounced" && !temporary) || state === "complained") {
    const to = Array.isArray(event.data?.to) ? event.data!.to : typeof event.data?.to === "string" ? [event.data.to] : [];
    for (const address of to) {
      if (typeof address !== "string" || !address.includes("@")) continue;
      await db.execute(sql`
        insert into email_suppressions (address_hmac, reason, scope)
        values (${addressFingerprint("all", address)}, ${state === "bounced" ? "bounce" : "complaint"}, 'all')
        on conflict do nothing
      `);
      suppressed += 1;
    }
  }
  return { handled: true, delivery, suppressed };
}
