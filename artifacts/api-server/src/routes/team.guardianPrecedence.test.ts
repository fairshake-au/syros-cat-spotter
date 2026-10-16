import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createColonyWithPlacement, db, markLeft, observationsTable, pool } from "@workspace/db";
import { findPersonById } from "@workspace/db";
import app from "../app";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { writeObservation } from "../lib/observations";
import { correctAppearance } from "../lib/teamCorrections";
import { listGuardianChanges, type GuardianChange } from "../lib/guardianChanges";
import { removeTestPerson } from "../test/removeTestPerson";
import { guardianOn, newColony, RUN, seedCat, signedPerson, type Signed } from "../test/roleKit";

// SYC-53 PR 2.2: who wins (Decision G, as amended by SYC-315 option B), each
// edge through the REAL routes and the REAL resolver (the team's cat page
// reads resolveSterilised). Vets and owners have no writer yet (SYC-24,
// SYC-130), so their rows are fixtures inserted straight into the table, as
// a future vet's or owner's route would write them.
//
// T12g-1 vet vs guardian · T12g-2 guardian vs team (2a: her older word beats
// a newer team "no"; 2b, SYC-315 B: a newer team "sterilised" beats her older
// "isn't") · T12g-3 owner vs team, vet vs owner · T12g-4 owner beats guardian
// both ways round · T12g-5 same-level newest, ties to the later row · T12g-6
// the contradiction list. T12g-7 (life status by rank) is NOT built: life
// status stays newest-wins until SYC-130 (Samuel, 14 Oct 2026).

const KEY = "vitest-gprec-key-0123456789abcdef-0123456789ab";
const JSON_ACCEPT = { Accept: "application/json" };
const MIN = 60_000;

let colony: number;
let eleni: Signed;
let dimitra: Signed;
let team: Signed;
let mgmt: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  colony = await newColony("gprec");
  eleni = await guardianOn("gprec-eleni", [colony]);
  dimitra = await guardianOn("gprec-dimitra", [colony]);
  team = await signedPerson("gprec-team", ["staff"]);
  // Management can't be given on adding (PR 0.3): added as staff, then made
  // management, as the route walk does.
  mgmt = await signedPerson("gprec-mgmt", ["staff"]);
  await pool.query("update person_scopes set role = 'management' where person_id = $1", [mgmt.id]);
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
});

afterAll(async () => {
  for (const p of [eleni, dimitra, team, mgmt]) {
    if (!p) continue;
    await removeTestPerson(p.email).catch(() => markLeft(p.email, "cli:vitest").catch(() => {}));
  }
});

const post = (who: Signed, path: string, body: Record<string, unknown>) =>
  request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", who.cookie).set(JSON_ACCEPT).send(body);

/** Her one tap, through her route. */
async function guardianSays(who: Signed, catId: number, yes: boolean): Promise<number> {
  const res = await post(who, `/api/team/my/cats/${catId}/sterilisation`, { sterilised: yes ? "yes" : "no" });
  expect(res.status).toBe(201);
  return res.body.statementId;
}

/** The team's statement, through the team's JSON route. */
async function teamSays(who: Signed, catId: number, yes: boolean): Promise<number> {
  const res = await post(who, "/api/team/observations", {
    catId,
    kind: "sterilised",
    value: { sterilised: yes },
    reason: "From the clinic list",
  });
  expect(res.status).toBe(201);
  return res.body.id;
}

/** A vet's or an owner's row, as their future routes would write it. */
async function fixture(
  catId: number,
  who: "vet" | "owner",
  yes: boolean,
  observedAt: Date,
): Promise<number> {
  const [row] = await db
    .insert(observationsTable)
    .values({
      catId,
      kind: "sterilised",
      value: { sterilised: yes },
      ...(who === "vet"
        ? { accountId: `vt-gprec-vet-${RUN}`, roleAtTime: "vet", authorityScope: "none" }
        : { deviceId: `vt-gprec-owner-${RUN}`, roleAtTime: "public", authorityScope: "owner_of_this_cat" }),
      provenance: "volunteered",
      observedAt,
    })
    .returning({ id: observationsTable.id });
  return row!.id;
}

/** The team cat page's answer: the real resolver. */
async function answer(catId: number) {
  const res = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", team.cookie).set(JSON_ACCEPT);
  expect(res.status).toBe(200);
  const s = res.body.records.sterilised;
  return { value: s.value as boolean | null, confidence: s.confidence, by: s.supportingStatementIds as number[] };
}

