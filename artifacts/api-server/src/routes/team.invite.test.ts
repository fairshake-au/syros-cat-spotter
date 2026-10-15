import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { pool, signOutEverywhereById, withdrawInvitation, type PersonWithScopes } from "@workspace/db";
import app from "../app";
import { claimsFor, makeKey, mint } from "../lib/teamAuth/__fixtures__/mint";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { INVITE_COOKIE, SESSION_COOKIE } from "../lib/teamAuth/session";
import { sessionCookieFor } from "../lib/teamAuth/__fixtures__/queueKit";
import { installFakeResend, type SentMail } from "../test/fakeResend";
import {
  asTeamCookie,
  cleanUpPeople,
  eventKinds,
  inviteCookieFor,
  invited,
  joined,
  personRow,
} from "../test/inviteKit";
import { newColony, seedCat, type SeededCat } from "../test/roleKit";
import { settleOutbox } from "../lib/mail/outbox";
import { en } from "../lib/teamPages/strings/en";

// SYC-53 PR 1.1, the routes: the hand-off for an invitee, the accept page
// (GET /api/team/my/welcome, POST .../accept, POST .../decline), and the
// invitee's own session. Plan tests T9 (her session reaches the accept page
// and nothing else; her placements never reach can()), "pending cookie"
// (after accept, the old cookie reaches no capability route and no accept
// route), the route half of T10, and spec §14 case 14 (Origin-checked, safe
// to press twice).

const KEY = "vitest-invite-key-0123456789abcdef-0123456789";
const handoffKey = makeKey();
let sent: SentMail[];
let susan: PersonWithScopes & { cookie: string };
let colony: number;
let catInColony: SeededCat;

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  process.env["RESEND_API_KEY"] = "re_test_not_real";
  sent = installFakeResend();
  colony = await newColony("invite-routes");
  catInColony = await seedCat(colony);
  susan = await joined("rt-susan", ["staff", "management"]);
  await joined("rt-jacky", ["management"]);
});

beforeEach(() => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
});

afterAll(async () => {
  await settleOutbox();
  await cleanUpPeople();
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  delete process.env["RESEND_API_KEY"];
});

/** The hand-off as the sign-in Worker makes it; the cookies it sets. */
async function handoff(personId: string, sv: number) {
  const res = await request(app)
    .post("/api/team/handoff")
    .set("Origin", "https://admin.catspotters.com")
    .type("form")
    .send({ token: mint(handoffKey, claimsFor(personId, { sv })) });
  const cookies = ((res.headers["set-cookie"] as unknown as string[]) ?? []).map((c) => c.split(";")[0]!);
  return { res, cookies };
}

const post = (path: string, cookie: string, body: Record<string, string> = {}, origin: string | null = TEAM_ORIGIN) => {
  const t = request(app).post(path).type("form").send(body).set("Cookie", cookie);
  return origin === null ? t : t.set("Origin", origin);
};

describe("the hand-off gives an invitee her own session and sends her to the accept page", () => {
  it("an Invited guardian gets __Host-cs_invite (never the team cookie) and a 303 to /api/team/my/welcome", async () => {
    const p = await invited(susan, "rt-g1", [{ role: "guardian", colonyId: colony }]);
    const { res, cookies } = await handoff(p.id, 1);
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe("https://team.catspotters.com/api/team/my/welcome");
    expect(cookies).toHaveLength(1);
    expect(cookies[0]!.startsWith(`${INVITE_COOKIE}=`)).toBe(true);
    const raw = (res.headers["set-cookie"] as unknown as string[])[0]!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Secure/i);
    expect(raw).toMatch(/SameSite=Lax/i);
  });

  it("refuses one not yet sent, expired, withdrawn, or at a stale session version", async () => {
    const notSent = await invited(susan, "rt-ns");
    await pool.query(`update people set invite_sent_at = null where id = $1`, [notSent.id]);
    expect((await handoff(notSent.id, 1)).res.status).toBe(401);
    const expired = await invited(susan, "rt-exp");
    await pool.query(`update people set invite_expires_at = now() - interval '1 second' where id = $1`, [expired.id]);
    expect((await handoff(expired.id, 1)).res.status).toBe(401);
    const gone = await invited(susan, "rt-wd");
    await withdrawInvitation(susan.id, gone.id);
    expect((await handoff(gone.id, 1)).res.status).toBe(401);
    expect((await handoff(gone.id, 2)).res.status).toBe(401);
    const stale = await invited(susan, "rt-sv");
    expect((await handoff(stale.id, 2)).res.status).toBe(401);
  });
});

