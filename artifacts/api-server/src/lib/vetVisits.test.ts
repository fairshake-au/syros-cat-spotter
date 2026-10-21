import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { db, pool, catsTable, observationsTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { commitStatement } from "./commitStatement";
import { loadCatRecords, ObservationRefused, type VetVisitValue } from "./observations";
import { resolveSterilised, resolveVaccinated } from "./resolve";
import { listGuardianChanges } from "./guardianChanges";
import { ALREADY_UNDONE, logVetVisit, undoVetVisit, visitsFor } from "./vetVisits";

// SYC-396 PR 3.1a, Task 3.1.1 (team-dashboard-redesign.md §8.3; plan
// Decisions 5–7 and D8): writing a visit and undoing it, against the shared
// test database. observations is append-only, so every assertion is on this
// run's own fresh cats.

// Today every team member holds every capability, so `can` is wrapped:
// `denied.cap` is refused to everyone (the team.corrections.test.ts pattern).
const denied = vi.hoisted(() => ({ cap: null as string | null }));
vi.mock("./capabilities", async (importOriginal) => {
  const real = await importOriginal<typeof import("./capabilities")>();
  return {
    ...real,
    can: (...args: Parameters<typeof real.can>) => (args[1] === denied.cap ? false : real.can(...args)),
  };
});

// The rollback proof: the write of `failOn.kind` throws, mid-transaction.
const failOn = vi.hoisted(() => ({ kind: null as string | null }));
vi.mock("./commitStatement", async (importOriginal) => {
  const real = await importOriginal<typeof import("./commitStatement")>();
  return {
    ...real,
    commitStatement: (...args: Parameters<typeof real.commitStatement>) => {
      if (args[1].kind === failOn.kind) throw new Error("vitest: this write fails");
      return real.commitStatement(...args);
    },
  };
});

const RUN = randomBytes(3).toString("hex");
const NAME_PREFIX = `VitestVetVisits${RUN}`;
let n = 0;

const STAFF = { id: `vitest-vv-staff-${RUN}`, scopes: [{ role: "staff", colonyId: null }] };
const GUARDIAN = { id: `vitest-vv-guardian-${RUN}`, scopes: [{ role: "guardian", colonyId: 1 }] };
const NOW = new Date("2026-10-21T10:00:00Z");

async function cleanup() {
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}

beforeAll(cleanup);
beforeEach(() => {
  denied.cap = null;
  failOn.kind = null;
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function insertCat() {
  n += 1;
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}-${n}`,
      description: "",
      primaryPhotoId: 0,
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: "vitest-vv-discoverer",
    })
    .returning();
  return cat!.id;
}

/** A cat guardian's standing "not sterilised", dated `day`. */
async function guardianSaysNo(catId: number, day: string, who = GUARDIAN.id) {
  return db.transaction((tx) =>
    commitStatement(
      tx,
      {
        catId,
        kind: "sterilised",
        value: { sterilised: false },
        accountId: who,
        roleAtTime: "guardian",
        authorityScope: "colony:1",
        observedAt: new Date(`${day}T12:00:00Z`),
      },
      [],
      NOW,
    ),
  );
}

const rowsFor = (catId: number) =>
  db.select().from(observationsTable).where(eq(observationsTable.catId, catId));

async function sterilisedOf(catId: number) {
  const record = (await loadCatRecords([catId])).get(catId);
  return resolveSterilised(record?.observations ?? [], []);
}
async function vaccinationsOf(catId: number) {
  const record = (await loadCatRecords([catId])).get(catId);
  return resolveVaccinated(record?.observations ?? []);
}

const STERILISED: VetVisitValue = { did: ["sterilised"], clinicId: "symviosis", costEur: 60, paidBy: "syros_cats" };
const BOTH: VetVisitValue = {
  did: ["sterilised", "vaccinated"],
  vaccines: ["rabies"],
  clinicId: "symviosis",
  costEur: 75,
  paidBy: "donation",
  note: "Calm in the carrier",
  costReason: "Pregnant, longer surgery",
};

async function refusal(p: Promise<unknown>): Promise<ObservationRefused> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ObservationRefused) return err;
    throw err;
  }
  throw new Error("expected a refusal");
}

describe("logVetVisit", () => {
  it("a visit with Sterilised makes the cat sterilised / confirmed, dated to the visit, with the clinic", async () => {
    const catId = await insertCat();
    const saved = await logVetVisit(STAFF, { catId, date: "2026-08-13", value: STERILISED }, NOW);
    expect(saved.sterilisedIds).toHaveLength(1);
    expect(saved.overruled).toEqual([]);

    const answer = await sterilisedOf(catId);
    expect(answer.value).toBe(true);
    expect(answer.confidence).toBe("confirmed");
    expect(answer.asOf.slice(0, 10)).toBe("2026-08-13");

    const [row] = (await rowsFor(catId)).filter((o) => o.id === saved.sterilisedIds[0]);
    expect(row!.value).toMatchObject({ sterilised: true, clinic: expect.any(String), vetVisitId: saved.visitId });
    expect((row!.value as { clinic: string }).clinic.length).toBeGreaterThan(0);
    expect(row!.observedAt.toISOString().slice(0, 10)).toBe("2026-08-13");
  });

  it("Sterilised and Vaccinated write three rows in one transaction", async () => {
    const catId = await insertCat();
    const saved = await logVetVisit(STAFF, { catId, date: "2026-08-13", value: BOTH }, NOW);
    const rows = await rowsFor(catId);
    expect(rows.map((o) => o.kind).sort()).toEqual(["sterilised", "vaccinated", "vet_visit"]);
    expect(saved.vaccinatedId).not.toBeNull();
    expect((await vaccinationsOf(catId)).map((v) => v.vaccines)).toEqual([["rabies"]]);
  });

  it("if the third write fails, no row remains (rollback)", async () => {
    const catId = await insertCat();
    failOn.kind = "vaccinated";
    await expect(logVetVisit(STAFF, { catId, date: "2026-08-13", value: BOTH }, NOW)).rejects.toThrow(
      "vitest: this write fails",
    );
    expect(await rowsFor(catId)).toEqual([]);
  });

  it("D8: a visit dated BEFORE the guardian's standing 'no' still overrules it, visibly", async () => {
    const catId = await insertCat();
    const no = await guardianSaysNo(catId, "2026-08-20");
    expect((await sterilisedOf(catId)).value).toBe(false);

    const saved = await logVetVisit(STAFF, { catId, date: "2026-08-13", value: STERILISED }, NOW);
    // Without D8 her "no" would still win: it outranks the team and is newer.
    const answer = await sterilisedOf(catId);
    expect(answer.value).toBe(true);
    expect(answer.confidence).toBe("confirmed");
    expect(saved.overruled).toEqual([no.id]);
    expect(saved.sterilisedIds).toHaveLength(1);

    const changes = await listGuardianChanges({ limit: 1000 });
    const entry = changes.find((c) => c.type === "overruled" && c.overruledId === no.id);
    expect(entry).toMatchObject({ type: "overruled", reason: "vet visit on 13 Aug 2026", putBack: false });
  });

  it("with two guardians' standing 'no', both are overruled", async () => {
    const catId = await insertCat();
    const a = await guardianSaysNo(catId, "2026-08-20");
    const b = await guardianSaysNo(catId, "2026-08-21", `vitest-vv-guardian2-${RUN}`);
    const saved = await logVetVisit(STAFF, { catId, date: "2026-08-13", value: STERILISED }, NOW);
    expect(saved.sterilisedIds).toHaveLength(2);
    expect([...saved.overruled].sort()).toEqual([a.id, b.id].sort());
    expect((await sterilisedOf(catId)).value).toBe(true);
  });

  it("ticking Vaccinated without set_vaccination is refused, and nothing is written", async () => {
    const catId = await insertCat();
    denied.cap = "set_vaccination";
    expect((await refusal(logVetVisit(STAFF, { catId, date: "2026-08-13", value: BOTH }, NOW))).code).toBe(
      "NOT_AUTHORISED",
    );
    expect(await rowsFor(catId)).toEqual([]);
  });

  it("a cat guardian can't log a visit (log_vet_visit is island-only)", async () => {
    const catId = await insertCat();
    expect((await refusal(logVetVisit(GUARDIAN, { catId, date: "2026-08-13", value: STERILISED }, NOW))).code).toBe(
      "NOT_AUTHORISED",
    );
    expect(await rowsFor(catId)).toEqual([]);
  });

  it("a visit dated in the future is refused", async () => {
    const catId = await insertCat();
    expect((await refusal(logVetVisit(STAFF, { catId, date: "2026-10-22", value: STERILISED }, NOW))).code).toBe(
      "FUTURE_OBSERVED_AT",
    );
    expect(await rowsFor(catId)).toEqual([]);
  });
});

describe("undoVetVisit", () => {
  it("brings back the guardian's 'no', takes the vaccination away, and drops the visit from the list", async () => {
    const catId = await insertCat();
    await guardianSaysNo(catId, "2026-08-20");
    const saved = await logVetVisit(STAFF, { catId, date: "2026-08-13", value: BOTH }, NOW);
    expect((await sterilisedOf(catId)).value).toBe(true);
    expect(await vaccinationsOf(catId)).toHaveLength(1);
    expect(await visitsFor(catId, { costs: true })).toHaveLength(1);

    const { retracted } = await undoVetVisit(STAFF, saved.visitId, "Wrong cat", NOW);

    expect(await vaccinationsOf(catId)).toEqual([]);
    const answer = await sterilisedOf(catId);
    expect(answer.value).toBe(false);
    expect(await visitsFor(catId, { costs: true })).toEqual([]);
    // The visit and both of its statements, all retracted together.
    expect(retracted).toHaveLength(3);

    const changes = await listGuardianChanges({ limit: 1000 });
    const entry = changes.find((c) => c.type === "overruled" && c.statementId === saved.sterilisedIds[0]);
    expect(entry).toMatchObject({ putBack: true });
  });

  it("undoing twice is refused, and the second attempt writes nothing", async () => {
    const catId = await insertCat();
    const saved = await logVetVisit(STAFF, { catId, date: "2026-08-13", value: BOTH }, NOW);
    await undoVetVisit(STAFF, saved.visitId, "Wrong cat", NOW);
    const before = (await rowsFor(catId)).length;
    const err = await refusal(undoVetVisit(STAFF, saved.visitId, "Again", NOW));
    expect(err.code).toBe("ALREADY_SUPERSEDED");
    expect(err.message).toBe(ALREADY_UNDONE);
    expect((await rowsFor(catId)).length).toBe(before);
  });

  it("a cat guardian can't undo a visit", async () => {
    const catId = await insertCat();
    const saved = await logVetVisit(STAFF, { catId, date: "2026-08-13", value: STERILISED }, NOW);
    expect((await refusal(undoVetVisit(GUARDIAN, saved.visitId, "No", NOW))).code).toBe("NOT_AUTHORISED");
    expect((await sterilisedOf(catId)).value).toBe(true);
  });
});

describe("visitsFor", () => {
  it("without costs, the lines have no costEur and no paidBy keys at all", async () => {
    const catId = await insertCat();
    await logVetVisit(STAFF, { catId, date: "2026-08-13", value: BOTH }, NOW);
    const [hidden] = await visitsFor(catId, { costs: false });
    expect(hidden).toBeDefined();
    expect("costEur" in hidden!).toBe(false);
    expect("paidBy" in hidden!).toBe(false);
    expect("costReason" in hidden!).toBe(false);
    expect(hidden).toMatchObject({ did: ["sterilised", "vaccinated"], note: "Calm in the carrier" });

    const [shown] = await visitsFor(catId, { costs: true });
    expect(shown).toMatchObject({ costEur: 75, paidBy: "donation", costReason: "Pregnant, longer surgery" });
  });

  it("lists visits newest first", async () => {
    const catId = await insertCat();
    const older = await logVetVisit(STAFF, { catId, date: "2026-08-13", value: STERILISED }, NOW);
    const newer = await logVetVisit(
      STAFF,
      { catId, date: "2026-09-02", value: { did: ["checked"], clinicId: "symviosis", costEur: null, paidBy: "owner" } },
      NOW,
    );
    expect((await visitsFor(catId, { costs: false })).map((v) => v.visitId)).toEqual([newer.visitId, older.visitId]);
  });
});