const ago = (m: number) => new Date(Date.now() - m * MIN);

describe("T12g-1 vet vs guardian", () => {
  it("a guardian's 'isn't' newer than a vet's 'sterilised' leaves it Confirmed sterilised", async () => {
    // Probe: rank the guardian equal to the vet → red.
    const cat = await seedCat(colony);
    const vet = await fixture(cat.id, "vet", true, ago(60));
    await guardianSays(eleni, cat.id, false);
    expect(await answer(cat.id)).toEqual({ value: true, confidence: "confirmed", by: [vet] });
  });
});

describe("T12g-2 guardian vs team", () => {
  it("2a: her older 'sterilised' beats a newer team 'not sterilised' (the team marks hers wrong instead)", async () => {
    // Probe: plain newest-wins → red.
    const cat = await seedCat(colony);
    const hers = await guardianSays(eleni, cat.id, true);
    await teamSays(team, cat.id, false);
    await teamSays(mgmt, cat.id, false);
    expect(await answer(cat.id)).toEqual({ value: true, confidence: "confirmed", by: [hers] });
  });

  it("2a: her 'isn't' after a team 'sterilised' wins", async () => {
    const cat = await seedCat(colony);
    await teamSays(team, cat.id, true);
    const hers = await guardianSays(eleni, cat.id, false);
    expect(await answer(cat.id)).toEqual({ value: false, confidence: "confirmed", by: [hers] });
  });

  it("2b (SYC-315 B, changed from the plan): a NEWER team 'sterilised' then flips it back", async () => {
    // The plan said "a newer team sterilised does not flip it"; Samuel's
    // option B (16 Oct 2026) says a newer "sterilised" always wins.
    // Probe: drop the newer-sterilised rule → red.
    const cat = await seedCat(colony);
    await teamSays(team, cat.id, true);
    await guardianSays(eleni, cat.id, false);
    const newer = await teamSays(mgmt, cat.id, true);
    expect(await answer(cat.id)).toEqual({ value: true, confidence: "confirmed", by: [newer] });
  });
});

describe("T12g-3 owner vs team, and vet vs owner", () => {
  it("an owner's statement beats a newer team one", async () => {
    // Probe: owner at level 1 → red.
    const cat = await seedCat(colony);
    const owner = await fixture(cat.id, "owner", true, ago(60));
    await teamSays(team, cat.id, false);
    expect(await answer(cat.id)).toEqual({ value: true, confidence: "confirmed", by: [owner] });
  });

  it("a vet's beats a newer owner one", async () => {
    // Probe: owner at level 4 → red.
    const cat = await seedCat(colony);
    const vet = await fixture(cat.id, "vet", true, ago(60));
    await fixture(cat.id, "owner", false, ago(30));
    expect(await answer(cat.id)).toEqual({ value: true, confidence: "confirmed", by: [vet] });
  });
});

describe("T12g-4 owner beats guardian, both ways round in time", () => {
  it("an owner's statement OLDER than a guardian's still wins", async () => {
    // Probes: make them the same level, or let the guardian win → red.
    const cat = await seedCat(colony);
    const owner = await fixture(cat.id, "owner", true, ago(60));
    await guardianSays(eleni, cat.id, false);
    expect(await answer(cat.id)).toEqual({ value: true, confidence: "confirmed", by: [owner] });
  });

  it("an owner's statement NEWER than a guardian's wins too", async () => {
    const cat = await seedCat(colony);
    await guardianSays(eleni, cat.id, true);
    const owner = await fixture(cat.id, "owner", false, new Date(Date.now() + MIN));
    expect(await answer(cat.id)).toEqual({ value: false, confidence: "confirmed", by: [owner] });
  });
});

