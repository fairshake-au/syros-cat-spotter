import { createHmac } from "node:crypto";
import type { Response } from "express";
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
