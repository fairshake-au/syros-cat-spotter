import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { addPerson, db, observationsTable, pool } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import app from "../app";
import { sessionCookieFor, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { createColony } from "../lib/teamColonies";
import { addSite } from "../lib/teamSiteWrites";
import { placeCats } from "../lib/colonyCats";
import { movedAwayNotices, MOVED_AWAY_DAYS } from "../lib/movedAway";
import { guardianOn, seedCat, type SeededCat, type Signed } from "../test/roleKit";
import { removeTestPerson } from "../test/removeTestPerson";

// SYC-209 PR 4.2: what a cat guardian DOES (feeding-sites spec §7.3, §2.7,
// §2.8, Decision 14; plan PR 4.2). Spec test 15 (guardian half), test 21
// (doing), roles T16/T30 (routes half).
//
// Eleni is a cat guardian of colony 1. Colony 2 belongs to Zoe, another cat
// guardian. Every name in colony 2 carries the marker "XQ", which must never
// reach Eleni's pages.

const RUN = randomBytes(3).toString("hex");
const KEY = "vitest-guardianactions-key-0123456789abcdef-012";
const XQ = `XQ${RUN}`;
const C1_NAME = `Vaporia ${RUN} Eleni's`;
const C2_NAME = `Kini ${XQ}`;
const ZOE_NAME_MARK = `Zoe${XQ}`;

let staffId: string;
let staffCookie: string;
let eleni: Signed;
let zoe: Signed;
let eleniName: string;
let c1: number;
let c2: number;

type Mode = "json" | "browser";
function get(path: string, cookie: string, mode: Mode = "browser") {
  const t = request(app).get(path).set("Cookie", cookie);
  return mode === "json" ? t.set("Accept", "application/json") : t.set("Sec-Fetch-Mode", "navigate");
}
function post(path: string, body: Record<string, string>, cookie: string, mode: Mode = "json") {
  const t = request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", cookie);
  return mode === "json" ? t.set("Accept", "application/json").send(body) : t.type("form").send(body);
}

/** Her colony statements' roles and scopes, newest first, for one cat. */
async function colonyStatements(catId: number) {
  return db
    .select({
      value: observationsTable.value,
      roleAtTime: observationsTable.roleAtTime,
      authorityScope: observationsTable.authorityScope,
      accountId: observationsTable.accountId,
    })
    .from(observationsTable)
    .where(and(eq(observationsTable.catId, catId), eq(observationsTable.kind, "colony")))
    .orderBy(desc(observationsTable.id));
}

/** A colony statement as if someone wrote it at `at` (for the 30-day rule). */
async function sayColony(catId: number, colonyId: number | null, by: string, at: Date) {
  await db.insert(observationsTable).values({
    catId,
    kind: "colony",
    value: { colonyId },
    accountId: by,
    roleAtTime: "staff",
    observedAt: at,
  });
}

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  staffId = (
    await addPerson({ email: `vitest-gact-staff-${RUN}@example.com`, name: "Susan", addedBy: "cli:vitest" })
  ).id;
  staffCookie = sessionCookieFor(staffId);
  const made1 = await createColony(staffId, { name: C1_NAME, guardianName: "Eleni", notes: null });
  const made2 = await createColony(staffId, { name: C2_NAME, guardianName: ZOE_NAME_MARK, notes: `n ${XQ}` });
  if (made1.kind !== "created" || made2.kind !== "created") throw new Error("seed colonies");
  c1 = made1.id;
  c2 = made2.id;
  eleni = await guardianOn(`gact-eleni-${RUN}`, [c1]);
  zoe = await guardianOn(`gact-zoe-${RUN}`, [c2]);
  await pool.query("update people set name = $1 where id = $2", [ZOE_NAME_MARK, zoe.id]);
  eleniName = (await pool.query<{ name: string }>("select name from people where id = $1", [eleni.id])).rows[0]!.name;
});

afterAll(async () => {
  delete process.env["TEAM_SESSION_KEYS"];
  for (const p of [eleni, zoe]) if (p) await removeTestPerson(p.email).catch(() => undefined);
  await pool.end();
});

// ── Creating a colony (spec §2.7; roles T30 routes half) ───────────────────

