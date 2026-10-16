import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, observationsTable, photosTable, sightingsTable, type Observation } from "@workspace/db";
import app from "../app";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { ObservationRefused, writeObservation } from "../lib/observations";
import {
  guardianPutsBack,
  myStatementsOnCat,
  PUT_BACK_REASON,
  recentGuardianMark,
} from "../lib/guardianStatements";
import { removeTestPerson } from "../test/removeTestPerson";
import { findPersonById, markLeft, pool } from "@workspace/db";
import {
  guardianOn,
  newColony,
  RUN,
  seedCat,
  signedPerson,
  type Signed,
} from "../test/roleKit";

// SYC-53 PR 2.2: what a cat guardian says about a cat, through the real routes
// (roles-and-invites.md §2.2, §7.2, Decision 5, Q3; plan tests T12a (her
// statements), T23, T28, T29c, and "a guardian can't supersede the team's
// statement or another guardian's").

const KEY = "vitest-gstat-key-0123456789abcdef-0123456789ab";
const JSON_ACCEPT = { Accept: "application/json" };
const DAY = 86_400_000;

let colonyA: number;
let colonyB: number;
let eleni: Signed; // a guardian on A
let dimitra: Signed; // another guardian on A
let maria: Signed; // a guardian on B
let team: Signed;
let both: Signed; // staff, and a guardian on A

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  colonyA = await newColony("gstat-A");
  colonyB = await newColony("gstat-B");
  eleni = await guardianOn("gstat-eleni", [colonyA]);
  dimitra = await guardianOn("gstat-dimitra", [colonyA]);
  maria = await guardianOn("gstat-maria", [colonyB]);
  team = await signedPerson("gstat-team", ["staff"]);
  both = await signedPerson("gstat-both", ["staff"]);
  await pool.query(
    `insert into person_scopes (person_id, role, colony_id, reach) values ($1, 'guardian', $2, 'colony')`,
    [both.id, colonyA],
  );
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
});

afterAll(async () => {
  // People who wrote statements keep them (the record is add-only): they are
  // marked as left, as team.corrections.test.ts does; the rest are removed.
  for (const p of [eleni, dimitra, maria, team, both]) {
    await removeTestPerson(p.email).catch(() => markLeft(p.email, "cli:vitest"));
  }
});

const post = (who: Signed, path: string, body: Record<string, unknown>) =>
  request(app)
    .post(path)
    .set("Origin", TEAM_ORIGIN)
    .set("Cookie", who.cookie)
    .set(JSON_ACCEPT)
    .send(body);

const get = (who: Signed, path: string) =>
  request(app).get(path).set("Cookie", who.cookie).set(JSON_ACCEPT);

const sayStr = (who: Signed, catId: number, body: Record<string, unknown>) =>
  post(who, `/api/team/my/cats/${catId}/sterilisation`, body);
const sayLife = (who: Signed, catId: number, body: Record<string, unknown>) =>
  post(who, `/api/team/my/cats/${catId}/life-status`, body);

async function rowsOf(catId: number): Promise<Observation[]> {
  return db.select().from(observationsTable).where(eq(observationsTable.catId, catId));
}

async function rowById(id: number): Promise<Observation> {
  const [r] = await db.select().from(observationsTable).where(eq(observationsTable.id, id));
  return r!;
}

async function personOf(s: Signed) {
  return (await findPersonById(s.id))!;
}

