import { createHash, randomBytes } from "node:crypto";

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
