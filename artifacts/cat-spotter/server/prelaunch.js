/**
 * SYC-113: the website's pre-launch gate helpers.
 * Plan: docs/superpowers/plans/syc-113-pre-launch-gates.md, item 1.
 *
 * Node built-ins only, like serve-web.js.
 *
 * The cookie format here is duplicated in
 * artifacts/api-server/src/lib/prelaunch.ts (the API accepts the same
 * cookie). Both copies are pinned by the same test vectors in
 * lib/__fixtures__/prelaunch-cookie-vectors.json, so they can't drift apart.
 */

const crypto = require('crypto');

const COOKIE_NAME = '__Host-cs_prelaunch';
// Decision 2 (Samuel, 29 Sep 2026): the website remembers the password for
// 28 days.
const SESSION_SECONDS = 28 * 24 * 60 * 60;
const COOKIE_VERSION = 'v1';
const MIN_KEY_BYTES = 32;

/**
 * The website gate is on unless PRELAUNCH_GATE is exactly "off".
 *
 * Deliberately NO NODE_ENV rule here (unlike the API): the website service's
 * artifact.toml never sets NODE_ENV in production, and serve-web.js is only
 * ever the production server, so "on by default" is the safe reading.
 */
function gateEnabled(env) {
  return env.PRELAUNCH_GATE !== 'off';
}

/** Decode PRELAUNCH_SESSION_KEYS ("k1,k2", base64url) into key buffers. */
function sessionKeys(env) {
  const raw = env.PRELAUNCH_SESSION_KEYS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Buffer.from(s, 'base64url'))
    // A key that decodes to fewer than 32 bytes is treated as missing, so a
    // truncated paste fails closed instead of signing with a weak key.
    .filter((buf) => buf.length >= MIN_KEY_BYTES);
}

function hmac(key, expiry) {
  return crypto.createHmac('sha256', key).update(String(expiry)).digest('base64url');
}

/** The cookie value for a session made at `nowSeconds`, signed by the first key. */
function signSession(keys, nowSeconds) {
  if (!keys.length) throw new Error('no session key');
  const expiry = nowSeconds + SESSION_SECONDS;
  return `${COOKIE_VERSION}.${expiry}.${hmac(keys[0], expiry)}`;
}

function safeEqualStrings(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** True when one cookie value is well formed, unexpired and signed by any key. */
function verifyCookieValue(keys, value, nowSeconds) {
  const parts = String(value).split('.');
  if (parts.length !== 3) return false;
  const [version, expiryText, signature] = parts;
  if (version !== COOKIE_VERSION) return false;
  if (!/^\d{1,12}$/.test(expiryText)) return false;
  const expiry = Number(expiryText);
  if (expiry <= nowSeconds) return false;
  // A signed expiry further out than one session can't have come from us.
  if (expiry > nowSeconds + SESSION_SECONDS) return false;
  let ok = false;
  for (const key of keys) {
    // No early exit, so the time taken doesn't say which key matched.
    if (safeEqualStrings(hmac(key, expiry), signature)) ok = true;
  }
  return ok;
}

/** Every value sent under the cookie's name (the PR #20 rule: try them all). */
function cookieValues(cookieHeader) {
  if (!cookieHeader) return [];
  const header = Array.isArray(cookieHeader) ? cookieHeader.join(';') : String(cookieHeader);
  const values = [];
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== COOKIE_NAME) continue;
    values.push(pair.slice(eq + 1).trim());
  }
  return values;
}

/** True when any `__Host-cs_prelaunch` cookie in the header is valid. */
function verifySession(keys, cookieHeader, nowSeconds) {
  if (!keys.length) return false;
  let ok = false;
  for (const value of cookieValues(cookieHeader)) {
    if (verifyCookieValue(keys, value, nowSeconds)) ok = true;
  }
  return ok;
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest();
}

/** Constant-time password check. False when no password is configured. */
function checkPassword(env, supplied) {
  const expected = env.PRELAUNCH_WEB_PASSWORD || '';
  if (!expected || typeof supplied !== 'string') return false;
  return crypto.timingSafeEqual(sha256(expected), sha256(supplied));
}

function sessionCookie(value) {
  return `${COOKIE_NAME}=${value}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function clearedCookie() {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

module.exports = {
  COOKIE_NAME,
  SESSION_SECONDS,
  gateEnabled,
  sessionKeys,
  signSession,
  verifySession,
  checkPassword,
  sessionCookie,
  clearedCookie,
};