describe("T12a: her 'sterilised' on a cat in her colony", () => {
  it("is Confirmed at once, recorded with her id, the role guardian and colony:<id>", async () => {
    const cat = await seedCat(colonyA);
    const res = await sayStr(eleni, cat.id, { sterilised: "yes" });
    expect(res.status).toBe(201);
    const row = await rowById(res.body.statementId);
    expect(row).toMatchObject({
      catId: cat.id,
      kind: "sterilised",
      value: { sterilised: true },
      accountId: eleni.id,
      roleAtTime: "guardian",
      authorityScope: `colony:${colonyA}`,
      supersedesId: null,
    });
    const page = await get(eleni, `/api/team/my/cats/${cat.id}`);
    expect(page.body.cat.sterilised).toEqual({ value: true, confidence: "confirmed" });
  });

  it("is refused on a cat outside her colonies, or in none, and nothing is written", async () => {
    const theirs = await seedCat(colonyB);
    const loose = await seedCat(null);
    for (const cat of [theirs, loose]) {
      const before = (await rowsOf(cat.id)).length;
      expect((await sayStr(eleni, cat.id, { sterilised: "yes" })).status).toBe(403);
      expect((await sayLife(eleni, cat.id, { status: "homed", reason: "x" })).status).toBe(403);
      expect((await rowsOf(cat.id)).length).toBe(before);
    }
  });

  it("no such cat is a plain not-found", async () => {
    expect((await sayStr(eleni, 987654321, { sterilised: "yes" })).status).toBe(404);
  });

  it("the team's later 'this is wrong' supersedes it, and both stay in the history", async () => {
    const cat = await seedCat(colonyA);
    const hers = (await sayStr(eleni, cat.id, { sterilised: "yes" })).body.statementId as number;
    const wrong = await post(team, `/api/team/observations/${hers}/supersede`, {
      value: { sterilised: false },
      reason: "Vet record says not yet",
    });
    expect(wrong.status).toBe(201);
    const view = await get(team, `/api/team/cats/${cat.id}`);
    const ids = view.body.history.map((h: { id: number }) => h.id);
    expect(ids).toContain(hers);
    expect(ids).toContain(wrong.body.id);
    expect(view.body.records.sterilised.value).toBe(false);
    // She sees that Syros Cats looked again, with no name.
    const mine = (await get(eleni, `/api/team/my/cats/${cat.id}`)).body.mine;
    expect(mine.lookedAgain).toEqual([{ kind: "sterilised", now: false, at: expect.any(String) }]);
    const html = (await request(app).get(`/api/team/my/cats/${cat.id}`).set("Cookie", eleni.cookie)).text;
    expect(html).toContain("Syros Cats looked again and think this cat isn’t sterilised");
    expect(html).not.toContain("Vt gstat-team");
  });

  it("'she isn't' is one tap too", async () => {
    const cat = await seedCat(colonyA);
    const res = await sayStr(eleni, cat.id, { sterilised: false });
    expect(res.status).toBe(201);
    expect((await rowById(res.body.statementId)).value).toEqual({ sterilised: false });
  });
});

