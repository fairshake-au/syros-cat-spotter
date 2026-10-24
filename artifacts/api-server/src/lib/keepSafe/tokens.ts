import { createHash, randomBytes, randomInt } from "node:crypto";

import { fingerprint } from "../mail/fingerprint";

/**
 * One-time link tokens (SYC-3 plan, Slice 1 steps 4–6): 32 random bytes,
 * base64url in the link, stored only as a sha256 hash. The raw token is in the
 * email and, until the email is sent, the outbox row (outbox.ts clears it).
 */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** A raw token as it arrives: base64url, 43 characters. Anything else is refused unread. */
export function isTokenShaped(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{43}$/.test(raw);
}

/** For logs: enough to find the row, useless as a token. */
export function tokenLogId(raw: string): string {
  return hashToken(raw).slice(0, 10);
}

export const VERIFY_TOKEN_DAYS = 7;
export const RESTORE_TOKEN_MINUTES = 15;

export const RESTORE_CODE_DIGITS = 8;
export const RESTORE_CODE_TRIES = 5;

/** The 8-digit code in the restore email, leading zeros kept. */
export function newCode(): string {
  return String(randomInt(0, 10 ** RESTORE_CODE_DIGITS)).padStart(RESTORE_CODE_DIGITS, "0");
}

/**
 * Keyed hash of a code, bound to the token row it belongs to, so a leaked
 * database can't be brute-forced without the key and one row's hash is no use
 * against another. Never store the raw code.
 */
export function codeHash(tokenHash: string, code: string): string {
  return fingerprint("restore_code", `${tokenHash}:${code}`);
}

/** Digits only, exactly 8. The app strips spaces before sending. */
export function isCodeShaped(raw: unknown): raw is string {
  return typeof raw === "string" && new RegExp(`^\\d{${RESTORE_CODE_DIGITS}}$`).test(raw);
}
