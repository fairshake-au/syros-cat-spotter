import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { markLeft, pool, signOutEverywhere, type PersonWithScopes } from "@workspace/db";
import { newColony } from "../test/roleKit";
import app from "../app";
import { claimsFor, makeKey, mint } from "../lib/teamAuth/__fixtures__/mint";
import { sessionCookieFor } from "../lib/teamAuth/__fixtures__/queueKit";
import { installFakeResend } from "../test/fakeResend";
import { cleanUpPeople, inviteCookieFor, invited, joined } from "../test/inviteKit";
import { settleOutbox } from "../lib/mail/outbox";

// SYC-353: a re-tap of the Worker's button within the minute sends the SAME
// pass (SYC-88), which the hand-off refuses as `replayed`. If the browser
// already holds a good session for exactly that pass's person, it now goes
// where a fresh hand-off would send it, with no new cookie and the pass
// still spent. Anything else is still the sign-in 401.

const KEY = "vitest-replay-key-0123456789abcdef-0123456789";
const handoffKey = makeKey();
let manager: PersonWithScopes & { cookie: string };

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  process.env["RESEND_API_KEY"] = "re_test_not_real";
  installFakeResend();
  manager = await joined("replay-mgr", ["staff", "management"]);
  await joined("replay-mgr2", ["management"]);
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

const handoff = (token: string, cookie?: string) => {
  const t = request(app).post("/api/team/handoff").set("Origin", "https://admin.catspotters.com").type("form").send({ token });
  return cookie ? t.set("Cookie", cookie) : t;
};

describe("SYC-353: a replayed pass from a browser already signed in as that person", () => {
  it("a team member: lands home again, no new cookie", async () => {
    const p = await joined("replay-team");
    const token = mint(handoffKey, claimsFor(p.id, { sv: 1 }));
    const first = await handoff(token);
    expect(first.status).toBe(303);
    const cookie = (first.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    const again = await handoff(token, cookie);
    expect([again.status, again.headers["location"]]).toEqual([303, "https://team.catspotters.com/api/team/home"]);
    expect(again.headers["set-cookie"]).toBeUndefined();
    // Without the cookie it is the replay it always was.
    const bare = await handoff(token);
    expect([bare.status, bare.text]).toEqual([401, '{"error":"not_signed_in"}']);
  });

  it("an invitee: lands on the accept page again, no new cookie", async () => {
    const p = await invited(manager, "replay-inv");
    const token = mint(handoffKey, claimsFor(p.id, { sv: 1 }));
    const first = await handoff(token);
    expect(first.headers["location"]).toBe("https://team.catspotters.com/api/team/my/welcome");
    const cookie = (first.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    const again = await handoff(token, cookie);
    expect([again.status, again.headers["location"]]).toEqual([303, "https://team.catspotters.com/api/team/my/welcome"]);
    expect(again.headers["set-cookie"]).toBeUndefined();
    expect((await handoff(token)).status).toBe(401);
  });

  it("someone else's valid session is no help: 401", async () => {
    const p = await joined("replay-a");
    const other = await joined("replay-b");
    const token = mint(handoffKey, claimsFor(p.id, { sv: 1 }));
    await handoff(token);
    expect((await handoff(token, other.cookie)).status).toBe(401);
    const inv = await invited(manager, "replay-inv-b");
    expect((await handoff(token, inviteCookieFor(inv.id, 1))).status).toBe(401);
  });

  it("a stale session version: 401", async () => {
    const p = await joined("replay-stale");
    await signOutEverywhere(p.email, "cli:vitest"); // now version 2
    const token = mint(handoffKey, claimsFor(p.id, { sv: 2 }));
    expect((await handoff(token)).status).toBe(303);
    expect((await handoff(token, sessionCookieFor(p.id, 1))).status).toBe(401);
  });

  it("review nit: a joined person who may no longer enter (every placement ended): 401", async () => {
    const colony = await newColony("replay-ended");
    const p = await joined("replay-ended", ["guardian"], colony);
    const token = mint(handoffKey, claimsFor(p.id, { sv: 1 }));
    const first = await handoff(token);
    const cookie = (first.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    await pool.query(`update person_scopes set expires_at = now() - interval '1 second' where person_id = $1`, [p.id]);
    expect((await handoff(token, cookie)).status).toBe(401);
  });

  it("a person who has left: 401", async () => {
    const p = await joined("replay-left");
    const token = mint(handoffKey, claimsFor(p.id, { sv: 1 }));
    const first = await handoff(token);
    const cookie = (first.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    const left = await markLeft(p.email, "cli:vitest");
    expect((await handoff(token, cookie)).status).toBe(401);
    expect((await handoff(token, sessionCookieFor(p.id, left!.sessionVersion))).status).toBe(401);
  });

  it("an invitee who has since accepted, replaying with her old invite cookie: 401", async () => {
    const p = await invited(manager, "replay-acc");
    const token = mint(handoffKey, claimsFor(p.id, { sv: 1 }));
    const first = await handoff(token);
    const cookie = (first.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    const { acceptInvitation } = await import("@workspace/db");
    await acceptInvitation(p.id, "A", "promises-v1");
    expect((await handoff(token, cookie)).status).toBe(401);
  });
});
