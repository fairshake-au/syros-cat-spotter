import { createPublicKey, type KeyObject } from "node:crypto";

// Settings for the staff dashboard's sign-in (team-access spec §2.4, §2.11,
// §8.2). Read on every request, never cached when the file loads (the
// OWNER_SECRET precedent in routes/notifications.ts): a removed secret takes
// effect straight away, and tests can check "not configured", "configured"
// and "mid key change" without reloading modules.

/** Who mints hand-off passes: the sign-in Worker. */
export const HANDOFF_ISSUER = "https://admin.catspotters.com";
/** Who may accept them: the dashboard. */
export const HANDOFF_AUDIENCE = "https://team.catspotters.com";
/** The only Origin a hand-off may come from (login CSRF, SYC-25). */
export const SIGN_IN_ORIGIN = "https://admin.catspotters.com";
/** The only Origin a dashboard POST may come from. */
export const TEAM_ORIGIN = "https://team.catspotters.com";
/** Where a signed-in person lands. */
export const TEAM_HOME = "https://team.catspotters.com/api/team/";
/** Where a refused browser is sent back to. */
export const SIGN_IN_PAGE = "https://admin.catspotters.com/";

const B64URL = /^[A-Za-z0-9_-]+$/;

/**
 * TEAM_HANDOFF_PUBLIC_KEYS: one or two raw Ed25519 public keys,
 * base64url-encoded, comma-separated (two only during a key change). Not
 * secret: a public key can only check passes, never create them.
 *
 * Null when unset or malformed, so every hand-off is refused (fails closed).
 */
export function handoffPublicKeys(
  env: NodeJS.ProcessEnv = process.env,
): KeyObject[] | null {
  const raw = env["TEAM_HANDOFF_PUBLIC_KEYS"];
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 1 || parts.length > 2) return null;
  const keys: KeyObject[] = [];
  for (const part of parts) {
    if (!B64URL.test(part)) return null;
    if (Buffer.from(part, "base64url").length !== 32) return null;
    try {
      keys.push(
        createPublicKey({
          key: { kty: "OKP", crv: "Ed25519", x: part },
          format: "jwk",
        }),
      );
    } catch {
      return null;
    }
  }
  return keys;
}

/** Shortest acceptable session key, in bytes. */
export const MIN_SESSION_KEY_BYTES = 32;

/**
 * TEAM_SESSION_KEYS: one HMAC key, or two during a change, comma-separated.
 * New sessions are signed with the first; either is accepted. Each must be
 * at least 32 bytes. Null when unset or too short, so no session is issued
 * or accepted (fails closed).
 */
export function sessionKeys(
  env: NodeJS.ProcessEnv = process.env,
): Buffer[] | null {
  const raw = env["TEAM_SESSION_KEYS"];
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 1 || parts.length > 2) return null;
  const keys = parts.map((p) => Buffer.from(p, "utf8"));
  if (keys.some((k) => k.length < MIN_SESSION_KEY_BYTES)) return null;
  return keys;
}
