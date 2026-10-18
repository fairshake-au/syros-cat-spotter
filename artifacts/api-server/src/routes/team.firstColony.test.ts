import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { addPerson, pool } from "@workspace/db";
import app from "../app";
import { claimsFor, makeKey, mint } from "../lib/teamAuth/__fixtures__/mint";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { createColony } from "../lib/teamColonies";
import { endPlacements, guardianOn, starterPerson, type Signed } from "../test/roleKit";
import { removeTestPerson } from "../test/removeTestPerson";

// SYC-439 (roles-and-invites-first-colony.md §3, §5, §6): a cat guardian
// with no colony yet. Before her first colony she reaches her own pages, the
// Colonies list (empty) and the create form, and nothing else. Creating it
// makes her its cat guardian and ends "no colony yet", in one transaction.
// Another colony, whose names carry the marker XQ, must never reach her.

const RUN = randomBytes(3).toString("hex");
const KEY = "vitest-firstcolony-key-0123456789abcdef-0123456";
const XQ = `XQ${RUN}`;
const OTHER = `Kini ${XQ}`;
const handoffKey = makeKey();

let staffId: string;
let other: number;
let mara: Signed;
const made: string[] = [];

function get(path: string, cookie: string, mode: "json" | "browser" = "browser") {
  const t = request(app).get(path).set("Cookie", cookie);
  return mode === "json" ? t.set("Accept", "application/json") : t.set("Sec-Fetch-Mode", "navigate");
}
function postForm(path: string, body: Record<string, string>, cookie: string) {
  return request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", cookie).type("form").send(body);
}

async function rowsOf(personId: string) {
  return (
    await pool.query<{ role: string; colony_id: number | null; reach: string }>(
      "select role, colony_id, reach from person_scopes where person_id = $1 order by id",
      [personId],
    )
  ).rows;
}
async function rolesChanged(personId: string) {
  return (
    await pool.query<{ by: string; detail: Record<string, unknown> }>(
      "select by, detail from person_events where person_id = $1 and kind = 'roles_changed' order by id",
      [personId],
    )
  ).rows;
}

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  const email = `vitest-firstcol-staff-${RUN}@example.com`;
  made.push(email);
  staffId = (await addPerson({ email, name: "Susan", addedBy: "cli:vitest" })).id;
  const c = await createColony(staffId, { name: OTHER, guardianName: `Zoe${XQ}`, notes: `n ${XQ}` });
  if (c.kind !== "created") throw new Error("seed colony");
  other = c.id;
  mara = await starterPerson(`firstcol-mara-${RUN}`);
  made.push(mara.email);
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
});

afterAll(async () => {
  delete process.env["TEAM_SESSION_KEYS"];
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  for (const e of made) await removeTestPerson(e);
  await pool.end();
});

