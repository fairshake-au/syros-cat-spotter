import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { checkInternalToken, internalTokenConfigured } from "./internalAuth";

/**
 * SYC-113: the API's pre-launch pass.
 * Plan: docs/superpowers/plans/syc-113-pre-launch-gates.md, item 2.
 *
 * Settings are read on every request (the OWNER_SECRET and PR #20
 * precedent), so tests can flip them and a removed secret takes effect at
 * once.
 *
 * The cookie format is duplicated from artifacts/cat-spotter/server/prelaunch.js
 * (the website issues the cookie; the API accepts it). Both copies are pinned
 * by artifacts/cat-spotter/lib/__fixtures__/prelaunch-cookie-vectors.json.
 */

export const PRELAUNCH_COOKIE = "__Host-cs_prelaunch";
export const SESSION_SECONDS = 28 * 24 * 60 * 60;
const COOKIE_VERSION = "v1";
const MIN_KEY_BYTES = 32;

/**
 * On unless NODE_ENV is exactly "development" or "test". An unset or
 * unexpected NODE_ENV in production must never open the API while the
 * website stays shut (plan review finding 1).
 * - development / test: off unless PRELAUNCH_GATE=on.
 * - anything else: on unless PRELAUNCH_GATE=off.
 */
export function gateEnabled(): boolean {
  const nodeEnv = process.env["NODE_ENV"];
  const flag = process.env["PRELAUNCH_GATE"];
  if (nodeEnv === "development" || nodeEnv === "test") return flag === "on";
  return flag !== "off";
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** PRELAUNCH_SESSION_KEYS as key buffers; keys under 32 bytes count as missing. */
export function sessionKeys(): Buffer[] {
  return splitList(process.env["PRELAUNCH_SESSION_KEYS"])
    .map((s) => Buffer.from(s, "base64url"))
    .filter((buf) => buf.length >= MIN_KEY_BYTES);
}

export function testerKeys(): string[] {
  return splitList(process.env["PRELAUNCH_TESTER_KEYS"]);
}

function hmac(key: Buffer, expiry: number): string {
  return createHmac("sha256", key).update(String(expiry)).digest("base64url");
}

/** Signs a session cookie value (used by tests and the shared vectors). */
export function signSession(keys: Buffer[], nowSeconds: number): string {
  const key = keys[0];
  if (!key) throw new Error("no session key");
  const expiry = nowSeconds + SESSION_SECONDS;
  return `${COOKIE_VERSION}.${expiry}.${hmac(key, expiry)}`;
}

function safeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function verifyCookieValue(
  keys: Buffer[],
  value: string,
  nowSeconds: number,
): boolean {
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [version, expiryText, signature] = parts as [string, string, string];
  if (version !== COOKIE_VERSION) return false;
  if (!/^\d{1,12}$/.test(expiryText)) return false;
  const expiry = Number(expiryText);
  if (expiry <= nowSeconds) return false;
  if (expiry > nowSeconds + SESSION_SECONDS) return false;
  let ok = false;
  for (const key of keys) {
    if (safeEqualStrings(hmac(key, expiry), signature)) ok = true;
  }
  return ok;
}

/** True when any `__Host-cs_prelaunch` cookie in the header is valid (all are tried). */
export function verifySession(
  keys: Buffer[],
  cookieHeader: string | undefined,
  nowSeconds: number,
): boolean {
  if (!keys.length || !cookieHeader) return false;
  let ok = false;
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== PRELAUNCH_COOKIE) continue;
    if (verifyCookieValue(keys, pair.slice(eq + 1).trim(), nowSeconds)) ok = true;
  }
  return ok;
}

function sha256(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

/** Constant-time match of an `X-Prelaunch-Key` header against every configured tester key. */
export function matchTesterKey(
  keys: string[],
  supplied: string | undefined,
): boolean {
  if (!supplied) return false;
  const suppliedHash = sha256(supplied);
  let ok = false;
  for (const key of keys) {
    if (timingSafeEqual(sha256(key), suppliedHash)) ok = true;
  }
  return ok;
}

/** The Worker's bearer on /api/internal/* (shared with PR #20 via lib/internalAuth.ts). */
export function matchInternalToken(authorization: string | undefined) {
  return checkInternalToken(authorization);
}

/** Start-up lines: whether the gate is on and which settings are present (never values). */
export function describeGate(): string[] {
  const lines: string[] = [];
  const flag = process.env["PRELAUNCH_GATE"];
  if (flag !== undefined && flag !== "on" && flag !== "off") {
    lines.push(
      'WARNING: PRELAUNCH_GATE is set to an unrecognised value; treating it as "on" (outside development and test). Use exactly "on" or "off".',
    );
  }
  if (!gateEnabled()) {
    lines.push("prelaunch gate: off");
  } else {
    lines.push(
      `prelaunch gate: on (session keys: ${sessionKeys().length}, tester keys: ${testerKeys().length}, internal token: ${internalTokenConfigured() ? "yes" : "no"})`,
    );
  }
  return lines;
}
