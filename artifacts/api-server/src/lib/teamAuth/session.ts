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

export interface SessionPayload {
  pid: string;
  sv: number;
  exp: number;
}

const sign = (key: Buffer, payload: string) =>
  createHmac("sha256", key).update(payload).digest();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};

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
  const payload: SessionPayload = {
    pid: person.id,
    sv: person.sessionVersion,
    exp: nowSeconds + SESSION_LIFETIME_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = sign(keys[0]!, body).toString("base64url");
  res.cookie(SESSION_COOKIE, `${body}.${mac}`, {
    ...COOKIE_OPTIONS,
    maxAge: SESSION_LIFETIME_SECONDS * 1000,
  });
  return true;
}

/** Clears the cookie on this device (§2.1). */
export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
}

/** Every value sent under the session cookie's name, in order. */
function sessionCookieValues(req: Request): string[] {
  const header = req.headers.cookie;
  if (typeof header !== "string") return [];
  const values: string[] = [];
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    values.push(pair.slice(eq + 1).trim());
  }
  return values;
}

function verifyValue(
  value: string,
  keys: Buffer[],
  nowSeconds: number,
): SessionPayload | null {
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
  const { pid, sv, exp } = payload as Record<string, unknown>;
  if (typeof pid !== "string" || !Number.isSafeInteger(sv)) return null;
  // No readable expiry means refused, never "never expires" (§8.1).
  if (!Number.isSafeInteger(exp)) return null;
  if ((exp as number) <= nowSeconds) return null;
  return { pid, sv: sv as number, exp: exp as number };
}

/**
 * The session this request carries, or null. Every cookie with that name is
 * tried, not just the last one: a sibling subdomain can set a same-named
 * cookie to shadow the real one (§8.1).
 */
export function readSession(
  req: Request,
  nowSeconds: number,
): SessionPayload | null {
  const keys = sessionKeys();
  if (!keys) return null;
  for (const value of sessionCookieValues(req)) {
    const payload = verifyValue(value, keys, nowSeconds);
    if (payload) return payload;
  }
  return null;
}