describe("T23: who she is, and when, come from the server", () => {
  it("a guardian can't write staff, a scope or a date by sending them", async () => {
    const cat = await seedCat(colonyA);
    const before = Date.now();
    const res = await sayStr(eleni, cat.id, {
      sterilised: "yes",
      roleAtTime: "staff",
      authorityScope: "none",
      authority_scope: "colony:1",
      observedAt: "2020-01-01T00:00:00.000Z",
      observed_at: "2020-01-01T00:00:00.000Z",
    });
    expect(res.status).toBe(201);
    const row = await rowById(res.body.statementId);
    expect(row.roleAtTime).toBe("guardian");
    expect(row.authorityScope).toBe(`colony:${colonyA}`);
    // Mutation probe: honour the client's observedAt on a guardian route → red.
    expect(row.observedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.observedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("the same for a life status", async () => {
    const cat = await seedCat(colonyA);
    const before = Date.now();
    const res = await sayLife(eleni, cat.id, {
      status: "in_care",
      reason: "At the clinic",
      observedAt: "2020-01-01T00:00:00.000Z",
      roleAtTime: "staff",
    });
    expect(res.status).toBe(201);
    const row = await rowById(res.body.statementId);
    expect(row.roleAtTime).toBe("guardian");
    expect(row.authorityScope).toBe(`colony:${colonyA}`);
    expect(row.observedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("a person who is both team and a guardian writes the role that authorised it: the team's island row", async () => {
    const cat = await seedCat(colonyA);
    const res = await sayStr(both, cat.id, { sterilised: "yes" });
    expect(res.status).toBe(201);
    const row = await rowById(res.body.statementId);
    expect(row.roleAtTime).toBe("staff");
    expect(row.authorityScope).toBe("none");
  });
});

describe("T28: only the allowed life statuses, with a reason", () => {
  it("homed, in care and deceased only; street and anything else are refused", async () => {
    const cat = await seedCat(colonyA);
    for (const status of ["homed", "in_care", "deceased"]) {
      const res = await sayLife(eleni, cat.id, { status, reason: "Seen it myself" });
      expect(res.status, status).toBe(201);
      expect((await rowById(res.body.statementId)).value).toEqual({ status, reason: "Seen it myself" });
    }
    const before = (await rowsOf(cat.id)).length;
    for (const status of ["street", "lost", "", null]) {
      expect((await sayLife(eleni, cat.id, { status, reason: "x" })).status, String(status)).toBe(400);
    }
    expect((await sayLife(eleni, cat.id, { status: "homed" })).status).toBe(400);
    expect((await sayLife(eleni, cat.id, { status: "homed", reason: "   " })).status).toBe(400);
    expect((await rowsOf(cat.id)).length).toBe(before);
  });
});

describe("T28 and T29c: putting back her own change, the revival, and the 30-day flag", () => {
  it("she can put back her own change within 30 days, to the status it replaced", async () => {
    const cat = await seedCat(colonyA);
    await post(team, "/api/team/observations", {
      catId: cat.id,
      kind: "life_status",
      value: { status: "in_care" },
      reason: "At the clinic",
    });
    const hers = (await sayLife(eleni, cat.id, { status: "deceased", reason: "Found her" })).body
      .statementId as number;
    const mine = (await get(eleni, `/api/team/my/cats/${cat.id}`)).body.mine;
    expect(mine.putBack).toEqual({ statementId: hers, status: "deceased", putsBack: "in_care" });
    const res = await sayLife(eleni, cat.id, { putBack: hers });
    expect(res.status).toBe(201);
    const back = await rowById(res.body.statementId);
    expect(back).toMatchObject({
      supersedesId: hers,
      value: { status: "in_care" },
      supersedeReason: PUT_BACK_REASON,
      roleAtTime: "guardian",
    });
    // Dated as hers was, so the cat gains no new "seen alive" date.
    expect(back.observedAt.getTime()).toBe((await rowById(hers)).observedAt.getTime());
    expect((await get(eleni, `/api/team/my/cats/${cat.id}`)).body.cat.lifeStatus).toBe("in_care");
    // A second press finds nothing left to put back.
    expect((await sayLife(eleni, cat.id, { putBack: hers })).status).toBe(409);
  });

  it("not after 30 days", async () => {
    const cat = await seedCat(colonyA);
    const hers = (await sayLife(eleni, cat.id, { status: "homed", reason: "Adopted" })).body
      .statementId as number;
    const later = new Date(Date.now() + 31 * DAY);
    await expect(guardianPutsBack(await personOf(eleni), cat.id, hers, later)).rejects.toMatchObject({
      code: "NOT_YOUR_ROW",
    });
    expect((await myStatementsOnCat(eleni.id, cat.id, later)).putBack).toBeNull();
    // Still fine on day 29.
    expect(
      (await myStatementsOnCat(eleni.id, cat.id, new Date(Date.now() + 29 * DAY))).putBack?.statementId,
    ).toBe(hers);
  });

  it("not someone else's change, and not once someone has said something newer", async () => {
    const cat = await seedCat(colonyA);
    const dims = (await sayLife(dimitra, cat.id, { status: "homed", reason: "Adopted" })).body
      .statementId as number;
    expect((await sayLife(eleni, cat.id, { putBack: dims })).status).toBe(409);
    expect((await get(eleni, `/api/team/my/cats/${cat.id}`)).body.mine.putBack).toBeNull();
    const hers = (await sayLife(eleni, cat.id, { status: "in_care", reason: "Clinic" })).body
      .statementId as number;
    await post(team, "/api/team/observations", {
      catId: cat.id,
      kind: "life_status",
      value: { status: "street" },
      reason: "Seen out again",
    });
    expect((await sayLife(eleni, cat.id, { putBack: hers })).status).toBe(409);
    expect((await rowsOf(cat.id)).filter((o) => o.supersedesId === hers)).toEqual([]);
  });

  it("a later sighting revives a cat she marked deceased", async () => {
    const cat = await seedCat(colonyA);
    await sayLife(eleni, cat.id, { status: "deceased", reason: "Found her" });
    expect((await get(eleni, `/api/team/my/cats/${cat.id}`)).body.cat.lifeStatus).toBe("deceased");
    const [p] = await db
      .insert(photosTable)
      .values({ data: Buffer.from("fake-jpeg").toString("base64"), mime: "image/jpeg" })
      .returning({ id: photosTable.id });
    await db.insert(sightingsTable).values({
      catId: cat.id,
      deviceId: `vt-gstat-spotter-${RUN}`,
      photoId: p!.id,
      lat: 37.44,
      lng: 24.94,
      status: "resolved",
      createdAt: new Date(Date.now() + 60_000),
    });
    expect((await get(eleni, `/api/team/my/cats/${cat.id}`)).body.cat.lifeStatus).toBe("street");
  });

  it("a cat she marked homed or deceased is flagged on the team's page for 30 days", async () => {
    for (const status of ["homed", "deceased"] as const) {
      const cat = await seedCat(colonyA);
      const hers = (await sayLife(eleni, cat.id, { status, reason: "Seen it" })).body.statementId;
      const view = await get(team, `/api/team/cats/${cat.id}`);
      expect(view.body.recentGuardianMark).toMatchObject({ statementId: hers, status });
      const html = (await request(app).get(`/api/team/cats/${cat.id}`).set("Cookie", team.cookie)).text;
      expect(html).toContain(`Recently marked ${status === "homed" ? "homed" : "as no longer with us"} by the cat guardian`);
      const rows = await rowsOf(cat.id);
      expect(recentGuardianMark(rows, new Date(Date.now() + 29 * DAY))?.id).toBe(hers);
      expect(recentGuardianMark(rows, new Date(Date.now() + 31 * DAY))).toBeNull();
    }
    // In care is not flagged.
    const cat = await seedCat(colonyA);
    await sayLife(eleni, cat.id, { status: "in_care", reason: "Clinic" });
    expect((await get(team, `/api/team/cats/${cat.id}`)).body.recentGuardianMark).toBeNull();
  });
});

describe("a guardian can't supersede the team's statement or another guardian's", () => {
  it("writeObservation refuses it; her own row she may", async () => {
    const cat = await seedCat(colonyA);
    const teamRow = (await post(team, "/api/team/observations", {
      catId: cat.id,
      kind: "sterilised",
      value: { sterilised: true },
      reason: "Clinic record",
    })).body.id as number;
    const dims = (await sayStr(dimitra, cat.id, { sterilised: "yes" })).body.statementId as number;
    const hers = (await sayStr(eleni, cat.id, { sterilised: "no" })).body.statementId as number;
    const as = (supersedesId: number) =>
      db.transaction((tx) =>
        writeObservation(tx, {
          catId: cat.id,
          kind: "sterilised",
          value: { sterilised: false },
          accountId: eleni.id,
          roleAtTime: "guardian",
          authorityScope: `colony:${colonyA}`,
          observedAt: new Date(),
          supersedesId,
          supersedeReason: "mine",
        }),
      );
    await expect(as(teamRow)).rejects.toMatchObject({ code: "NOT_YOUR_ROW" });
    await expect(as(dims)).rejects.toBeInstanceOf(ObservationRefused);
    await expect(as(dims)).rejects.toMatchObject({ code: "NOT_YOUR_ROW" });
    const own = await as(hers);
    expect(own.supersedesId).toBe(hers);
  });

  it("SYC-316: nobody marks someone else's lower-ranked statement with standing wrong (an owner over the team's)", async () => {
    // Probe: drop the rank rule in writeObservation → red.
    const cat = await seedCat(colonyA);
    const teamRow = (await post(team, "/api/team/observations", {
      catId: cat.id,
      kind: "life_status",
      value: { status: "in_care" },
      reason: "At the clinic",
    })).body.id as number;
    await expect(
      db.transaction((tx) =>
        writeObservation(tx, {
          catId: cat.id,
          kind: "life_status",
          value: { status: "homed" },
          deviceId: `vt-gstat-owner-${RUN}`,
          roleAtTime: "public",
          authorityScope: "owner_of_this_cat",
          observedAt: new Date(),
          supersedesId: teamRow,
          supersedeReason: "She lives with me",
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_YOUR_ROW" });
    // The other way round is the point of superseding: the team marks a
    // higher-ranked statement (hers) wrong.
    const hers = (await sayLife(eleni, cat.id, { status: "homed", reason: "Adopted" })).body.statementId;
    const res = await post(team, `/api/team/observations/${hers}/supersede`, {
      value: { status: "street" },
      reason: "Seen out again",
    });
    expect(res.status).toBe(201);
  });

  it("the team's supersede route refuses her: it is the team's (island-only)", async () => {
    const cat = await seedCat(colonyA);
    const teamRow = (await post(team, "/api/team/observations", {
      catId: cat.id,
      kind: "sterilised",
      value: { sterilised: true },
      reason: "Clinic record",
    })).body.id as number;
    const res = await post(eleni, `/api/team/observations/${teamRow}/supersede`, {
      value: { sterilised: false },
      reason: "No",
    });
    expect(res.status).toBe(403);
    expect((await rowsOf(cat.id)).filter((o) => o.supersedesId === teamRow)).toEqual([]);
  });
});

describe("her page's `mine` block: her own statements only", () => {
  /** Pinned, never imported: a new field turns this red until someone decides it belongs. */
  const MINE_FIELDS = ["lookedAgain", "putBack"];
  const PUT_BACK_FIELDS = ["putsBack", "statementId", "status"];
  const LOOKED_AGAIN_FIELDS = ["at", "kind", "now"];

  it("carries exactly these fields, and never another person's statement, name or id", async () => {
    const cat = await seedCat(colonyA);
    const dims = (await sayLife(dimitra, cat.id, { status: "in_care", reason: "Dimitra took her" })).body
      .statementId as number;
    const teamRow = (await post(team, "/api/team/observations", {
      catId: cat.id,
      kind: "sterilised",
      value: { sterilised: true },
      reason: "Team clinic record vt-secret",
    })).body.id as number;
    const hersSter = (await sayStr(eleni, cat.id, { sterilised: "no" })).body.statementId as number;
    await post(team, `/api/team/observations/${hersSter}/supersede`, {
      value: { sterilised: true },
      reason: "Team looked again vt-secret",
    });
    // The team also looks again at Dimitra's: that is hers to hear, not Eleni's.
    await post(team, `/api/team/observations/${dims}/supersede`, {
      value: { status: "street" },
      reason: "Back on the street vt-secret",
    });
    const hers = (await sayLife(eleni, cat.id, { status: "homed", reason: "Adopted" })).body
      .statementId as number;
    const body = (await get(eleni, `/api/team/my/cats/${cat.id}`)).body;
    // Probe: drop the author filter on her statements → red.
    expect(body.mine.lookedAgain).toEqual([{ kind: "sterilised", now: true, at: expect.any(String) }]);
    expect(Object.keys(body.mine).sort()).toEqual(MINE_FIELDS);
    expect(Object.keys(body.mine.putBack).sort()).toEqual(PUT_BACK_FIELDS);
    expect(body.mine.putBack.statementId).toBe(hers);
    for (const l of body.mine.lookedAgain) expect(Object.keys(l).sort()).toEqual(LOOKED_AGAIN_FIELDS);
    const text = JSON.stringify(body.mine);
    for (const leak of [String(dims), String(teamRow), dimitra.id, team.id, "Vt gstat-dimitra", "Vt gstat-team", "vt-secret", "Dimitra took her"]) {
      expect(text).not.toContain(leak);
    }
    // Another guardian on the same colony sees her own `mine`, not Eleni's.
    const dimsMine = (await get(dimitra, `/api/team/my/cats/${cat.id}`)).body.mine;
    expect(JSON.stringify(dimsMine)).not.toContain(String(hers));
  });

  it("the public view of a cat outside her colonies has no `mine`", async () => {
    const theirs = await seedCat(colonyB);
    const body = (await get(eleni, `/api/team/my/cats/${theirs.id}`)).body;
    expect(body.view).toBe("public");
    expect(body.mine).toBeUndefined();
  });
});

describe("what the team sees of her word (T12g-6's page half)", () => {
  it("'Confirmed by Eleni, cat guardian' with This is wrong, and the team's own record under 'Says otherwise'", async () => {
    const cat = await seedCat(colonyA);
    const teamRow = (await post(team, "/api/team/observations", {
      catId: cat.id,
      kind: "sterilised",
      value: { sterilised: false },
      reason: "Old clinic list",
    })).body.id as number;
    // Hers is newer than the team's "no", so (SYC-315 B) the team's is set
    // aside; for a disagreement the team sees, hers must be the older "yes"
    // ranked over a newer team "no".
    const hers = (await sayStr(eleni, cat.id, { sterilised: "yes" })).body.statementId as number;
    const teamNo = (await post(team, "/api/team/observations", {
      catId: cat.id,
      kind: "sterilised",
      value: { sterilised: false },
      reason: "Newer team note",
    })).body.id as number;
    const view = (await get(team, `/api/team/cats/${cat.id}`)).body;
    expect(view.records.sterilised.value).toBe(true);
    expect(view.records.sterilised.supportingStatementIds).toEqual([hers]);
    expect(view.records.sterilised.conflictingStatementIds).toEqual([teamNo]);
    expect(view.records.sterilised.conflictingStatementIds).not.toContain(teamRow);
    const html = (await request(app).get(`/api/team/cats/${cat.id}`).set("Cookie", team.cookie)).text;
    expect(html).toContain("Confirmed by");
    expect(html).toContain("Vt gstat-eleni, cat guardian");
    expect(html).toContain(`href="#s-${hers}">This is wrong?</a>`);
    expect(html).toContain("Says otherwise");
  });
});
