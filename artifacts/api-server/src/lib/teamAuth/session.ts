import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { sessionKeys } from "./config";

// The dashboard session (team-access spec §2.6, §8.2): a `__Host-cs_team`
// cookie on team.catspotters.com only. HttpOnly, Secure, SameSite=Lax,
// Path=/, no Domain (the __Host- prefix requires it), thirty days.
//
// Contents: { pid, sv, exp }, signed with HMAC-SHA256 under TEAM_SESSION_KEYS.
// The session carries no authority of its own: requireTeam looks the person
// up again and compares session_version on every request (§8.2).

export const SESSION_COOKIE = "__Host-cs_team";
export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
/**
 * SYC-516 C2 (spec §3.2): the cookie stays in the browser a day longer than
 * the session inside it. The server still refuses it everywhere once the
 * signed `exp` passes (readSession); only a signed-out save reads whose it
 * was (readExpiredSession), to keep what they typed.
 */
export const SESSION_COOKIE_GRACE_SECONDS = 86_400;

export interface SessionPayload {
  pid: string;
  sv: number;
  exp: number;
}

// SYC-53 PR 1.1 (roles-and-invites.md §4.1, §10.1; plan review minor 7): an
// invited person who has not yet accepted gets a DIFFERENT session: its own
// cookie name and a kind marker (`k: "invite"`) inside the signed payload.
// requireTeam reads only `__Host-cs_team` and refuses any payload carrying a
// kind, so an invitee session is never a team session, whichever cookie
// name it is sent under; requireInvitee reads only `__Host-cs_invite` and
// only the invite kind. Short-lived: one day, enough to read and accept.
export const INVITE_COOKIE = "__Host-cs_invite";
export const INVITE_LIFETIME_SECONDS = 24 * 60 * 60;
const INVITE_KIND = "invite";

interface SignedPayload extends SessionPayload {
  k?: string;
}

const sign = (key: Buffer, payload: string) =>
  createHmac("sha256", key).update(payload).digest();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};

function signPayload(keys: Buffer[], payload: SignedPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = sign(keys[0]!, body).toString("base64url");
  return `${body}.${mac}`;
}

/**
 * Signs a session with the first configured key and sets the cookie. False
 * (and no cookie) when TEAM_SESSION_KEYS isn't configured.
 */
export function issueSession(
  res: Response,
  person: { id: string; sessionVersion: number },
  nowSeconds: number,
): boolean {
  const keys = sessionKeys();
  if (!keys) return false;
  const value = signPayload(keys, {
    pid: person.id,
    sv: person.sessionVersion,
    exp: nowSeconds + SESSION_LIFETIME_SECONDS,
  });
  res.cookie(SESSION_COOKIE, value, {
    ...COOKIE_OPTIONS,
    maxAge: (SESSION_LIFETIME_SECONDS + SESSION_COOKIE_GRACE_SECONDS) * 1000,
  });
  return true;
}

/**
 * The invitee's session (SYC-53 PR 1.1): `__Host-cs_invite`, kind `invite`.
 * False (and no cookie) when TEAM_SESSION_KEYS isn't configured.
 */
export function issueInviteSession(
  res: Response,
  person: { id: string; sessionVersion: number },
  nowSeconds: number,
): boolean {
  const keys = sessionKeys();
  if (!keys) return false;
  const value = signPayload(keys, {
    pid: person.id,
    sv: person.sessionVersion,
    exp: nowSeconds + INVITE_LIFETIME_SECONDS,
    k: INVITE_KIND,
  });
  res.cookie(INVITE_COOKIE, value, {
    ...COOKIE_OPTIONS,
    maxAge: INVITE_LIFETIME_SECONDS * 1000,
  });
  return true;
}

/** Clears the invitee's cookie on this device. */
export function clearInviteSession(res: Response): void {
  res.clearCookie(INVITE_COOKIE, COOKIE_OPTIONS);
}

/** Clears the cookie on this device (§2.1). */
export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
}

