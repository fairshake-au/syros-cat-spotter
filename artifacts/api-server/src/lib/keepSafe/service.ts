import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { addressFingerprint, ipFingerprint, maskAddress, normaliseAddress } from "../mail/fingerprint";
import { enqueueKeepSafeMail } from "../mail/outbox";
import { isKeepSafeSuppressed } from "../mail/suppression";
import { hashToken, newToken, RESTORE_TOKEN_MINUTES, VERIFY_TOKEN_DAYS } from "./tokens";

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
  /** team-access §2.6: 3 restore requests per address per 15 minutes. */
  restorePerAddressPer15Min: 3,
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
        await tx.execute(sql`
          insert into email_consent_events (contact_id, device_id, address_hmac, purpose, event, surface, wording_version, language)
          values (${existing.id}, ${input.deviceId}, ${existing.address_hmac}, 'keep_safe', 'withdrawn', ${input.surface}, ${input.wordingVersion}, ${input.language})
        `);
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
    const recentToAddress = await count(tx, sql`
      select count(*)::int as n from email_consent_events
       where purpose = 'keep_safe' and event = 'verify_sent' and address_hmac = ${hmac}
         and occurred_at > now() - make_interval(hours => ${LIMITS.verifyPerAddressHours})
    `);
    if (recentToAddress > 0) return skip("per_address_24h");
    const confirmedSomewhere = await count(tx, sql`
      select count(*)::int as n from email_contacts
       where purpose = 'keep_safe' and address_hmac = ${hmac} and status = 'confirmed'
    `);
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
      returning id, address_hmac
    `);
    for (const row of removed.rows as { id: number; address_hmac: string }[]) {
      await tx.execute(sql`
        insert into email_consent_events (contact_id, device_id, address_hmac, purpose, event, surface)
        values (${row.id}, ${deviceId}, ${row.address_hmac}, 'keep_safe', 'withdrawn', 'settings')
      `);
    }
  });
}

// ── Confirm and forget (step 4) ────────────────────────────────────────────

/** Read-only: is this a live, unused token of this purpose? (GET never changes anything.) */
export async function tokenIsLive(raw: string, purpose: "verify" | "forget"): Promise<boolean> {
  const result = await db.execute(sql`
    select 1 from mail_tokens
     where token_hash = ${hashToken(raw)} and purpose = ${purpose}
       and used_at is null and expires_at > now()
  `);
  return result.rows.length > 0;
}

/** "Yes, that was me": the address becomes confirmed. */
export async function confirmAddress(raw: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const used = await tx.execute(sql`
      update mail_tokens set used_at = now()
       where token_hash = ${hashToken(raw)} and purpose = 'verify'
         and used_at is null and expires_at > now()
      returning contact_id, device_id, address_hmac
    `);
    const token = used.rows[0] as { contact_id: number | null; device_id: string; address_hmac: string } | undefined;
    if (!token?.contact_id) return false;
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
    return true;
  });
}

/**
 * "Forget this address": the row and its tokens go, and the keep-safe
 * fingerprint goes on the suppression list for keep-safe mail (A10).
 */
export async function forgetAddress(raw: string): Promise<boolean> {
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
      await tx.execute(sql`delete from email_contacts where id = ${token.contact_id}`);
    }
    await tx.execute(sql`
      insert into email_suppressions (address_hmac, reason, scope)
      values (${token.address_hmac}, 'forget', 'keep_safe') on conflict do nothing
    `);
    await tx.execute(sql`
      insert into email_consent_events (contact_id, device_id, address_hmac, purpose, event, surface)
      values (${token.contact_id}, ${token.device_id}, ${token.address_hmac}, 'keep_safe', 'withdrawn', 'email')
    `);
    return true;
  });
}

// ── Asking for a restore (step 5) ──────────────────────────────────────────

/**
 * Record the request and, if the address is confirmed for at least one
 * spotter and every limit has room, create a restore token bound to the
 * asking phone and queue the link. Returns the outbox row to kick after the
 * response, if any. The caller answers identically either way.
 */
export async function requestRestore(
  input: { askingDeviceId: string; email: string; ip: string },
  log: Log,
): Promise<number | null> {
  const to = normaliseAddress(input.email);
  const hmac = addressFingerprint("keep_safe", to);
  const ipHash = ipFingerprint(input.ip);

  return db.transaction(async (tx) => {
    await lockAddress(tx, hmac);
    await tx.execute(sql`insert into mail_requests (kind, address_hmac, ip_hash) values ('restore', ${hmac}, ${ipHash})`);
    const skip = (reason: string, level: "info" | "warn" | "error" = "info") => {
      log[level]({ reason, addressHmac: hmac.slice(0, 10) }, "restore: no link sent");
      return null;
    };

    // Limits first, for known and unknown addresses alike (A1).
    const toAddress = await count(tx, sql`
      select count(*)::int as n from mail_requests
       where kind = 'restore' and address_hmac = ${hmac} and created_at > now() - interval '15 minutes'
    `);
    if (toAddress > LIMITS.restorePerAddressPer15Min) return skip("per_address");
    const fromIp = await count(tx, sql`
      select count(*)::int as n from mail_requests
       where kind = 'restore' and ip_hash = ${ipHash} and created_at > now() - interval '1 hour'
    `);
    if (fromIp > LIMITS.restorePerIpPerHour) return skip("per_ip");
    const today = await count(tx, sql`
      select count(*)::int as n from mail_requests
       where kind = 'restore' and created_at > now() - interval '1 day'
    `);
    if (today > dailyCeilings().restore) return skip("global_ceiling", "error");

    const known = await count(tx, sql`
      select count(*)::int as n from email_contacts
       where purpose = 'keep_safe' and address_hmac = ${hmac} and status = 'confirmed'
    `);
    if (!known) return skip("not_known");

    // At most three live links per address: the oldest expires to make room.
    await tx.execute(sql`
      update mail_tokens set expires_at = now()
       where token_hash in (
         select token_hash from mail_tokens
          where purpose = 'restore' and address_hmac = ${hmac}
            and used_at is null and expires_at > now()
          order by created_at desc
          offset ${LIMITS.restoreLiveLinks - 1}
       )
    `);
    const token = newToken();
    const expiresAt = new Date(Date.now() + RESTORE_TOKEN_MINUTES * 60 * 1000);
    await tx.execute(sql`
      insert into mail_tokens (token_hash, purpose, address_hmac, device_id, expires_at)
      values (${hashToken(token)}, 'restore', ${hmac}, ${input.askingDeviceId}, ${expiresAt})
    `);
    return enqueueKeepSafeMail(tx, { purpose: "restore_link", to, token, expiresAt });
  });
}
