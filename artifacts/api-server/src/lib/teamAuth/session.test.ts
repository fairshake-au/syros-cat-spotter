import { createHmac } from "node:crypto";
import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INVITE_COOKIE,
  issueSession,
  readExpiredSession,
  readSession,
  SESSION_COOKIE,
  SESSION_COOKIE_GRACE_SECONDS,
  SESSION_LIFETIME_SECONDS,
} from "./session";

// SYC-516 C2 (spec §3.2): the sign-in cookie stays in the browser for a day
// after it expires, so a signed-out save can tell whose it was. readSession
// still refuses it everywhere; only readExpiredSession reads it, and only
// while it is expired, genuine and a team session.

const KEY = "vitest-expired-key-0123456789abcdef-0123456789";
const OTHER = "vitest-expired-other-0123456789abcdef-012345678";
const PID = "00000000-0000-4000-8000-000000000516";
const now = 1_800_000_000;

function value(payload: Record<string, unknown>, key = KEY): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", Buffer.from(key)).update(body).digest("base64url");
  return `${body}.${mac}`;
}

const reqWith = (cookie: string) => ({ headers: { cookie } }) as unknown as Request;
const team = (payload: Record<string, unknown>, key = KEY) => reqWith(`${SESSION_COOKIE}=${value(payload, key)}`);

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
});
afterEach(() => {
  delete process.env["TEAM_SESSION_KEYS"];
});

describe("an expired sign-in (SYC-516 C2)", () => {
  it("expired an hour ago: still refused by readSession, but readExpiredSession says whose it was", () => {
    const req = team({ pid: PID, sv: 3, exp: now - 3600 });
    expect(readSession(req, now)).toBeNull();
    expect(readExpiredSession(req, now)).toEqual({ pid: PID, sv: 3, exp: now - 3600 });
  });

  it("expired 25 hours ago: both null", () => {
    const req = team({ pid: PID, sv: 3, exp: now - 25 * 3600 });
    expect(readSession(req, now)).toBeNull();
    expect(readExpiredSession(req, now)).toBeNull();
  });

  it("expiring exactly now counts as expired, not live", () => {
    const req = team({ pid: PID, sv: 3, exp: now });
    expect(readSession(req, now)).toBeNull();
    expect(readExpiredSession(req, now)?.pid).toBe(PID);
  });

  it("a live session: readExpiredSession is null (it never reads a live one)", () => {
    const req = team({ pid: PID, sv: 3, exp: now + 60 });
    expect(readSession(req, now)?.pid).toBe(PID);
    expect(readExpiredSession(req, now)).toBeNull();
  });

  it("a bad signature: null", () => {
    expect(readExpiredSession(team({ pid: PID, sv: 3, exp: now - 60 }, OTHER), now)).toBeNull();
    const [body] = value({ pid: PID, sv: 3, exp: now - 60 }).split(".");
    expect(readExpiredSession(reqWith(`${SESSION_COOKIE}=${body}.AAAA`), now)).toBeNull();
  });

  it("an invite kind: null, under either cookie name", () => {
    const invite = value({ pid: PID, sv: 3, exp: now - 60, k: "invite" });
    expect(readExpiredSession(reqWith(`${SESSION_COOKIE}=${invite}`), now)).toBeNull();
    expect(readExpiredSession(reqWith(`${INVITE_COOKIE}=${invite}`), now)).toBeNull();
  });

  it("no expiry at all: null", () => {
    expect(readExpiredSession(team({ pid: PID, sv: 3 }), now)).toBeNull();
  });

  it("tries every cookie of the name: a shadowing junk cookie first doesn't hide the real one", () => {
    const real = value({ pid: PID, sv: 3, exp: now - 60 });
    expect(readExpiredSession(reqWith(`${SESSION_COOKIE}=junk; ${SESSION_COOKIE}=${real}`), now)?.pid).toBe(PID);
  });

  it("no keys configured: null", () => {
    delete process.env["TEAM_SESSION_KEYS"];
    expect(readExpiredSession(team({ pid: PID, sv: 3, exp: now - 60 }), now)).toBeNull();
  });

  it("the cookie stays a day past the signed expiry; the signed expiry is unchanged", () => {
    let set: { value: string; maxAge: number } | undefined;
    const res = {
      cookie: (_n: string, v: string, o: { maxAge: number }) => {
        set = { value: v, maxAge: o.maxAge };
      },
    } as unknown as Response;
    expect(issueSession(res, { id: PID, sessionVersion: 1 }, now)).toBe(true);
    expect(SESSION_COOKIE_GRACE_SECONDS).toBe(86_400);
    expect(set!.maxAge).toBe((SESSION_LIFETIME_SECONDS + SESSION_COOKIE_GRACE_SECONDS) * 1000);
    const payload = JSON.parse(Buffer.from(set!.value.split(".")[0]!, "base64url").toString("utf8"));
    expect(payload.exp).toBe(now + SESSION_LIFETIME_SECONDS);
  });
});