describe("T12g-5 same level: the newest wins, an exact tie goes to the later row", () => {
  it("two guardians", async () => {
    // Probe: oldest wins → red.
    const cat = await seedCat(colony);
    await guardianSays(eleni, cat.id, true);
    const newer = await guardianSays(dimitra, cat.id, false);
    expect(await answer(cat.id)).toEqual({ value: false, confidence: "confirmed", by: [newer] });
  });

  it("two owners", async () => {
    const cat = await seedCat(colony);
    await fixture(cat.id, "owner", true, ago(60));
    const newer = await fixture(cat.id, "owner", false, ago(30));
    expect(await answer(cat.id)).toEqual({ value: false, confidence: "confirmed", by: [newer] });
  });

  it("two team members", async () => {
    const cat = await seedCat(colony);
    await teamSays(team, cat.id, true);
    const newer = await teamSays(mgmt, cat.id, false);
    expect(await answer(cat.id)).toEqual({ value: false, confidence: "confirmed", by: [newer] });
  });

  it("an exact tie goes to the later row, whichever way it points", async () => {
    const at = ago(10);
    for (const [first, second] of [[true, false], [false, true]] as const) {
      const cat = await seedCat(colony);
      await fixture(cat.id, "owner", first, at);
      const later = await fixture(cat.id, "owner", second, at);
      expect(await answer(cat.id)).toEqual({ value: second, confidence: "confirmed", by: [later] });
    }
  });
});

describe("T12g-6 the contradiction list (listGuardianChanges)", () => {
  const statementEntry = (list: GuardianChange[], id: number) =>
    list.find((c) => c.type === "statement" && c.statementId === id) as Extract<GuardianChange, { type: "statement" }> | undefined;

  it("her statement against a team record that stands is flagged; one that agrees is not", async () => {
    // Probe: drop the flag → red.
    const cat = await seedCat(colony);
    await teamSays(team, cat.id, true);
    const against = await guardianSays(eleni, cat.id, false);
    const agrees = await seedCat(colony);
    await teamSays(team, agrees.id, true);
    const same = await guardianSays(eleni, agrees.id, true);
    const list = await listGuardianChanges();
    expect(statementEntry(list, against)).toMatchObject({
      kind: "sterilised",
      contradictsTeam: true,
      standing: true,
      colonyId: colony,
      guardian: { id: eleni.id, name: "Vt gprec-eleni" },
      cat: { id: cat.id },
    });
    expect(statementEntry(list, same)).toMatchObject({ contradictsTeam: false, standing: true });
  });

  it("the team marking hers wrong appears as an overrule, with the reason, and hers no longer stands", async () => {
    const cat = await seedCat(colony);
    const hers = await guardianSays(eleni, cat.id, true);
    const wrong = await post(team, `/api/team/observations/${hers}/supersede`, {
      value: { sterilised: false },
      reason: "Clinic says not yet",
    });
    expect(wrong.status).toBe(201);
    const list = await listGuardianChanges();
    expect(list.find((c) => c.type === "overruled" && c.statementId === wrong.body.id)).toMatchObject({
      overruledId: hers,
      kind: "sterilised",
      reason: "Clinic says not yet",
      by: { id: team.id },
      guardian: { id: eleni.id },
    });
    expect(statementEntry(list, hers)).toMatchObject({ standing: false, contradictsTeam: false });
  });

  it("a team Correct on her colour shows as an overrule with its reason (SYC-2's hand-off)", async () => {
    const cat = await seedCat(colony);
    const hersCoat = await db.transaction((tx) =>
      writeObservation(tx, {
        catId: cat.id,
        kind: "coat",
        value: { colours: ["ginger"] },
        accountId: eleni.id,
        roleAtTime: "guardian",
        authorityScope: `colony:${colony}`,
        observedAt: new Date(),
      }),
    );
    const out = await correctAppearance((await findPersonById(team.id))!, {
      catId: cat.id,
      kind: "coat",
      codes: ["tabby"],
      reason: "Photo shows a tabby",
    });
    expect(out.kind).toBe("corrected");
    const list = await listGuardianChanges();
    expect(list.find((c) => c.type === "overruled" && c.overruledId === hersCoat.id)).toMatchObject({
      kind: "coat",
      reason: "Photo shows a tabby",
      by: { id: team.id },
    });
  });

  it("a colony a guardian created appears, with her", async () => {
    const made = await createColonyWithPlacement({ id: eleni.id }, { name: `vt-gprec made ${RUN}` });
    expect(made.placed).toBe(true);
    const list = await listGuardianChanges();
    expect(list.find((c) => c.type === "colony_created" && c.colonyId === made.colonyId)).toMatchObject({
      guardian: { id: eleni.id },
      colony: { id: made.colonyId, name: `vt-gprec made ${RUN}` },
    });
  });

  it("is newest first", async () => {
    const list = await listGuardianChanges();
    const ats = list.map((c) => c.at);
    expect([...ats].sort().reverse()).toEqual(ats);
  });
});