describe("a cat guardian creates a colony, and it is hers at once", () => {
  it("one POST: the colony, her placement on it, the roles event and the history row; she is its guardian", async () => {
    const name = `Kambos ${RUN}`;
    const res = await post("/api/team/colonies", { name, notes: "by the steps", guardianName: "Someone else" }, eleni.cookie);
    expect(res.status).toBe(201);
    const id = (res.body as { id: number }).id;
    const row = (await pool.query("select name, guardian_name, notes, created_by from colonies where id = $1", [id])).rows[0];
    expect(row).toEqual({ name, guardian_name: eleniName, notes: "by the steps", created_by: eleni.id });
    const placed = await pool.query(
      "select role, reach, granted_by from person_scopes where person_id = $1 and colony_id = $2",
      [eleni.id, id],
    );
    expect(placed.rows).toEqual([{ role: "guardian", reach: "colony", granted_by: eleni.id }]);
    const events = await pool.query(
      "select kind, person_id from mapping_events where subject_kind = 'colony' and subject_id = $1",
      [id],
    );
    expect(events.rows).toEqual([{ kind: "colony_created", person_id: eleni.id }]);
    // She sees it straight away; so does the team.
    expect((await get(`/api/team/colonies/${id}`, eleni.cookie, "json")).status).toBe(200);
    expect((await get(`/api/team/colonies/${id}`, staffCookie, "json")).status).toBe(200);
  });

  it("a name already used: \"Another colony already has that name\" (SYC-439), no link, no colony named", async () => {
    const res = await post("/api/team/colonies", { name: C2_NAME }, eleni.cookie, "browser");
    expect(res.status).toBe(409);
    expect(res.text).toContain("Another colony already has that name. Choose a different one.");
    expect(res.text).not.toContain(XQ);
    expect(res.text).not.toContain(`/api/team/colonies/${c2}`);
    const json = await post("/api/team/colonies", { name: C2_NAME }, eleni.cookie);
    expect(json.body).toEqual({ error: "Colony name already taken", code: "NAME_TAKEN" });
  });

  it("she can't rename her colony, or any other", async () => {
    for (const id of [c1, c2]) {
      const res = await post(`/api/team/colonies/${id}`, { name: `renamed ${RUN}` }, eleni.cookie);
      expect(res.status, String(id)).toBe(403);
    }
    expect((await pool.query("select name from colonies where id = $1", [c1])).rows[0].name).toBe(C1_NAME);
  });

  it("she edits her own colony's notes", async () => {
    const res = await post(`/api/team/colonies/${c1}`, { notes: `fed at dusk ${RUN}` }, eleni.cookie);
    expect(res.status).toBe(200);
    expect((await pool.query("select notes from colonies where id = $1", [c1])).rows[0].notes).toBe(`fed at dusk ${RUN}`);
  });
});

// ── Sites (spec §7.3 rule 2; test 21 doing) ────────────────────────────────

describe("a cat guardian's feeding sites", () => {
  it("she adds a site to her colony: private, at that spot, with its history", async () => {
    const res = await post(
      "/api/team/sites",
      { name: `Steps ${RUN}`, lat: "37.4447", lng: "24.9417", colonyId: String(c1), isPublic: "true" },
      eleni.cookie,
    );
    expect(res.status).toBe(201);
    const id = (res.body as { id: number }).id;
    const site = (await pool.query("select colony_id, is_public from feeding_sites where id = $1", [id])).rows[0];
    expect(site).toEqual({ colony_id: c1, is_public: false });
    const ev = await pool.query("select kind, person_id from mapping_events where subject_kind = 'site' and subject_id = $1", [id]);
    expect(ev.rows).toEqual([{ kind: "created", person_id: eleni.id }]);
  });

  it("she edits, retires and brings back her own site; Change colony is refused", async () => {
    const made = await addSite(staffId, { name: `Edit ${RUN}`, lat: 37.4451, lng: 24.9421, colonyId: c1, directions: null, notes: null });
    if (made.kind !== "created") throw new Error("seed site");
    const id = made.id;
    const stamp = async () =>
      String((await pool.query("select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as s from feeding_sites where id = $1", [id])).rows[0].s);
    expect((await post(`/api/team/sites/${id}`, { updatedAt: await stamp(), name: `Edited ${RUN}` }, eleni.cookie)).status).toBe(200);
    expect((await post(`/api/team/sites/${id}/retire`, { updatedAt: await stamp(), reason: "closed" }, eleni.cookie)).status).toBe(200);
    expect((await post(`/api/team/sites/${id}/restore`, { updatedAt: await stamp(), reason: "open again" }, eleni.cookie)).status).toBe(200);
    const colony = await post(`/api/team/sites/${id}/colony`, { updatedAt: await stamp(), colonyId: "" }, eleni.cookie);
    expect([colony.status, colony.text]).toEqual([403, '{"error":"forbidden"}']);
    expect((await pool.query("select name, colony_id, retired_at from feeding_sites where id = $1", [id])).rows[0]).toEqual({
      name: `Edited ${RUN}`,
      colony_id: c1,
      retired_at: null,
    });
  });

  it("the add form says \"Colony\" (required) and \"Notes\" to her, not the team's \"optional\" and \"Team-only\"", async () => {
    const res = await post("/api/team/sites/pick", { lat: "37.4447", lng: "24.9417" }, eleni.cookie, "browser");
    expect(res.status).toBe(200);
    expect(res.text).toContain('<select class="text" id="new-colony" name="colonyId" required>');
    expect(res.text).not.toContain("Colony (optional)");
    expect(res.text).not.toContain("Team-only");
    const team = await post("/api/team/sites/pick", { lat: "37.4447", lng: "24.9417" }, staffCookie, "browser");
    expect(team.text).toContain("Colony (optional)");
    expect(team.text).toContain("Team-only notes (optional)");
  });

  it("a browser retire asks \"Are you sure?\" first (SYC-395), in her language's page", async () => {
    const made = await addSite(staffId, { name: `Sure ${RUN}`, lat: 37.4452, lng: 24.9422, colonyId: c1, directions: null, notes: null });
    if (made.kind !== "created") throw new Error("seed site");
    const stamp = String((await pool.query("select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as s from feeding_sites where id = $1", [made.id])).rows[0].s);
    const res = await post(`/api/team/sites/${made.id}/retire`, { updatedAt: stamp, reason: "closed" }, eleni.cookie, "browser");
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="confirm" value="1"');
    expect((await pool.query("select retired_at from feeding_sites where id = $1", [made.id])).rows[0].retired_at).toBeNull();
  });
});