describe("before her first colony", () => {
  it("My colonies: one way on, to the create form; never 'nothing' or 'seems wrong'", async () => {
    const res = await get("/api/team/my/colonies", mara.cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("You haven’t got a colony yet. Create one for the cats you look after.");
    expect(res.text).toContain('href="/api/team/colonies#create"');
    expect(res.text).not.toContain("If that seems wrong");
  });

  it("My page says she's a cat guardian with no colony yet", async () => {
    const res = await get("/api/team/my", mara.cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("You’re a cat guardian. You haven’t created a colony yet.");
    expect(res.text).not.toContain("You aren’t helping");
  });

  it("the Colonies list: empty, true from where she stands, the create form open; nothing of another colony", async () => {
    const page = await get("/api/team/colonies", mara.cookie);
    expect(page.status).toBe(200);
    expect(page.text).toContain("Colonies you look after appear here.");
    expect(page.text).not.toContain("There are no colonies yet.");
    expect(page.text).toContain('<details id="create" open>');
    expect(page.text).not.toContain(XQ);
    // Her menu: Colonies and her own pages, never Feeding sites.
    expect(page.text).toContain('href="/api/team/colonies"');
    expect(page.text).not.toContain('href="/api/team/sites"');
    const json = await get("/api/team/colonies", mara.cookie, "json");
    expect(json.status).toBe(200);
    expect(json.body.colonies).toEqual([]);
    const search = await get(`/api/team/colonies?q=${encodeURIComponent("Kini")}`, mara.cookie);
    expect(search.text).toContain("None of your colonies has a name like that.");
    expect(search.text).not.toContain(XQ);
  });

  it("everything else gives the 403 with her own line, never 'access has ended'", async () => {
    for (const path of [
      "/api/team/sites",
      `/api/team/colonies/${other}`,
      "/api/team/me",
      "/api/team",
      "/api/team/map",
      `/api/team/my/colonies/${other}`,
      "/api/team/my/cats/1",
    ]) {
      const page = await get(path, mara.cookie);
      expect(page.status, path).toBe(403);
      expect(page.text, path).toContain("You can create your first colony here");
      expect(page.text, path).not.toContain("Your access has ended");
      const json = await get(path, mara.cookie, "json");
      expect([json.status, json.text], path).toEqual([403, '{"error":"forbidden"}']);
    }
  });

  it("a name another colony has: refused, nothing written, and she is still starting", async () => {
    const res = await postForm("/api/team/colonies", { name: OTHER }, mara.cookie);
    expect(res.status).toBe(409);
    expect(res.text).toContain("Another colony already has that name. Choose a different one.");
    expect(res.text).not.toContain(`/api/team/colonies/${other}`);
    expect(await rowsOf(mara.id)).toEqual([{ role: "guardian", colony_id: null, reach: "start" }]);
    expect(await rolesChanged(mara.id)).toEqual([]);
  });
});

describe("the sign-in door lets her in, and still refuses an ended cat guardian", () => {
  it("the hand-off gives her a session and sends her to My colonies; an ended guardian gets none", async () => {
    const res = await request(app)
      .post("/api/team/handoff")
      .set("Origin", "https://admin.catspotters.com")
      .type("form")
      .send({ token: mint(handoffKey, claimsFor(mara.id)) });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe("https://team.catspotters.com/api/team/my/colonies");
    const ended = await guardianOn(`firstcol-ended-${RUN}`, [other]);
    made.push(ended.email);
    await endPlacements(ended.id);
    const refused = await request(app)
      .post("/api/team/handoff")
      .set("Origin", "https://admin.catspotters.com")
      .type("form")
      .send({ token: mint(handoffKey, claimsFor(ended.id)) });
    expect(refused.status).toBe(401);
    expect(refused.headers["set-cookie"]).toBeUndefined();
  });

  it("a link tapped twice sends her home, not to sign in", async () => {
    const token = mint(handoffKey, claimsFor(mara.id));
    const first = await request(app)
      .post("/api/team/handoff")
      .set("Origin", "https://admin.catspotters.com")
      .type("form")
      .send({ token });
    expect(first.status).toBe(303);
    const again = await request(app)
      .post("/api/team/handoff")
      .set("Origin", "https://admin.catspotters.com")
      .set("Cookie", mara.cookie)
      .type("form")
      .send({ token });
    expect(again.status).toBe(303);
    expect(again.headers["location"]).toBe("https://team.catspotters.com/api/team/my/colonies");
  });

  it("the sign-in Worker's dashboard question says yes for her and no for an ended guardian; never the workspace", async () => {
    process.env["INTERNAL_PEOPLE_TOKEN"] = "vitest-firstcol-internal-0123456789abcdef";
    try {
      const ask = (email: string) =>
        request(app)
          .post("/api/internal/people/allowed")
          .set("Authorization", "Bearer vitest-firstcol-internal-0123456789abcdef")
          .send({ email, version: 2 });
      const yes = await ask(mara.email);
      expect(yes.body.allowed).toBe(true);
      expect(yes.body.doors).toEqual({ workspace: false, dashboard: true });
      const old = await request(app)
        .post("/api/internal/people/allowed")
        .set("Authorization", "Bearer vitest-firstcol-internal-0123456789abcdef")
        .send({ email: mara.email });
      expect(old.body.allowed).toBe(false);
      const ended = await guardianOn(`firstcol-ended2-${RUN}`, [other]);
      made.push(ended.email);
      await endPlacements(ended.id);
      const no = await ask(ended.email);
      expect(no.body.allowed).toBe(false);
    } finally {
      delete process.env["INTERNAL_PEOPLE_TOKEN"];
    }
  });
});

describe("creating her first colony", () => {
  let mine: number;

  it("makes her its cat guardian and ends 'no colony yet', in one step, recorded once", async () => {
    const name = `Vaporia ${RUN} Mara's`;
    const res = await postForm("/api/team/colonies", { name, notes: "by the steps", guardianName: "ignored" }, mara.cookie);
    expect(res.status).toBe(303);
    const m = /\/api\/team\/colonies\/(\d+)\?done=created$/.exec(String(res.headers["location"]));
    expect(m).not.toBeNull();
    mine = Number(m![1]);
    expect(await rowsOf(mara.id)).toEqual([{ role: "guardian", colony_id: mine, reach: "colony" }]);
    const events = await rolesChanged(mara.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.by).toBe(mara.id);
    expect(events[0]!.detail).toEqual({
      before: ["guardian:start"],
      after: [`guardian:${mine}`],
      createdColony: mine,
    });
    // Her own name is the guardian's name, whatever the form said.
    const g = await pool.query<{ guardian_name: string | null; created_by: string }>(
      "select guardian_name, created_by from colonies where id = $1",
      [mine],
    );
    expect(g.rows[0]).toEqual({ guardian_name: `Vt firstcol-mara-${RUN}`, created_by: mara.id });
  });

  it("afterwards she sees her new colony and nothing else, and is an ordinary cat guardian", async () => {
    const json = await get("/api/team/colonies", mara.cookie, "json");
    expect(json.status).toBe(200);
    expect(json.body.colonies.map((c: { id: number }) => c.id)).toEqual([mine]);
    const page = await get(`/api/team/colonies/${mine}`, mara.cookie);
    expect(page.status).toBe(200);
    expect(page.text).not.toContain(XQ);
    const sites = await get("/api/team/sites", mara.cookie);
    expect(sites.status).toBe(200);
    expect(sites.text).toContain('href="/api/team/sites"');
    const notHers = await get(`/api/team/colonies/${other}`, mara.cookie, "json");
    expect(notHers.status).toBe(404);
    const myCols = await get("/api/team/my/colonies", mara.cookie);
    expect(myCols.text).toContain(`Vaporia ${RUN} Mara`);
    // The welfare queue is still the team's.
    expect((await get("/api/team", mara.cookie, "json")).status).toBe(403);
  });

  it("when that placement ends she gets 'access has ended', not 'no colony yet' again", async () => {
    await endPlacements(mara.id);
    const page = await get("/api/team/colonies", mara.cookie);
    expect(page.status).toBe(403);
    expect(page.text).toContain("Your access has ended");
    expect((await rowsOf(mara.id)).some((r) => r.reach === "start")).toBe(false);
  });
});