describe("T9: her session reaches the accept page and nothing else; her placements never reach can()", () => {
  it("every dashboard route but the accept page answers her invite cookie with the sign-in 401", async () => {
    const p = await invited(susan, "rt-g2", [{ role: "guardian", colonyId: colony }]);
    const cookie = inviteCookieFor(p.id, 1);
    // Her own colony's cat photo: a joined guardian on this colony passes;
    // an invitee placed on it does not.
    for (const path of ["/api/team", "/api/team/me", `/api/team/photos/${catInColony.photoPublicId}`, "/api/team/colonies"]) {
      const r = await request(app).get(path).set("Cookie", cookie);
      expect([path, r.status, r.text]).toEqual([path, 401, '{"error":"not_signed_in"}']);
    }
    // The same signed value under the team cookie's name: still refused.
    const r = await request(app).get("/api/team/me").set("Cookie", asTeamCookie(cookie));
    expect(r.status).toBe(401);
    const page = await request(app).get("/api/team/my/welcome").set("Cookie", cookie);
    expect(page.status).toBe(200);
  });
});

describe("the accept page (§4.1 step 4; T29d's route half)", () => {
  it("says who invited her, for what, what she will see and do, the three promises, the lock and never-reopened text, and the two buttons", async () => {
    const p = await invited(susan, "rt-page", [{ role: "guardian", colonyId: colony }]);
    const page = await request(app).get("/api/team/my/welcome").set("Cookie", inviteCookieFor(p.id, 1)).set("Sec-Fetch-Mode", "navigate");
    expect(page.status).toBe(200);
    expect(page.headers["cache-control"]).toBe("no-store");
    const colonyName = (await pool.query(`select name from colonies where id = $1`, [colony])).rows[0].name;
    expect(page.text).toContain(`Vt rt-susan from Syros Cats invited you as a cat guardian for ${colonyName}.`);
    expect(page.text).toContain(en["welcome.seeDo.guardian"].replace(/'/g, "&#39;"));
    expect((page.text.match(/<ol class="promises">(.*?)<\/ol>/s)![1]!.match(/<li>/g) ?? []).length).toBe(3);
    expect(page.text).toContain("Please keep a lock on your phone");
    expect(page.text).toContain("A phone that is never opened again keeps its saved list until the browser clears it.");
    expect(page.text).toContain('value="Vt rt-page"');
    expect(page.text).toContain(">Yes, join</button>");
    expect(page.text).toContain("No, this isn&#39;t for me</button>");
    expect(page.text).toContain('action="/api/team/my/accept"');
    expect(page.text).toContain('action="/api/team/my/decline"');
  });

  it("escapes a name with markup, and keeps it pre-filled", async () => {
    const p = await invited(susan, "rt-xss");
    await pool.query(`update people set name = '<script>alert(1)</script>' where id = $1`, [p.id]);
    const page = await request(app).get("/api/team/my/welcome").set("Cookie", inviteCookieFor(p.id, 1));
    expect(page.text).not.toContain("<script>alert(1)</script>");
    expect(page.text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("accepting, and the pending cookie afterwards (review minor 7)", () => {
  it("accept: the invite cookie is cleared, a team session issued in the same response, a 303 home; the old cookie reaches nothing", async () => {
    const p = await invited(susan, "rt-acc");
    const { cookies } = await handoff(p.id, 1);
    const pendingCookie = cookies[0]!;
    const res = await post("/api/team/my/accept", pendingCookie, { name: "  Eleni P.  " });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe("https://team.catspotters.com/api/team/");
    const set = res.headers["set-cookie"] as unknown as string[];
    expect(set.find((c) => c.startsWith(`${INVITE_COOKIE}=;`))).toBeDefined();
    const team = set.find((c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.startsWith(`${SESSION_COOKIE}=;`))!.split(";")[0]!;
    // The new session works.
    const me = await request(app).get("/api/team/me").set("Cookie", team);
    expect(me.status).toBe(200);
    expect(me.body.name).toBe("Eleni P.");
    const row = await personRow(p.id);
    expect(row.accepted_at).not.toBeNull();
    expect(row.session_version).toBe(2);
    const ev = (await pool.query(`select detail from person_events where person_id = $1 and kind = 'accepted'`, [p.id])).rows;
    expect(ev).toEqual([{ detail: { promisesVersion: "promises-v1" } }]);
    // The old pending cookie: no capability route, no accept route.
    for (const path of ["/api/team", "/api/team/me", "/api/team/colonies"]) {
      expect((await request(app).get(path).set("Cookie", pendingCookie)).status).toBe(401);
    }
    const again = await post("/api/team/my/accept", pendingCookie, { name: "Changed" });
    expect([again.status, again.text]).toEqual([409, '{"error":"invitation_closed"}']);
    expect((await post("/api/team/my/decline", pendingCookie)).status).toBe(409);
    expect((await request(app).get("/api/team/my/welcome").set("Cookie", pendingCookie)).status).toBe(409);
    expect((await personRow(p.id)).name).toBe("Eleni P.");
    expect((await personRow(p.id)).left_at).toBeNull();
    // Even re-signed at her new version, an invite-kind cookie is no team
    // session, and no accept route acts for someone who has joined.
    const forged = inviteCookieFor(p.id, 2);
    expect((await request(app).get("/api/team/me").set("Cookie", asTeamCookie(forged))).status).toBe(401);
    expect((await request(app).get("/api/team").set("Cookie", asTeamCookie(forged))).status).toBe(401);
    expect((await post("/api/team/my/accept", forged)).status).toBe(409);
    expect(await eventKinds(p.id)).toEqual(["invited", "invite_sent", "accepted"]);
  });

  it("pressing Yes twice in a browser: the second press, carrying the new team session, goes home and changes nothing", async () => {
    const p = await invited(susan, "rt-twice");
    const pending = inviteCookieFor(p.id, 1);
    const first = await post("/api/team/my/accept", pending);
    const team = (first.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.startsWith(`${SESSION_COOKIE}=;`))!.split(";")[0]!;
    const second = await post("/api/team/my/accept", team);
    expect([second.status, second.headers["location"]]).toEqual([303, "https://team.catspotters.com/api/team/"]);
    expect(await eventKinds(p.id)).toEqual(["invited", "invite_sent", "accepted"]);
  });

  it("a guardian with only placed roles lands on her own page", async () => {
    const p = await invited(susan, "rt-gh", [{ role: "guardian", colonyId: colony }]);
    const res = await post("/api/team/my/accept", inviteCookieFor(p.id, 1));
    expect(res.headers["location"]).toBe("https://team.catspotters.com/api/team/me");
  });

  it("accept after the invitation was withdrawn: nothing changes, and it says so", async () => {
    const p = await invited(susan, "rt-late");
    const cookie = inviteCookieFor(p.id, 1);
    await withdrawInvitation(susan.id, p.id);
    const res = await post("/api/team/my/accept", cookie).set("Sec-Fetch-Mode", "navigate");
    expect(res.status).toBe(200);
    expect(res.text).toContain("This invitation is no longer open");
    expect(res.headers["set-cookie"] ?? []).not.toContainEqual(expect.stringMatching(new RegExp(`^${SESSION_COOKIE}=[^;]`)));
    expect((await personRow(p.id)).accepted_at).toBeNull();
  });
});

describe("declining", () => {
  it("withdraws it, by her, anonymised, the cookie cleared; a second press changes nothing and says so", async () => {
    const p = await invited(susan, "rt-dec");
    const cookie = inviteCookieFor(p.id, 1);
    const res = await post("/api/team/my/decline", cookie).set("Sec-Fetch-Mode", "navigate");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Thank you for letting us know");
    expect((res.headers["set-cookie"] as unknown as string[]).some((c) => c.startsWith(`${INVITE_COOKIE}=;`))).toBe(true);
    const row = await personRow(p.id);
    expect(row.left_at).not.toBeNull();
    expect(row.email).toBe(`withdrawn-${p.id}@invalid`);
    expect(await eventKinds(p.id)).toEqual(["invited", "invite_sent", "invite_withdrawn", "anonymised"]);
    const again = await post("/api/team/my/decline", cookie).set("Sec-Fetch-Mode", "navigate");
    expect(again.status).toBe(200);
    expect(again.text).toContain("This invitation is no longer open");
    expect(await eventKinds(p.id)).toHaveLength(4);
  });
});

describe("spec §14 case 14: accept and decline are Origin-checked (a missing Origin too)", () => {
  it("a wrong or missing Origin gets the sign-in 401 and changes nothing", async () => {
    const p = await invited(susan, "rt-origin");
    const cookie = inviteCookieFor(p.id, 1);
    for (const path of ["/api/team/my/accept", "/api/team/my/decline"]) {
      for (const origin of [null, "https://evil.example", "https://admin.catspotters.com", "null"]) {
        const res = await post(path, cookie, { name: "X" }, origin);
        expect([path, origin, res.status, res.text]).toEqual([path, origin, 401, '{"error":"not_signed_in"}']);
      }
    }
    const row = await personRow(p.id);
    expect([row.accepted_at, row.left_at]).toEqual([null, null]);
    expect(await eventKinds(p.id)).toEqual(["invited", "invite_sent"]);
  });
});

describe("sign-out ends an invitee's session too", () => {
  it("clears both cookies", async () => {
    const res = await request(app).post("/api/team/signout").set("Origin", TEAM_ORIGIN);
    const set = res.headers["set-cookie"] as unknown as string[];
    expect(set.some((c) => c.startsWith(`${SESSION_COOKIE}=;`))).toBe(true);
    expect(set.some((c) => c.startsWith(`${INVITE_COOKIE}=;`))).toBe(true);
  });
});

it("no email went to the inviter when anyone accepted (Decision 7)", async () => {
  await settleOutbox();
  expect(sent.filter((m) => m.to === susan.email && /accept/i.test(m.subject + m.text))).toEqual([]);
});

describe("review nits: the accept page's gate", () => {
  it("refuses an invitee signed out everywhere (her session version moved): nothing shown, nothing changed", async () => {
    const p = await invited(susan, "rt-so");
    const old = inviteCookieFor(p.id, 1);
    await signOutEverywhereById(susan.id, p.id);
    const page = await request(app).get("/api/team/my/welcome").set("Cookie", old);
    expect([page.status, page.text]).toEqual([409, '{"error":"invitation_closed"}']);
    expect((await post("/api/team/my/accept", old)).status).toBe(409);
    expect((await personRow(p.id)).accepted_at).toBeNull();
  });

  it("refuses a team-kind cookie for the invitee herself: requireInvitee reads only the invite cookie", async () => {
    const p = await invited(susan, "rt-teamcookie");
    const forged = sessionCookieFor(p.id, 1);
    expect([(await request(app).get("/api/team/my/welcome").set("Cookie", forged)).status]).toEqual([401]);
    expect((await post("/api/team/my/accept", forged)).status).toBe(401);
    expect((await personRow(p.id)).accepted_at).toBeNull();
  });

  it("accept gives no team session to someone who holds nothing any more (her placement ended before she said yes)", async () => {
    const p = await invited(susan, "rt-ended", [{ role: "guardian", colonyId: colony }]);
    await pool.query(`update person_scopes set expires_at = now() - interval '1 second' where person_id = $1`, [p.id]);
    const res = await post("/api/team/my/accept", inviteCookieFor(p.id, 1)).set("Sec-Fetch-Mode", "navigate");
    expect(res.status).toBe(403);
    expect(res.text).toContain("Your access has ended.");
    const set = (res.headers["set-cookie"] as unknown as string[]) ?? [];
    expect(set.some((c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.startsWith(`${SESSION_COOKIE}=;`))).toBe(false);
    expect(set.some((c) => c.startsWith(`${INVITE_COOKIE}=;`))).toBe(true);
  });
});
