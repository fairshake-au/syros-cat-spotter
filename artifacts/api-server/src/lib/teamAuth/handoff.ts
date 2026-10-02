import { verify, type KeyObject } from "node:crypto";
import { HANDOFF_AUDIENCE, HANDOFF_ISSUER } from "./config";

// Checking the sign-in Worker's hand-off pass (team-access spec §2.4 steps
// 1–4). A compact JWS signed with Ed25519. Steps 5 (single use) and 6 (still
// on the list) need the database and live in routes/team.ts.
//
// The algorithm is fixed here, in code: Ed25519, via crypto.verify(null, …)
// with an Ed25519 key object. The token's own `alg` is never used to choose
// how to check it. As an extra guard, a header whose `alg` isn't exactly
// `EdDSA` is refused outright.

export const MAX_TOKEN_LENGTH = 2048;
/** Clock-skew allowance, each way (§2.4 step 4). */
export const SKEW_SECONDS = 60;
/** Longest life a pass may claim (exp − iat). */
export const MAX_LIFETIME_SECONDS = 60;

export interface HandoffClaims {
  sub: string;
  sv: number;
  jti: string;
  iat: number;
  exp: number;
}

export type HandoffCheck =
  { ok: true; claims: HandoffClaims } | { ok: false; reason: string };

const B64URL_PART = /^[A-Za-z0-9_-]+$/;
const JTI = /^[A-Za-z0-9_-]{16,128}$/;

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(part, "base64url").toString("utf8"),
    );
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const fail = (reason: string): HandoffCheck => ({ ok: false, reason });

/**
 * Steps 1–4: shape, signature, issuer and audience, time. Returns the claims
 * the route still needs (`sub`, `sv`, `jti`), or the reason for the log.
 */
export function checkHandoffToken(
  token: unknown,
  publicKeys: KeyObject[] | null,
  nowSeconds: number,
): HandoffCheck {
  // Step 1: parse without trusting the header.
  if (!publicKeys || publicKeys.length === 0) return fail("not_configured");
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    return fail("malformed");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((p) => B64URL_PART.test(p))) {
    return fail("malformed");
  }
  const [headerPart, payloadPart, signaturePart] = parts as [
    string,
    string,
    string,
  ];
  const header = decodeJson(headerPart);
  if (!header) return fail("malformed");
  if (header["alg"] !== "EdDSA") return fail("wrong_alg");
  const signature = Buffer.from(signaturePart, "base64url");
  if (signature.length !== 64) return fail("bad_signature");

  // Step 2: the signature, against the pinned key or either of two.
  const signed = Buffer.from(`${headerPart}.${payloadPart}`, "ascii");
  const verified = publicKeys.some((key) => {
    try {
      return (
        key.asymmetricKeyType === "ed25519" &&
        verify(null, signed, key, signature)
      );
    } catch {
      return false;
    }
  });
  if (!verified) return fail("bad_signature");

  const claims = decodeJson(payloadPart);
  if (!claims) return fail("malformed");

  // Step 3: issuer and audience, exactly.
  if (claims["iss"] !== HANDOFF_ISSUER) return fail("wrong_iss");
  if (claims["aud"] !== HANDOFF_AUDIENCE) return fail("wrong_aud");

  // Step 4: time, with 60 seconds' allowance each way, and no pass that
  // claims to live longer than 60 seconds.
  const { iat, exp, sub, sv, jti } = claims;
  if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) {
    return fail("malformed");
  }
  const issuedAt = iat as number;
  const expiresAt = exp as number;
  if (nowSeconds > expiresAt + SKEW_SECONDS) return fail("expired");
  if (issuedAt > nowSeconds + SKEW_SECONDS) return fail("issued_in_future");
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_LIFETIME_SECONDS) {
    return fail("lifetime_too_long");
  }

  if (typeof sub !== "string" || sub.length === 0 || sub.length > 64) {
    return fail("malformed");
  }
  if (!Number.isSafeInteger(sv) || (sv as number) < 1) return fail("malformed");
  if (typeof jti !== "string" || !JTI.test(jti)) return fail("malformed");

  return {
    ok: true,
    claims: { sub, sv: sv as number, jti, iat: issuedAt, exp: expiresAt },
  };
}
