import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { addressFingerprint, deviceFingerprint, ipFingerprint, maskAddress, normaliseAddress } from "../mail/fingerprint";
import { enqueueKeepSafeMail } from "../mail/outbox";
import { isKeepSafeSuppressed } from "../mail/suppression";
import { codeHash, hashToken, newCode, newToken, RESTORE_TOKEN_MINUTES, VERIFY_TOKEN_DAYS } from "./tokens";
import { confirmReporterAddress, forgetReporterAddress } from "../welfare/reporterEmail";

/**
 * "Keep my spots safe": adding an address, confirming or forgetting it, and
 * asking for a restore link (SYC-3 plan, Slice 1 steps 3–5). The move itself
 * is in move.ts.
 *
 * Every limit is counted in Postgres from `mail_requests` (review A1), which
 * holds a row for EVERY add and EVERY restore request, known address or not.
 * So the limits hold across servers without waiting for SYC-105, and an
 * unknown address uses them up exactly as a known one does: the difference
 * can't tell an attacker which addresses are kept safe.
 *
 * Each request takes a transaction-scoped advisory lock on its address
 * fingerprint, so two servers counting the same address queue up rather than
 * both seeing room for one more.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const LIMITS = {
  /** §4.4 (1): one "is this you?" per address per 24 hours… */
  verifyPerAddressHours: 24,
  /** …and three in the address's lifetime, then suppression. */
  verifyLifetime: 3,
  /** §4.4 (2): per IP, on adding an address. */
  addPerIpPerHour: 20,
  /**
   * 3 restore requests per address per 15 minutes, counted **per asking
   * phone** (Samuel, 8 Oct 2026, adversarial review finding 2): a shared
   * count let a stranger keep a family from ever getting their own link.
   */
  restorePerPhonePer15Min: 3,
  /** A confirmed address gets at most 3 "is this you?" emails a day (Samuel, 8 Oct 2026). */
  verifyConfirmedPerDay: 3,
  /** 20 per IP per hour. */
  restorePerIpPerHour: 20,
  /** At most 3 unexpired links per address; the oldest expires to make room. */
  restoreLiveLinks: 3,
};

function ceiling(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw >= 0 ? raw : fallback;
}

/** §4.4 (3): the global daily ceilings. They fail closed. */
export function dailyCeilings() {
  return {
    verify: ceiling("KEEP_SAFE_VERIFY_DAILY_CEILING", 200),
    restore: ceiling("KEEP_SAFE_RESTORE_DAILY_CEILING", 200),
  };
}

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };

