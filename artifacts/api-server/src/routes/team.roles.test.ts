import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  addPerson,
  db,
  markLeft,
  personScopesTable,
  pool,
  } from "@workspace/db";
import app from "../app";
import { claimsFor, makeKey, mint } from "../lib/teamAuth/__fixtures__/mint";
import { sessionCookieFor } from "../lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "../test/removeTestPerson";

// SYC-188: being in the people table is not being let in. Only someone whose
// role grants something through can() (staff, today: spec §7.1) gets a yes
// from the Worker's question, a session from the hand-off, or past
// requireTeam() with no capability (/me). Everyone else is refused exactly
// like an address that was never on the list, so the Worker sees no
// difference in shape.

const EMAIL = "vitest-roles-person@example.com";
const NEVER_EMAIL = "vitest-roles-never@example.com";
const NEVER_ID = "00000000-0000-4000-8000-000000000000";
const SESSION_KEY = "vitest-session-key-R-0123456789abcdef-0123456789";
const TOKEN = "vitest-internal-token-roles-0123456789abcdef";
const handoffKey = makeKey();

beforeEach(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = SESSION_KEY;
  process.env["INTERNAL_PEOPLE_TOKEN"] = TOKEN;
  await removeTestPerson(EMAIL);
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  delete process.env["INTERNAL_PEOPLE_TOKEN"];
  await removeTestPerson(EMAIL);
  await pool.end();
});

const ask = (email: string) =>
  request(app)
    .post("/api/internal/people/allowed")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ email });

const handoff = (id: string, sv: number) =>
  request(app)
    .post("/api/team/handoff")
    .set("Origin", "https://admin.catspotters.com")
    .type("form")
    .send({ token: mint(handoffKey, claimsFor(id, { sv })) });

const me = (pid: string, sv: number) =>
  request(app).get("/api/team/me").set("Cookie", sessionCookieFor(pid, sv));

/** What a client can see of a response. */
const seen = (res: request.Response) => ({
  status: res.status,
  text: res.text,
  setCookie: res.headers["set-cookie"],
  location: res.headers["location"],
});

const add = (roles: string[]) =>
  addPerson({ email: EMAIL, name: "Pat", addedBy: "cli:vitest", roles });

/** All three doors refuse this person exactly as they refuse a stranger. */
async function expectKeptOut(id: string, sv: number) {
  const askNever = await ask(NEVER_EMAIL);
  const askThem = await ask(EMAIL);
  expect(askThem.status).toBe(200);
  expect(askThem.body).toEqual({ allowed: false });
  expect(askThem.text).toBe(askNever.text);

  const handoffNever = seen(await handoff(NEVER_ID, 1));
  expect(handoffNever.status).toBe(401);
  expect(handoffNever.setCookie).toBeUndefined();
  expect(seen(await handoff(id, sv))).toEqual(handoffNever);

  const meNever = seen(await me(NEVER_ID, 1));
  expect(meNever.status).toBe(401);
  expect(seen(await me(id, sv))).toEqual(meNever);
}

describe("SYC-188: only a role that grants something is let in", () => {
  it("staff: the Worker hears yes, the hand-off gives a session, /me answers", async () => {
    const p = await add(["staff"]);
    const yes = await ask(EMAIL);
    expect(yes.body).toEqual({
      allowed: true,
      personId: p.id,
      name: "Pat",
      sessionVersion: p.sessionVersion,
    });
    const h = await handoff(p.id, p.sessionVersion);
    expect(h.status).toBe(303);
    expect(String(h.headers["set-cookie"])).toContain("__Host-cs_team=");
    const m = await me(p.id, p.sessionVersion);
    expect(m.status).toBe(200);
    expect(m.body.capabilities).toHaveLength(12);
  });

  it("staff who is also a guardian is still let in", async () => {
    const p = await add(["guardian", "staff"]);
    expect((await ask(EMAIL)).body.allowed).toBe(true);
    expect((await handoff(p.id, p.sessionVersion)).status).toBe(303);
    expect((await me(p.id, p.sessionVersion)).status).toBe(200);
  });

  for (const roles of [
    ["guardian"],
    ["volunteer"],
    ["vet"],
    ["volunteer", "vet"],
  ]) {
    it(`${roles.join(" + ")} only: kept out at every door, like a stranger`, async () => {
      const p = await add(roles);
      await expectKeptOut(p.id, p.sessionVersion);
    });
  }

  it("someone in the table with no roles at all is kept out", async () => {
    const p = await add(["staff"]);
    await db
      .delete(personScopesTable)
      .where(eq(personScopesTable.personId, p.id));
    await expectKeptOut(p.id, p.sessionVersion);
  });

  it("staff who has left is kept out (left_at, at their current version)", async () => {
    const p = await add(["staff"]);
    const left = await markLeft(EMAIL, "cli:vitest");
    await expectKeptOut(p.id, left!.sessionVersion);
  });

  it("staff who was removed is kept out", async () => {
    const p = await add(["staff"]);
    expect(await removeTestPerson(EMAIL)).toBe(true);
    await expectKeptOut(p.id, p.sessionVersion);
  });
});
