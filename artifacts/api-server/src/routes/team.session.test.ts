import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  addPerson,
  pool,
  signOutEverywhere,
} from "@workspace/db";
import app from "../app";
import { claimsFor, makeKey, mint } from "../lib/teamAuth/__fixtures__/mint";
import { removeTestPerson } from "../test/removeTestPerson";

// The dashboard session (SYC-43 part 1 plan §6, tests 14–18; spec §8.6 #11).

const EMAIL = "vitest-session-susan@example.com";
const OTHER_EMAIL = "vitest-session-gone@example.com";
const KEY_A = "vitest-session-key-A-0123456789abcdef-0123456789";
const KEY_B = "vitest-session-key-B-0123456789abcdef-0123456789";
const handoffKey = makeKey();
let personId: string;

beforeAll(async () => {
  await removeTestPerson(EMAIL);
  await removeTestPerson(OTHER_EMAIL);
  personId = (
    await addPerson({ email: EMAIL, name: "Susan <b>", addedBy: "cli:vitest" })
  ).id;
});

beforeEach(() => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY_A;
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await removeTestPerson(EMAIL);
  await removeTestPerson(OTHER_EMAIL);
  await pool.end();
});

/** Signs in through the real hand-off; returns the cookie pair to send. */
async function signIn(id: string, sv = 1): Promise<string> {
  const res = await request(app)
    .post("/api/team/handoff")
    .set("Origin", "https://admin.catspotters.com")
    .type("form")
    .send({ token: mint(handoffKey, claimsFor(id, { sv })) });
  expect(res.status).toBe(303);
  const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
  return cookie.split(";")[0]!;
}

/** A cookie value signed by hand, to test what the server refuses. */
function craft(payload: unknown, key = KEY_A): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", Buffer.from(key))
    .update(body)
    .digest("base64url");
  return `__Host-cs_team=${body}.${mac}`;
}

const me = (cookie?: string) => {
  const r = request(app).get("/api/team/me");
  if (cookie) r.set("Cookie", cookie);
  return r;
};

function expectRefusal(res: request.Response) {
  expect(res.status).toBe(401);
  expect(res.text).toBe('{"error":"not_signed_in"}');
}

describe("the session", () => {
  it("lets a signed-in person in, with no CORS headers", async () => {
    const cookie = await signIn(personId);
    const res = await me(cookie).set("Origin", "https://evil.example");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Susan <b>", email: EMAIL });
    expect(res.body.capabilities).toHaveLength(17);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("refuses with no cookie at all", async () => {
    expectRefusal(await me());
  });

  it("is refused on the very next request after sign out everywhere (§8.6 #11)", async () => {
    const cookie = await signIn(personId);
    expect((await me(cookie)).status).toBe(200);
    await signOutEverywhere(EMAIL, "cli:vitest");
    expectRefusal(await me(cookie));
    // Signing in again at the new version works.
    const fresh = await signIn(personId, 2);
    expect((await me(fresh)).status).toBe(200);
  });

  it("is refused on the very next request after the person is removed", async () => {
    const gone = await addPerson({
      email: OTHER_EMAIL,
      name: "Gone",
      addedBy: "cli:vitest",
    });
    const cookie = await signIn(gone.id);
    expect((await me(cookie)).status).toBe(200);
    await removeTestPerson(OTHER_EMAIL);
    expectRefusal(await me(cookie));
  });

  it("refuses a tampered cookie, an unknown key, an expired cookie and one with no expiry", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cookie = await signIn(personId, await currentVersion());
    const [name, value] = cookie.split("=") as [string, string];
    const [body, mac] = value.split(".") as [string, string];
    const tamperedBody = Buffer.from(
      JSON.stringify({ pid: personId, sv: 99, exp: now + 999 }),
    ).toString("base64url");
    expectRefusal(await me(`${name}=${tamperedBody}.${mac}`));
    expectRefusal(await me(`${name}=${body}.${mac.slice(0, -2)}AA`));
    const sv = await currentVersion();
    expectRefusal(
      await me(craft({ pid: personId, sv, exp: now + 999 }, KEY_B)),
    );
    expectRefusal(await me(craft({ pid: personId, sv, exp: now - 1 })));
    expectRefusal(await me(craft({ pid: personId, sv })));
    expectRefusal(await me(craft({ pid: personId, sv, exp: "never" })));
    // The same payload with a readable expiry and the right key is accepted,
    // so the refusals above are about what they claim to be.
    expect(
      (await me(craft({ pid: personId, sv, exp: now + 999 }))).status,
    ).toBe(200);
  });

  it("with two session keys configured, accepts a cookie signed with the second", async () => {
    const now = Math.floor(Date.now() / 1000);
    const sv = await currentVersion();
    const signedWithB = craft({ pid: personId, sv, exp: now + 999 }, KEY_B);
    expectRefusal(await me(signedWithB));
    process.env["TEAM_SESSION_KEYS"] = `${KEY_A},${KEY_B}`;
    expect((await me(signedWithB)).status).toBe(200);
  });

  it("tries every cookie with that name: a bad one first doesn't hide the good one", async () => {
    const good = await signIn(personId, await currentVersion());
    const bad = craft({ pid: personId, sv: 1, exp: 9999999999 }, KEY_B);
    const res = await me(`${bad}; ${good}`);
    expect(res.status).toBe(200);
  });

  it("refuses when TEAM_SESSION_KEYS is removed", async () => {
    const cookie = await signIn(personId, await currentVersion());
    delete process.env["TEAM_SESSION_KEYS"];
    expectRefusal(await me(cookie));
  });
});

describe("the signed-in page", () => {
  it("shows who is signed in, escaped, with a Sign out button and no scripts", async () => {
    const cookie = await signIn(personId, await currentVersion());
    const res = await request(app).get("/api/team/").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Signed in as Susan &lt;b&gt;");
    expect(res.text).toContain("<h1>Welfare queue</h1>");
    expect(res.text).toContain('action="/api/team/signout"');
    expect(res.text).not.toMatch(/<script/i);
  });

  it("sends a browser without a session back to the sign-in page", async () => {
    const res = await request(app)
      .get("/api/team/")
      .set("Sec-Fetch-Mode", "navigate");
    expect(res.status).toBe(401);
    expect(res.text).toContain(
      'content="0;url=https://admin.catspotters.com/"',
    );
  });
});

describe("POST /api/team/signout", () => {
  it("is refused from the wrong Origin, or none, and leaves the cookie alone", async () => {
    for (const origin of [
      "https://admin.catspotters.com",
      "https://evil.catspotters.com",
      null,
    ]) {
      const r = request(app).post("/api/team/signout");
      if (origin) r.set("Origin", origin);
      const res = await r;
      expect(res.status).toBe(401);
      expect(res.text).toBe('{"error":"not_signed_in"}');
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("clears the cookie from the dashboard's own Origin", async () => {
    const res = await request(app)
      .post("/api/team/signout")
      .set("Origin", "https://team.catspotters.com");
    expect(res.status).toBe(204);
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
    expect(cookie).toMatch(/^__Host-cs_team=;/);
    expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(cookie).toMatch(/; Path=\//);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/; HttpOnly/);
  });

  it("sends a browser form post back to the sign-in page", async () => {
    const res = await request(app)
      .post("/api/team/signout")
      .set("Origin", "https://team.catspotters.com")
      .set("Sec-Fetch-Mode", "navigate");
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe("https://admin.catspotters.com/");
  });
});

async function currentVersion(): Promise<number> {
  const r = await pool.query<{ session_version: number }>(
    "select session_version from people where id = $1",
    [personId],
  );
  return r.rows[0]!.session_version;
}
