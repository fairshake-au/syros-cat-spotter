import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { addPerson, markLeft, pool } from "@workspace/db";
import app from "../app";
import { claimsFor, makeKey, mint } from "../lib/teamAuth/__fixtures__/mint";
import { removeTestPerson } from "../test/removeTestPerson";

// A person marked as left is refused by every reader of "who is allowed in"
// (SYC-43 part 2, Decision 7; plan test P0-1): the hand-off, requireTeam,
// and the Worker's question. Each refusal is identical to the one for an
// address or id that was never on the list.
//
// markLeft also raises session_version, which on its own refuses a pass or
// cookie minted before the person left. So each reader is also tested with a
// pass or cookie at the person's *current* version: only the left_at check
// can refuse that one.

const EMAIL = "vitest-left-susan@example.com";
const NEVER_EMAIL = "vitest-left-never@example.com";
const NEVER_ID = "00000000-0000-4000-8000-000000000000";
const SESSION_KEY = "vitest-session-key-L-0123456789abcdef-0123456789";
const TOKEN = "vitest-internal-token-left-0123456789abcdef";
const handoffKey = makeKey();

beforeEach(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = SESSION_KEY;
  process.env["INTERNAL_PEOPLE_TOKEN"] = TOKEN;
  await removeTestPerson(EMAIL);
  await removeTestPerson(NEVER_EMAIL);
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  delete process.env["INTERNAL_PEOPLE_TOKEN"];
  await removeTestPerson(EMAIL);
  await pool.end();
});

const handoff = (id: string, sv: number) =>
  request(app)
    .post("/api/team/handoff")
    .set("Origin", "https://admin.catspotters.com")
    .type("form")
    .send({ token: mint(handoffKey, claimsFor(id, { sv })) });

/** A session cookie, signed the way issueSession signs one. */
function cookieFor(pid: string, sv: number): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const body = Buffer.from(JSON.stringify({ pid, sv, exp })).toString(
    "base64url",
  );
  const mac = createHmac("sha256", Buffer.from(SESSION_KEY))
    .update(body)
    .digest("base64url");
  return `__Host-cs_team=${body}.${mac}`;
}

const me = (cookie: string) =>
  request(app).get("/api/team/me").set("Cookie", cookie);

// The live Worker's question (`version: 2`). Susan is staff only, and since
// SYC-619 §2.2 the old shape's yes is the workspace, management's alone, so
// she is let in (and, once left, refused) through this shape's dashboard door.
const ask = (email: string) =>
  request(app)
    .post("/api/internal/people/allowed")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ email, version: 2 });

/** What a client can see of a response. */
const seen = (res: request.Response) => ({
  status: res.status,
  text: res.text,
  setCookie: res.headers["set-cookie"],
  location: res.headers["location"],
  cacheControl: res.headers["cache-control"],
});

async function addAndLeave() {
  const p = await addPerson({
    email: EMAIL,
    name: "Susan",
    addedBy: "cli:vitest",
  });
  const left = await markLeft(EMAIL, "cli:vitest");
  expect(left).toEqual({ id: p.id, sessionVersion: p.sessionVersion + 1, withdrawnInvitations: 0 });
  return { id: p.id, before: p.sessionVersion, now: left!.sessionVersion };
}

describe("P0-1: a person marked as left is refused by every reader", () => {
  it("the hand-off refuses them, identically to an id never on the list", async () => {
    const p = await addPerson({
      email: EMAIL,
      name: "Susan",
      addedBy: "cli:vitest",
    });
    // Before leaving, a pass works: the refusal below is caused by leaving.
    expect((await handoff(p.id, p.sessionVersion)).status).toBe(303);
    await removeTestPerson(EMAIL);
    const { id, before, now } = await addAndLeave();

    const never = seen(await handoff(NEVER_ID, 1));
    expect(never.status).toBe(401);
    expect(never.text).toBe('{"error":"not_signed_in"}');
    expect(never.setCookie).toBeUndefined();
    // A pass the Worker issued before they left, and one at their current
    // version (only left_at can refuse that).
    expect(seen(await handoff(id, before))).toEqual(never);
    expect(seen(await handoff(id, now))).toEqual(never);
  });

  it("requireTeam refuses them on their very next request, identically to an id never on the list", async () => {
    const p = await addPerson({
      email: EMAIL,
      name: "Susan",
      addedBy: "cli:vitest",
    });
    const res = await handoff(p.id, p.sessionVersion);
    expect(res.status).toBe(303);
    const existing = (
      res.headers["set-cookie"] as unknown as string[]
    )[0]!.split(";")[0]!;
    expect((await me(existing)).status).toBe(200);
    // A cookie at the version they'll have after leaving: refused only by
    // the left_at check.
    const current = cookieFor(p.id, p.sessionVersion + 1);

    await markLeft(EMAIL, "cli:vitest");

    const never = seen(await me(cookieFor(NEVER_ID, 1)));
    expect(never.status).toBe(401);
    expect(never.text).toBe('{"error":"not_signed_in"}');
    expect(seen(await me(existing))).toEqual(never);
    expect(seen(await me(current))).toEqual(never);
  });

  it("the Worker's question answers allowed: false, identically to an address never on the list", async () => {
    await addPerson({ email: EMAIL, name: "Susan", addedBy: "cli:vitest" });
    expect((await ask(EMAIL)).body).toMatchObject({ allowed: true });
    await markLeft(EMAIL, "cli:vitest");

    const never = seen(await ask(NEVER_EMAIL));
    expect(never.status).toBe(200);
    expect(JSON.parse(never.text)).toEqual({ allowed: false, doors: { workspace: false, dashboard: false } });
    expect(seen(await ask(EMAIL))).toEqual(never);
    expect(seen(await ask(" Vitest-Left-Susan@Example.com "))).toEqual(never);
  });

  it("after rejoining, they're let in again, but only with a fresh sign-in", async () => {
    const { id, now } = await addAndLeave();
    const back = await addPerson({
      email: EMAIL,
      name: "Susan",
      addedBy: "cli:vitest",
    });
    expect(back.id).toBe(id);
    expect(back.sessionVersion).toBe(now + 1);
    expect((await ask(EMAIL)).body).toMatchObject({
      allowed: true,
      personId: id,
      sessionVersion: back.sessionVersion,
    });
    // A cookie or pass from while they were gone stays dead.
    expect((await me(cookieFor(id, now))).status).toBe(401);
    expect((await handoff(id, now)).status).toBe(401);
    expect((await handoff(id, back.sessionVersion)).status).toBe(303);
  });
});
