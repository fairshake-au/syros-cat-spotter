import { createHmac } from "node:crypto";

/**
 * The app's one keyed fingerprint of an email address (SYC-3 plan, Decision 4;
 * SYC-179). An HMAC-SHA256 under EMAIL_FINGERPRINT_KEY, a secret only the API
 * holds, so someone holding the database or the logs plus a guess at an
 * address can't confirm it.
 *
 * **Purpose-separated (review A3).** The label goes into the HMAC, so the
 * keep-safe fingerprint of an address never equals its report or news
 * fingerprint. A leaked database can't join a report or news row (which holds
 * the address) to a keep-safe row (which never does) and recover a parent's
 * address for a child's spotter.
 *
 * - `keep_safe`, `report`, `news`: `email_contacts.address_hmac`, the tokens and
 *   requests for that purpose, and that purpose's own suppressions (a keep-safe
 *   "Forget this address" only ever has the keep-safe fingerprint to hand).
 * - `all`: suppressions that block every purpose (bounce, complaint, "never
 *   email me").
 * - `team`: the staff alert mailbox, for logs.
 * - `ip`: a requester's IP address, for the limits.
 *
 * If the key is missing, nothing is fingerprinted: callers that need one fail
 * closed, and logs say `nokey` rather than fall back to an unkeyed hash.
 */

export type FingerprintLabel = "keep_safe" | "report" | "news" | "all" | "team" | "ip";

const MIN_KEY_LENGTH = 32;

export class FingerprintKeyMissing extends Error {
  constructor() {
    super("EMAIL_FINGERPRINT_KEY is not set");
    this.name = "FingerprintKeyMissing";
  }
}

function key(): string {
  const value = process.env["EMAIL_FINGERPRINT_KEY"] ?? "";
  if (value.length < MIN_KEY_LENGTH) throw new FingerprintKeyMissing();
  return value;
}

export function fingerprintConfigured(): boolean {
  return (process.env["EMAIL_FINGERPRINT_KEY"] ?? "").length >= MIN_KEY_LENGTH;
}

/** Trimmed and lower-cased only. Gmail dots and `+tags` are kept (review A8). */
export function normaliseAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function fingerprint(label: FingerprintLabel, value: string): string {
  return createHmac("sha256", key()).update(`${label}:${value}`).digest("hex");
}

export function addressFingerprint(label: Exclude<FingerprintLabel, "ip">, address: string): string {
  return fingerprint(label, normaliseAddress(address));
}

export function ipFingerprint(ip: string): string {
  return fingerprint("ip", ip);
}

/** `samuel@gmail.com` → `s•••@gmail.com`: the only form ever shown back. */
export function maskAddress(address: string): string {
  const normal = normaliseAddress(address);
  const at = normal.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${normal[0]}•••${normal.slice(at)}`;
}

const SINGLE_ADDRESS = /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/;

export function looksLikeAddress(address: string): boolean {
  const normal = normaliseAddress(address);
  return normal.length <= 254 && SINGLE_ADDRESS.test(normal);
}
