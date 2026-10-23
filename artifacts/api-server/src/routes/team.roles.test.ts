import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  addPerson,
  db,
  personScopesTable,
  pool,
  } from "@workspace/db";
import app from "../app";
import { claimsFor, makeKey, mint } from "../lib/teamAuth/__fixtures__/mint";
import { sessionCookieFor } from "../lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "../test/removeTestPerson";
import { CAPABILITIES } from "../lib/capabilities";

// SYC-188: being in the people table is not being let in. Only someone whose
// role grants something through can() gets a yes from the Worker's question,
// a session from the hand-off, or past requireTeam() with no capability
// (/me). Everyone else is refused exactly like an address that was never on
// the list, so the Worker sees no difference in shape.
//
// SYC-53 PR 0.5 changes three things here. Management counts on its own. A
// cat guardian placed on a colony holds placed capabilities there, so she
// passes the DASHBOARD door (and still never the workspace one). And a
// person with a valid session who is on the list, joined and not left, but
// holds nothing, now gets the 403 "Your access has ended" from /me rather
// than the sign-in 401 (review minor 2): the 401 is kept for a session that
// isn't valid or a person who is gone or not yet joined.

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

/**
 * The live Worker's question (`version: 2`, checked 23 Oct 2026). Since
 * SYC-619 §2.2 the old shape's yes means the workspace, management's alone,
 * so a staff member is let in through the dashboard door of this shape.
 */
const askDoors = (email: string) =>
  request(app)
    .post("/api/internal/people/allowed")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send({ email, version: 2 });

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

const add = (roles: string[], colonyId?: number) =>
  addPerson({ email: EMAIL, name: "Pat", addedBy: "cli:vitest", roles, colonyId });

/**
 * A manager: the one role that holds the workspace (SYC-619 §2.2), so a
 * refusal of left, pending or removed people proves the state, not the role.
 * Management is written directly, as in the test below.
 */
const addManager = async () => {
  const p = await add(["staff"]);
  await pool.query("update person_scopes set role = 'management' where person_id = $1", [p.id]);
  return p;
};

/** SYC-53 PR 0.3: a cat guardian is always placed on a colony. */
const aColony = async () =>
  (
    await pool.query<{ id: number }>(
      "insert into colonies (name, normalised_name) values ($1, lower($1)) returning id",
      [`Vitest roles colony ${Date.now()} ${Math.random()}`],
    )
  ).rows[0]!.id;

/**
 * The Worker and the hand-off refuse this person exactly as they refuse a
 * stranger. /me, with a session, answers `meStatus`: 401 for a person who
 * is gone or not yet joined (the same 401 as a stranger), 403 for a person
 * still on the list who holds nothing.
 */
async function expectKeptOut(id: string, sv: number, meStatus: 401 | 403) {
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
  const meThem = seen(await me(id, sv));
  if (meStatus === 401) {
    expect(meThem).toEqual(meNever);
  } else {
    expect(meThem.status).toBe(403);
    expect(meThem.text).toBe('{"error":"forbidden"}');
  }
}