// ── Cats (spec test 15 guardian half; SYC-333; roles Decision B) ───────────

describe("a cat guardian puts cats in her colony and takes them out", () => {
  let loose: SeededCat;
  let zoes: SeededCat;
  let hers: SeededCat;

  beforeAll(async () => {
    loose = await seedCat(null);
    zoes = await seedCat(c2);
    hers = await seedCat(c1);
  });

  it("adds a cat in no colony: immediately, as a cat guardian, with her colony as the authority", async () => {
    const res = await post(`/api/team/colonies/${c1}/cats`, { catIds: String(loose.id) }, eleni.cookie);
    expect(res.status).toBe(201);
    const [newest] = await colonyStatements(loose.id);
    expect(newest).toEqual({ value: { colonyId: c1 }, roleAtTime: "guardian", authorityScope: `colony:${c1}`, accountId: eleni.id });
  });

  it("adds a cat from another guardian's colony: it moves, and that colony is named nowhere on her pages", async () => {
    const res = await post(`/api/team/colonies/${c1}/cats`, { catIds: String(zoes.id) }, eleni.cookie);
    expect(res.status).toBe(201);
    const [newest] = await colonyStatements(zoes.id);
    expect(newest).toMatchObject({ value: { colonyId: c1 }, roleAtTime: "guardian", authorityScope: `colony:${c1}` });
    for (const path of [`/api/team/colonies/${c1}`, "/api/team/colonies", "/api/team/sites", `/api/team/colonies/${c1}/cats?q=vt-roles`]) {
      const page = await get(path, eleni.cookie);
      expect(page.text, path).not.toContain(XQ);
    }
  });

  it("takes her cat out: checked against the colony it LEAVES, which is the authority", async () => {
    const res = await post(`/api/team/cats/${hers.id}/colony`, { colonyId: "none", from: String(c1) }, eleni.cookie);
    expect(res.status).toBe(201);
    const [newest] = await colonyStatements(hers.id);
    expect(newest).toEqual({ value: { colonyId: null }, roleAtTime: "guardian", authorityScope: `colony:${c1}`, accountId: eleni.id });
  });

  it("is refused for another colony: adding to it, or taking its cat out (403, nothing written)", async () => {
    const other = await seedCat(c2);
    const before = (await colonyStatements(other.id)).length;
    const add = await post(`/api/team/colonies/${c2}/cats`, { catIds: String(loose.id) }, eleni.cookie);
    expect([add.status, add.text]).toEqual([403, '{"error":"forbidden"}']);
    const out = await post(`/api/team/cats/${other.id}/colony`, { colonyId: "none", from: String(c1) }, eleni.cookie);
    expect([out.status, out.text]).toEqual([403, '{"error":"forbidden"}']);
    expect((await colonyStatements(other.id)).length).toBe(before);
  });

  it("placeCats itself refuses taking out another colony's cat, under the lock (not only the route's door)", async () => {
    const other = await seedCat(c2);
    const before = (await colonyStatements(other.id)).length;
    const her = { id: eleni.id, scopes: [{ role: "guardian", colonyId: c1 }] };
    await expect(placeCats(her, null, [other.id])).rejects.toMatchObject({ code: "NOT_AUTHORISED" });
    // A batch with one cat that isn't hers writes nothing for any of them.
    const mine = await seedCat(c1);
    await expect(placeCats(her, null, [mine.id, other.id])).rejects.toMatchObject({ code: "NOT_AUTHORISED" });
    expect((await colonyStatements(other.id)).length).toBe(before);
    expect((await colonyStatements(mine.id)).length).toBe(1);
  });

  it("`from` is only for a take-out: with a destination the library refuses it and the route ignores it (no \"is cat X in colony N?\" test)", async () => {
    const her = { id: eleni.id, scopes: [{ role: "guardian", colonyId: c1 }] };
    const someone = await seedCat(c2);
    await expect(placeCats(her, c1, [someone.id], { onlyFrom: c2 })).rejects.toMatchObject({ code: "MALFORMED_VALUE" });
    // Through the route the answer is the same whatever `from` says: the cat moves to her colony.
    const a = await seedCat(c2);
    const b = await seedCat(c2);
    const withWrongFrom = await post(`/api/team/cats/${a.id}/colony`, { colonyId: String(c1), from: String(c1) }, eleni.cookie);
    const withRightFrom = await post(`/api/team/cats/${b.id}/colony`, { colonyId: String(c1), from: String(c2) }, eleni.cookie);
    expect(withWrongFrom.status).toBe(withRightFrom.status);
    expect(Object.keys(withWrongFrom.body).sort()).toEqual(Object.keys(withRightFrom.body).sort());
    for (const cat of [a, b]) expect((await colonyStatements(cat.id))[0]?.value).toEqual({ colonyId: c1 });
    const browser = await post(`/api/team/cats/${a.id}/colony`, { colonyId: String(c1), from: String(c2) }, eleni.cookie, "browser");
    expect(browser.headers["location"] ?? "").not.toContain(`/api/team/colonies/${c2}`);
  });

  it("there is no pending state: nothing waits for the team", async () => {
    const pending = await pool.query(
      "select count(*)::int as n from information_schema.tables where table_name in ('colony_change_proposals', 'pending_colony_changes')",
    );
    expect(pending.rows[0].n).toBe(0);
  });
});