async function lockAddress(tx: Tx, hmac: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"keep_safe:" + hmac}, 0))`);
}

async function count(tx: Tx, query: ReturnType<typeof sql>): Promise<number> {
  const result = await tx.execute(query);
  return Number((result.rows[0] as { n: number | string } | undefined)?.n ?? 0);
}

/**
 * An address nobody confirmed, deleted before the sweep (changed, removed or
 * forgotten): its consent record keeps only that an unconfirmed attempt was
 * withdrawn, as the 7-day sweep does (email-capture.md §5.5; review of #106,
 * finding 4). The keyed fingerprint stays, for the lifetime cap.
 */
async function redactUnconfirmed(tx: Tx, contactId: number): Promise<void> {
  await tx.execute(sql`
    update email_consent_events
       set contact_id = null, device_id = null,
           redacted_at = now(), redaction_reason = 'unconfirmed address withdrawn'
     where contact_id = ${contactId} and redacted_at is null
  `);
}

/** The "withdrawn" event: identifying only when a confirmed address is withdrawn. */
async function withdrawnEvent(
  tx: Tx,
  row: { id: number; address_hmac: string; status: string },
  deviceId: string,
  surface: string,
): Promise<void> {
  if (row.status === "confirmed") {
    await tx.execute(sql`
      insert into email_consent_events (contact_id, device_id, address_hmac, purpose, event, surface)
      values (${row.id}, ${deviceId}, ${row.address_hmac}, 'keep_safe', 'withdrawn', ${surface})
    `);
    return;
  }
  await redactUnconfirmed(tx, row.id);
  await tx.execute(sql`
    insert into email_consent_events (address_hmac, purpose, event, surface)
    values (${row.address_hmac}, 'keep_safe', 'withdrawn', ${surface})
  `);
}

// ── Adding an address (step 3) ─────────────────────────────────────────────

export type KeepSafeState =
  | { status: "none" }
  | { status: "pending" | "confirmed"; addressMask: string };

export async function keepSafeState(deviceId: string): Promise<KeepSafeState> {
  const result = await db.execute(sql`
    select status, address_mask from email_contacts
     where purpose = 'keep_safe' and device_id = ${deviceId}
  `);
  const row = result.rows[0] as { status: "pending" | "confirmed"; address_mask: string } | undefined;
  return row ? { status: row.status, addressMask: row.address_mask } : { status: "none" };
}

export type AddInput = {
  deviceId: string;
  email: string;
  language: string;
  wordingVersion: string;
  surface: string;
  ip: string;
};

/**
 * Store the address as `pending`, write the consent event, and (within the
 * limits) queue one "is this you?" email. Returns the outbox row to kick once
 * the transaction has committed, if any. The caller answers the same way
 * whatever happened.
 */
export async function addKeepSafeAddress(input: AddInput, log: Log): Promise<{ state: KeepSafeState; outboxId: number | null }> {
  const to = normaliseAddress(input.email);
  const hmac = addressFingerprint("keep_safe", to);
  const ipHash = ipFingerprint(input.ip);
  const mask = maskAddress(to);

  return db.transaction(async (tx) => {
    await lockAddress(tx, hmac);
    await tx.execute(sql`insert into mail_requests (kind, address_hmac, ip_hash) values ('add', ${hmac}, ${ipHash})`);

    const existing = (
      await tx.execute(sql`
        select id, address_hmac, status from email_contacts
         where purpose = 'keep_safe' and device_id = ${input.deviceId}
         for update
      `)
    ).rows[0] as { id: number; address_hmac: string; status: "pending" | "confirmed" } | undefined;

    // The same address, already confirmed: nothing to do.
    if (existing && existing.address_hmac === hmac && existing.status === "confirmed") {
      return { state: { status: "confirmed", addressMask: mask }, outboxId: null };
    }

    let contactId: number;
    if (existing && existing.address_hmac === hmac) {
      contactId = existing.id;
    } else {
      if (existing) {
        // Changing the address replaces the row and needs confirming again.
        await tx.execute(sql`delete from email_contacts where id = ${existing.id}`);
        await withdrawnEvent(tx, existing, input.deviceId, input.surface);
      }
      const inserted = await tx.execute(sql`
        insert into email_contacts (purpose, address_hmac, address_mask, device_id, status)
        values ('keep_safe', ${hmac}, ${mask}, ${input.deviceId}, 'pending')
        returning id
      `);
      contactId = (inserted.rows[0] as { id: number }).id;
    }
    await tx.execute(sql`
      insert into email_consent_events (contact_id, device_id, address_hmac, purpose, event, surface, wording_version, language)
      values (${contactId}, ${input.deviceId}, ${hmac}, 'keep_safe', 'consented', ${input.surface}, ${input.wordingVersion}, ${input.language})
    `);

    const state: KeepSafeState = { status: "pending", addressMask: mask };
    const skip = (reason: string, level: "info" | "warn" | "error" = "info") => {
      log[level]({ reason, addressHmac: hmac.slice(0, 10) }, "keep-safe: no \"is this you?\" email sent");
      return { state, outboxId: null };
    };

    if (await isKeepSafeSuppressed("keep_safe_verify", to)) return skip("suppressed");
    const confirmedSomewhere = await count(tx, sql`
      select count(*)::int as n from email_contacts
       where purpose = 'keep_safe' and address_hmac = ${hmac} and status = 'confirmed'
    `);
    // §4.4's one-per-24-hours protects a stranger's inbox. An address already
    // confirmed for a spotter isn't a stranger's: a parent adding a second
    // child the same evening gets the email (Samuel, 8 Oct 2026, SYC-261).
    // The per-IP limit and the daily ceiling below still apply.
    if (confirmedSomewhere) {
      // Siblings still set up in one sitting, but a stranger who knows a
      // confirmed parent's address can't flood it (Samuel, 8 Oct 2026).
      const today = await count(tx, sql`
        select count(*)::int as n from email_consent_events
         where purpose = 'keep_safe' and event = 'verify_sent' and address_hmac = ${hmac}
           and occurred_at > now() - interval '1 day'
      `);
      if (today >= LIMITS.verifyConfirmedPerDay) return skip("confirmed_daily_cap");
    }
    if (!confirmedSomewhere) {
      const recentToAddress = await count(tx, sql`
        select count(*)::int as n from email_consent_events
         where purpose = 'keep_safe' and event = 'verify_sent' and address_hmac = ${hmac}
           and occurred_at > now() - make_interval(hours => ${LIMITS.verifyPerAddressHours})
      `);
      if (recentToAddress > 0) return skip("per_address_24h");
    }
    if (!confirmedSomewhere) {
      const lifetime = await count(tx, sql`
        select count(*)::int as n from email_consent_events
         where purpose = 'keep_safe' and event = 'verify_sent' and address_hmac = ${hmac}
      `);
      if (lifetime >= LIMITS.verifyLifetime) {
        await tx.execute(sql`
          insert into email_suppressions (address_hmac, reason, scope)
          values (${hmac}, 'verify_cap', 'keep_safe') on conflict do nothing
        `);
        return skip("lifetime_cap");
      }
    }
    const fromIp = await count(tx, sql`
      select count(*)::int as n from mail_requests
       where kind = 'add' and ip_hash = ${ipHash} and created_at > now() - interval '1 hour'
    `);
    if (fromIp > LIMITS.addPerIpPerHour) return skip("per_ip");
    const today = await count(tx, sql`
      select count(*)::int as n from email_consent_events
       where event = 'verify_sent' and occurred_at > now() - interval '1 day'
    `);
    if (today >= dailyCeilings().verify) return skip("global_ceiling", "error");

    const token = newToken();
    const forgetToken = newToken();
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_DAYS * 24 * 60 * 60 * 1000);
    for (const [raw, purpose] of [[token, "verify"], [forgetToken, "forget"]] as const) {
      await tx.execute(sql`
        insert into mail_tokens (token_hash, purpose, contact_id, address_hmac, device_id, expires_at)
        values (${hashToken(raw)}, ${purpose}, ${contactId}, ${hmac}, ${input.deviceId}, ${expiresAt})
      `);
    }
    await tx.execute(sql`
      insert into email_consent_events (contact_id, device_id, address_hmac, purpose, event, surface, wording_version, language)
      values (${contactId}, ${input.deviceId}, ${hmac}, 'keep_safe', 'verify_sent', ${input.surface}, ${input.wordingVersion}, ${input.language})
    `);
    const outboxId = await enqueueKeepSafeMail(tx, { purpose: "keep_safe_verify", to, token, forgetToken, expiresAt });
    return { state, outboxId };
  });
}

/** **Remove** in Settings: the row and its tokens go, and a "withdrawn" event is written. */
export async function removeKeepSafeAddress(deviceId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const removed = await tx.execute(sql`
      delete from email_contacts where purpose = 'keep_safe' and device_id = ${deviceId}
      returning id, address_hmac, status
    `);
    for (const row of removed.rows as { id: number; address_hmac: string; status: string }[]) {
      await withdrawnEvent(tx, row, deviceId, "settings");
    }
  });
}

// ── Confirm and forget (step 4) ────────────────────────────────────────────

/**
 * Whose address a link is about: decides the page's words (SYC-42 Slice 3).
 * `report_delete` is a forget link to a CONFIRMED report address: the
 * "Delete my details" link in an acknowledgement or outcome.
 */
export type LinkPurpose = "keep_safe" | "report" | "report_delete";

/**
 * Read-only: is this a live, unused token of this purpose, and whose address
 * is it? Null when it isn't live. (GET never changes anything.)
 */
export async function tokenIsLive(raw: string, purpose: "verify" | "forget"): Promise<LinkPurpose | null> {
  const result = await db.execute(sql`
    select c.purpose, c.status from mail_tokens t
      left join email_contacts c on c.id = t.contact_id
     where t.token_hash = ${hashToken(raw)} and t.purpose = ${purpose}
       and t.used_at is null and t.expires_at > now()
  `);
  const row = result.rows[0] as { purpose: string | null; status: string | null } | undefined;
  if (!row) return null;
  if (row.purpose !== "report") return "keep_safe";
  return purpose === "forget" && row.status === "confirmed" ? "report_delete" : "report";
}

export type ConfirmOutcome = false | { purpose: "keep_safe" | "report"; outboxIds: number[] };

/**
 * "Yes, that was me": the address becomes confirmed. For a report address
 * (SYC-42 Slice 3) that also queues what was held for it: the caller kicks
 * `outboxIds` once this has committed.
 */
export async function confirmAddress(raw: string): Promise<ConfirmOutcome> {
  return db.transaction(async (tx) => {
    const used = await tx.execute(sql`
      update mail_tokens set used_at = now()
       where token_hash = ${hashToken(raw)} and purpose = 'verify'
         and used_at is null and expires_at > now()
      returning contact_id, device_id, address_hmac
    `);
    const token = used.rows[0] as { contact_id: number | null; device_id: string; address_hmac: string } | undefined;
    if (!token?.contact_id) return false;
    const [contact] = (
      await tx.execute(sql`select purpose from email_contacts where id = ${token.contact_id}`)
    ).rows as { purpose: string }[];
    if (contact?.purpose === "report") {
      return { purpose: "report", outboxIds: await confirmReporterAddress(tx, token.address_hmac, token.device_id) };
    }
    const confirmed = await tx.execute(sql`
      update email_contacts set status = 'confirmed', confirmed_at = now()
       where id = ${token.contact_id} and status = 'pending'
      returning id
    `);
    if (!confirmed.rows.length) return false;
    await tx.execute(sql`
      insert into email_consent_events (contact_id, device_id, address_hmac, purpose, event)
      values (${token.contact_id}, ${token.device_id}, ${token.address_hmac}, 'keep_safe', 'verified')
    `);
    return { purpose: "keep_safe", outboxIds: [] };
  });
}

/** `report_forgotten` / `report_deleted`: a report address (SYC-42 Slice 3). */
export type ForgetOutcome = false | "forgotten" | "request_cancelled" | "report_forgotten" | "report_deleted";

/**
 * "Forget this address" (A10; SYC-262).
 *
 * - Usually: the row and its tokens go, and the keep-safe fingerprint goes on
 *   the suppression list for all keep-safe mail.
 * - When the address already keeps **another** spotter safe (a stranger, or a
 *   typo, used a family's address): only this request is cancelled, and
 *   further "is this you?" emails stop (`forget_verify`). The family's own
 *   restore links keep working, so one reflex tap can't lock a child out of
 *   their spots (Samuel, 8 Oct 2026). A family that wants no keep-safe mail at
 *   all uses Remove in the app.
 */
export async function forgetAddress(raw: string): Promise<ForgetOutcome> {
  return db.transaction(async (tx) => {
    const used = await tx.execute(sql`
      update mail_tokens set used_at = now()
       where token_hash = ${hashToken(raw)} and purpose = 'forget'
         and used_at is null and expires_at > now()
      returning contact_id, device_id, address_hmac
    `);
    const token = used.rows[0] as { contact_id: number | null; device_id: string; address_hmac: string } | undefined;
    if (!token) return false;
    if (token.contact_id) {
      const [contact] = (
        await tx.execute(sql`select purpose from email_contacts where id = ${token.contact_id}`)
      ).rows as { purpose: string }[];
      if (contact?.purpose === "report") {
        const done = await forgetReporterAddress(tx, { contactId: token.contact_id, hmac: token.address_hmac });
        return done === "deleted" ? "report_deleted" : "report_forgotten";
      }
    }
    const keepsAnotherSafe = await count(tx, sql`
      select count(*)::int as n from email_contacts
       where purpose = 'keep_safe' and address_hmac = ${token.address_hmac} and status = 'confirmed'
         and id is distinct from ${token.contact_id}
    `);
    let forgotten: { id: number; address_hmac: string; status: string } | undefined;
    if (token.contact_id) {
      forgotten = (
        await tx.execute(sql`delete from email_contacts where id = ${token.contact_id} returning id, address_hmac, status`)
      ).rows[0] as typeof forgotten;
    }
    const reason = keepsAnotherSafe ? "forget_verify" : "forget";
    await tx.execute(sql`
      insert into email_suppressions (address_hmac, reason, scope)
      values (${token.address_hmac}, ${reason}, 'keep_safe') on conflict do nothing
    `);
    if (forgotten) {
      await withdrawnEvent(tx, forgotten, token.device_id, "email");
    } else {
      await tx.execute(sql`
        insert into email_consent_events (address_hmac, purpose, event, surface)
        values (${token.address_hmac}, 'keep_safe', 'withdrawn', 'email')
      `);
    }
    return keepsAnotherSafe ? "request_cancelled" : "forgotten";
  });
}

// ── Asking for a restore (step 5) ──────────────────────────────────────────

/**
 * Record the request and, if the address is confirmed for at least one
 * spotter and every limit has room, create a restore token bound to the
 * asking phone and queue the link. Returns the outbox row to kick after the
 * response, if any. The caller answers identically either way.
 */
const ATHENS_HHMM = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Athens",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export async function requestRestore(
  input: { askingDeviceId: string; email: string; ip: string },
  log: Log,
): Promise<number | null> {
  const to = normaliseAddress(input.email);
  const hmac = addressFingerprint("keep_safe", to);
  const ipHash = ipFingerprint(input.ip);
  const requester = deviceFingerprint(input.askingDeviceId);

  return db.transaction(async (tx) => {
    await lockAddress(tx, hmac);
    await tx.execute(sql`
      insert into mail_requests (kind, address_hmac, ip_hash, requester_hash)
      values ('restore', ${hmac}, ${ipHash}, ${requester})
    `);
    const skip = (reason: string, level: "info" | "warn" | "error" = "info") => {
      log[level]({ reason, addressHmac: hmac.slice(0, 10) }, "restore: no link sent");
      return null;
    };

    // Limits first, for known and unknown addresses alike (A1).
    const fromThisPhone = await count(tx, sql`
      select count(*)::int as n from mail_requests
       where kind = 'restore' and address_hmac = ${hmac} and requester_hash = ${requester}
         and created_at > now() - interval '15 minutes'
    `);
    if (fromThisPhone > LIMITS.restorePerPhonePer15Min) return skip("per_phone");
    const fromIp = await count(tx, sql`
      select count(*)::int as n from mail_requests
       where kind = 'restore' and ip_hash = ${ipHash} and created_at > now() - interval '1 hour'
    `);
    if (fromIp > LIMITS.restorePerIpPerHour) return skip("per_ip");

    const known = await count(tx, sql`
      select count(*)::int as n from email_contacts
       where purpose = 'keep_safe' and address_hmac = ${hmac} and status = 'confirmed'
    `);
    if (!known) return skip("not_known");
    // The global ceiling counts links actually issued, not requests: otherwise
    // one phone asking for made-up addresses could switch restore off for
    // everyone for a day (adversarial review of #106, finding 1). It's global
    // and invisible to the caller, so it reveals nothing about any address.
    const issuedToday = await count(tx, sql`
      select count(*)::int as n from mail_tokens
       where purpose = 'restore' and created_at > now() - interval '1 day'
    `);
    if (issuedToday >= dailyCeilings().restore) return skip("global_ceiling", "error");

    // At most three live links per address per asking phone (Decision B): the
    // phone's own oldest expires to make room, so another phone's request can
    // never cost this one its code.
    await tx.execute(sql`
      update mail_tokens set expires_at = now()
       where token_hash in (
         select token_hash from mail_tokens
          where purpose = 'restore' and address_hmac = ${hmac}
            and device_id = ${input.askingDeviceId}
            and used_at is null and expires_at > now()
          order by created_at desc
          offset ${LIMITS.restoreLiveLinks - 1}
       )
    `);
    const token = newToken();
    const code = newCode();
    const tokenHash = hashToken(token);
    const asked = new Date();
    const expiresAt = new Date(asked.getTime() + RESTORE_TOKEN_MINUTES * 60 * 1000);
    await tx.execute(sql`
      insert into mail_tokens (token_hash, purpose, address_hmac, device_id, expires_at, code_hash)
      values (${tokenHash}, 'restore', ${hmac}, ${input.askingDeviceId}, ${expiresAt}, ${codeHash(tokenHash, code)})
    `);
    // Greek time (the island's), so a family with several emails can tell which one they just asked for.
    const askedAt = ATHENS_HHMM.format(asked);
    return enqueueKeepSafeMail(tx, { purpose: "restore_link", to, token, code, askedAt, expiresAt });
  });
}