/** Every value sent under a cookie's name, in order. */
function sessionCookieValues(req: Request, name: string = SESSION_COOKIE): string[] {
  const header = req.headers.cookie;
  if (typeof header !== "string") return [];
  const values: string[] = [];
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== name) continue;
    values.push(pair.slice(eq + 1).trim());
  }
  return values;
}

/**
 * A genuine value, or null. Live only (`exp > now`) unless `expiredWithin` is
 * given, and then expired only: `now - expiredWithin < exp <= now`, never a
 * live one. Only readExpiredSession passes it.
 */
function verifyValue(
  value: string,
  keys: Buffer[],
  nowSeconds: number,
  opts: { expiredWithin?: number } = {},
): SignedPayload | null {
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [body, mac] = parts as [string, string];
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(mac)) {
    return null;
  }
  const presented = Buffer.from(mac, "base64url");
  // Constant-time, against every configured key (two during a change).
  let matched = false;
  for (const key of keys) {
    const expected = sign(key, body);
    if (
      presented.length === expected.length &&
      timingSafeEqual(presented, expected)
    ) {
      matched = true;
    }
  }
  if (!matched) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const { pid, sv, exp, k } = payload as Record<string, unknown>;
  if (typeof pid !== "string" || !Number.isSafeInteger(sv)) return null;
  // No readable expiry means refused, never "never expires" (§8.1).
  if (!Number.isSafeInteger(exp)) return null;
  if (opts.expiredWithin === undefined) {
    if ((exp as number) <= nowSeconds) return null;
  } else {
    if ((exp as number) > nowSeconds) return null;
    if ((exp as number) <= nowSeconds - opts.expiredWithin) return null;
  }
  if (k !== undefined && typeof k !== "string") return null;
  return { pid, sv: sv as number, exp: exp as number, ...(k === undefined ? {} : { k }) };
}

/**
 * The session this request carries, or null. Every cookie with that name is
 * tried, not just the last one: a sibling subdomain can set a same-named
 * cookie to shadow the real one (§8.1). A payload carrying any kind (an
 * invitee's session copied under this name) is never a team session.
 */
export function readSession(
  req: Request,
  nowSeconds: number,
): SessionPayload | null {
  const keys = sessionKeys();
  if (!keys) return null;
  for (const value of sessionCookieValues(req)) {
    const payload = verifyValue(value, keys, nowSeconds);
    if (payload && payload.k === undefined) {
      return { pid: payload.pid, sv: payload.sv, exp: payload.exp };
    }
  }
  return null;
}

/**
 * SYC-516 C2: whose sign-in this WAS. A genuine team session (our signature,
 * no kind) that expired within the last SESSION_COOKIE_GRACE_SECONDS; never
 * a live one, never an invitee's. It opens nothing: its only reader is the
 * signed-out save (refuseSignedOutSave), which keeps what was typed for that
 * person after checking they are still on the list at that session version.
 */
export function readExpiredSession(
  req: Request,
  nowSeconds: number,
): SessionPayload | null {
  const keys = sessionKeys();
  if (!keys) return null;
  for (const value of sessionCookieValues(req)) {
    const payload = verifyValue(value, keys, nowSeconds, {
      expiredWithin: SESSION_COOKIE_GRACE_SECONDS,
    });
    if (payload && payload.k === undefined) {
      return { pid: payload.pid, sv: payload.sv, exp: payload.exp };
    }
  }
  return null;
}

/**
 * The invitee's session this request carries (SYC-53 PR 1.1), or null: only
 * from `__Host-cs_invite`, and only a payload of the invite kind.
 */
export function readInviteSession(
  req: Request,
  nowSeconds: number,
): SessionPayload | null {
  const keys = sessionKeys();
  if (!keys) return null;
  for (const value of sessionCookieValues(req, INVITE_COOKIE)) {
    const payload = verifyValue(value, keys, nowSeconds);
    if (payload && payload.k === INVITE_KIND) {
      return { pid: payload.pid, sv: payload.sv, exp: payload.exp };
    }
  }
  return null;
}