// ── "Mimi has moved to another colony" (Decision 14) ───────────────────────

describe("movedAwayNotices: her cat moved to someone else's colony", () => {
  it("shows the cat and the day on her colony page and My colonies, never the colony or its guardian", async () => {
    const mimi = await seedCat(null);
    const now = Date.now();
    await sayColony(mimi.id, c1, staffId, new Date(now - 5 * 60_000));
    await sayColony(mimi.id, c2, zoe.id, new Date(now - 60_000));
    const name = (await pool.query("select name from cats where id = $1", [mimi.id])).rows[0].name as string;

    const notices = await movedAwayNotices({ id: eleni.id, scopes: [{ role: "guardian", colonyId: c1 }] });
    expect(notices.map((n) => [n.catId, n.fromColonyId])).toContainEqual([mimi.id, c1]);

    for (const path of [`/api/team/colonies/${c1}`, "/api/team/my/colonies"]) {
      const page = (await get(path, eleni.cookie)).text;
      expect(page, path).toContain(`${name} has moved to another colony`);
      // Never the other colony or anyone in it, by any seeded name.
      for (const secret of [XQ, C2_NAME, ZOE_NAME_MARK, `/api/team/colonies/${c2}`]) expect(page, `${path} ${secret}`).not.toContain(secret);
    }
    // Zoe (the colony it went to) gets no such line.
    expect(await movedAwayNotices({ id: zoe.id, scopes: [{ role: "guardian", colonyId: c2 }] })).not.toContainEqual(
      expect.objectContaining({ catId: mimi.id }),
    );
  });

  it("not for a move she made herself, a cat taken out to no colony, or a move more than 30 days ago", async () => {
    const now = Date.now();
    const selfMoved = await seedCat(null);
    await sayColony(selfMoved.id, c1, staffId, new Date(now - 5 * 60_000));
    await sayColony(selfMoved.id, c2, eleni.id, new Date(now - 60_000));
    const takenOut = await seedCat(null);
    await sayColony(takenOut.id, c1, staffId, new Date(now - 5 * 60_000));
    await sayColony(takenOut.id, null, staffId, new Date(now - 60_000));
    const old = await seedCat(null);
    await sayColony(old.id, c1, staffId, new Date(now - (MOVED_AWAY_DAYS + 2) * 86_400_000));
    await sayColony(old.id, c2, zoe.id, new Date(now - (MOVED_AWAY_DAYS + 1) * 86_400_000));

    const ids = (await movedAwayNotices({ id: eleni.id, scopes: [{ role: "guardian", colonyId: c1 }] })).map((n) => n.catId);
    for (const cat of [selfMoved, takenOut, old]) expect(ids).not.toContain(cat.id);
  });

  it("nothing for the team", async () => {
    expect(await movedAwayNotices({ id: staffId, scopes: [{ role: "staff", colonyId: null }] })).toEqual([]);
  });
});