describe("SYC-188: only a role that grants something is let in", () => {
  it("staff: the Worker hears yes (the dashboard door, not the workspace), the hand-off gives a session, /me answers", async () => {
    const p = await add(["staff"]);
    const yes = await askDoors(EMAIL);
    expect(yes.body).toEqual({
      allowed: true,
      doors: { workspace: false, dashboard: true },
      language: "en",
      personId: p.id,
      name: "Pat",
      sessionVersion: p.sessionVersion,
    });
    const h = await handoff(p.id, p.sessionVersion);
    expect(h.status).toBe(303);
    expect(String(h.headers["set-cookie"])).toContain("__Host-cs_team=");
    const m = await me(p.id, p.sessionVersion);
    expect(m.status).toBe(200);
    // Everything in the catalogue but the four a team-only member lacks
    // (manage_people, action_deletion_request and, since SYC-619 §2.2,
    // use_workspace are management's; request_site_public is a guardian's),
    // each island-wide.
    expect(m.body.capabilities).toHaveLength(CAPABILITIES.length - 4);
    expect(m.body.capabilities.map((c: { capability: string }) => c.capability)).not.toContain("use_workspace");
    expect(m.body.capabilities.map((c: { capability: string }) => c.capability)).toContain("review_cat_news");
    for (const c of m.body.capabilities) expect(c.where).toBe("island");
  });

  it("staff who is also a guardian is still let in", async () => {
    const p = await add(["guardian", "staff"], await aColony());
    expect((await askDoors(EMAIL)).body.doors).toEqual({ workspace: false, dashboard: true });
    expect((await handoff(p.id, p.sessionVersion)).status).toBe(303);
    expect((await me(p.id, p.sessionVersion)).status).toBe(200);
  });

  for (const roles of [["guardian"], ["guardian", "vet"]]) {
    it(`${roles.join(" + ")} on a colony: no workspace, but the dashboard door, and /me lists only her colony (SYC-53 PR 0.5)`, async () => {
      const colony = await aColony();
      const p = await add(roles, colony);
      // The old request shape is the workspace door (PR 0.4): no.
      expect((await ask(EMAIL)).body).toEqual({ allowed: false });
      const h = await handoff(p.id, p.sessionVersion);
      expect(h.status).toBe(303);
      // She lands on her own page, never on the queue's 403 (review finding 2).
      expect(h.headers["location"]).toBe("https://team.catspotters.com/api/team/my/colonies");
      const m = await me(p.id, p.sessionVersion);
      expect(m.status).toBe(200);
      const where = Object.fromEntries(
        (m.body.capabilities as { capability: string; where: unknown }[]).map((c) => [c.capability, c.where]),
      );
      expect(where["view_exact_location"]).toEqual([colony]);
      expect(where["create_colony"]).toBe("anywhere");
      for (const team of ["view_welfare_queue", "use_workspace", "manage_people", "hide_photo"]) {
        expect(where[team], team).toBeUndefined();
      }
      for (const w of Object.values(where)) expect(w).not.toBe("island");
    });
  }

  it("vet only: kept out at the Worker and the hand-off, like a stranger; /me with a session is the 403", async () => {
    const p = await add(["vet"]);
    await expectKeptOut(p.id, p.sessionVersion, 403);
  });

  it("management only (no staff): let in, since PR 0.5 makes management count", async () => {
    // Written directly; the people command can make it too since SYC-316.
    const p = await add(["staff"]);
    await pool.query(
      "update person_scopes set role = 'management' where person_id = $1",
      [p.id],
    );
    expect((await ask(EMAIL)).body.allowed).toBe(true);
    expect((await handoff(p.id, p.sessionVersion)).status).toBe(303);
    const m = await me(p.id, p.sessionVersion);
    expect(m.status).toBe(200);
    const names = (m.body.capabilities as { capability: string }[]).map((c) => c.capability);
    expect(names).toContain("manage_people");
    expect(names).toContain("use_workspace");
  });

  it("a pending person (invited, not yet accepted) can't sign in: kept out at every door (SYC-53 PR 0.3, T9)", async () => {
    const p = await addManager();
    await pool.query("update people set accepted_at = null where id = $1", [p.id]);
    await expectKeptOut(p.id, p.sessionVersion, 401);
    // Control: the same person, once accepted, is let in.
    await pool.query("update people set accepted_at = now() where id = $1", [p.id]);
    expect((await askDoors(EMAIL)).body.allowed).toBe(true);
    expect((await me(p.id, p.sessionVersion)).status).toBe(200);
  });

  it("someone in the table with no roles at all is kept out", async () => {
    const p = await add(["staff"]);
    await db
      .delete(personScopesTable)
      .where(eq(personScopesTable.personId, p.id));
    await expectKeptOut(p.id, p.sessionVersion, 403);
  });

  it("staff who has left is kept out (left_at, at their current version)", async () => {
    const p = await addManager();
    // Written directly: markLeft refuses to remove the only manager.
    const left = await pool.query<{ session_version: number }>(
      "update people set left_at = now(), session_version = session_version + 1 where id = $1 returning session_version",
      [p.id],
    );
    await expectKeptOut(p.id, left.rows[0]!.session_version, 401);
  });

  it("staff who was removed is kept out", async () => {
    const p = await addManager();
    expect(await removeTestPerson(EMAIL)).toBe(true);
    await expectKeptOut(p.id, p.sessionVersion, 401);
  });
});
