import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { catsTable, db, observationsTable, pool, type Observation } from "@workspace/db";
import { like } from "drizzle-orm";
import type { VetVisitValue } from "../observations";
import { logVetVisit, undoVetVisit } from "../vetVisits";
import { vetSpend } from "../dashboard/home";
import { parseRange, type Range } from "./range";
import { purposeOf, vetCostsFrom, vetCostsReport, type VetCostsReport } from "./vetCosts";

// SYC-396 PR 3.3c, Task 3.3c.1 (spec §8.4, §9.3 report 5; plan Decision 14):
// the vet report. Visits are written and undone with the real writer, so the
// report reads exactly what the cat page reads. The database is shared and
// never truncated: each test has its own month in 2004, where only this file
// writes, and asserts on its own cats or on what its own rows changed.

const RUN = randomBytes(3).toString("hex");
const NAME_PREFIX = `VitestVetCosts${RUN}`;
let n = 0;

const STAFF = { id: `vitest-vc-staff-${RUN}`, scopes: [{ role: "staff", colonyId: null }] };
const NOW = new Date("2026-10-21T10:00:00Z");

async function cleanup() {
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function insertCat() {
  n += 1;
  const [cat] = await db
    .insert(catsTable)
    .values({ name: `${NAME_PREFIX}-${n}`, description: "", primaryPhotoId: 0, lat: 37.44, lng: 24.9, discovererDeviceId: "vitest-vc" })
    .returning();
  return cat!.id;
}

/** One calendar month of 2004, as the page asks for it. */
const month = (m: number): Range => {
  const mm = String(m).padStart(2, "0");
  const last = new Date(Date.UTC(2004, m, 0)).getUTCDate();
  return parseRange({ range: "custom", from: `2004-${mm}-01`, to: `2004-${mm}-${last}` }, NOW);
};

const visit = (did: VetVisitValue["did"], o: Partial<VetVisitValue> = {}): VetVisitValue => ({
  did,
  clinicId: "symviosis",
  costEur: 60,
  paidBy: "syros_cats",
  ...(did.includes("vaccinated") ? { vaccines: ["rabies" as const] } : {}),
  ...(did.includes("treated") ? { treatedNote: "Ear drops" } : {}),
  ...o,
});

const spend = (r: VetCostsReport) => r.perMonth.reduce((s, m) => s + m.spendEur, 0);
const visitsOf = (r: VetCostsReport, catId: number) => r.visits.filter((v) => v.catId === catId);

describe("purposeOf (Decision 14: each visit under its main purpose)", () => {
  it("Sterilised if ticked, else Vaccinated, else Treated, else Checked", () => {
    expect(purposeOf(["vaccinated", "sterilised"])).toBe("sterilised");
    expect(purposeOf(["treated", "vaccinated"])).toBe("vaccinated");
    expect(purposeOf(["treated"])).toBe("treated");
    expect(purposeOf(["checked"])).toBe("checked");
  });
});

// ─── Pure: vetCostsFrom over hand-made rows (review of PR 3.3c) ──────────

let nextId = 1_000_000;
const row = (o: Partial<Observation> & Pick<Observation, "catId" | "kind" | "value" | "observedAt">): Observation =>
  ({ id: nextId++, roleAtTime: "staff", authorityScope: "none", provenance: "volunteered", supersedesId: null, redactedAt: null, accountId: STAFF.id, deviceId: null, createdAt: o.observedAt, ...o }) as Observation;
const visitRow = (catId: number, at: string, v: VetVisitValue, o: Partial<Observation> = {}) =>
  row({ catId, kind: "vet_visit", value: v, observedAt: new Date(at), ...o });
const teamYes = (catId: number, at: string) => row({ catId, kind: "sterilised", value: { sterilised: true }, observedAt: new Date(at) });
const OCT = parseRange({ range: "custom", from: "2026-10-01", to: "2026-10-31" }, NOW);
const NAMES = new Map<number, string>();

describe("vetCostsFrom", () => {
  it("adds money in cents: 0.29 + 0.57 is exactly 0.86, and the average rounds to the cent", () => {
    const r = vetCostsFrom(
      [
        visitRow(1, "2026-10-02T12:00:00Z", visit(["sterilised"], { costEur: 0.1 })),
        visitRow(2, "2026-10-03T12:00:00Z", visit(["sterilised"], { costEur: 0.2, paidBy: "donation" })),
        visitRow(3, "2026-10-04T12:00:00Z", visit(["sterilised"], { costEur: 55.1 })),
      ],
      NAMES,
      OCT,
    );
    expect(r.perMonth.map((m) => m.spendEur)).toEqual([55.4]);
    expect(r.byPurpose.sterilised).toBe(55.4);
    expect(r.perSterilisation).toEqual({ avg: 18.47, min: 0.1, max: 55.1, n: 3 });
    const two = vetCostsFrom(
      // 0.29 × 100 and 0.57 × 100 aren't whole numbers in floating point.
      [visitRow(1, "2026-10-02T12:00:00Z", visit(["checked"], { costEur: 0.29 })), visitRow(2, "2026-10-03T12:00:00Z", visit(["checked"], { costEur: 0.57 }))],
      NAMES,
      OCT,
    );
    expect(two.perMonth[0]!.spendEur).toBe(0.86);
    expect(two.byPurpose.checked).toBe(0.86);
    // An owner-paid visit and one with no cost are listed, never added.
    const mixed = vetCostsFrom(
      [
        visitRow(1, "2026-10-02T12:00:00Z", visit(["sterilised"], { costEur: 0.29 })),
        visitRow(2, "2026-10-03T12:00:00Z", visit(["sterilised"], { costEur: 60, paidBy: "owner" })),
        visitRow(3, "2026-10-04T12:00:00Z", visit(["treated"], { costEur: null })),
      ],
      NAMES,
      OCT,
    );
    expect(mixed.visits).toHaveLength(3);
    expect(mixed.perMonth[0]!.spendEur).toBe(0.29);
    expect(mixed.byPurpose).toEqual({ sterilised: 0.29, vaccinated: 0, treated: 0, checked: 0 });
    expect(mixed.perSterilisation).toEqual({ avg: 0.29, min: 0.29, max: 0.29, n: 1 });
  });

  it("noCost counts a cat once, and not a cat a standing visit sterilised (on any date)", () => {
    const r = vetCostsFrom(
      [
        // Two "Update this cat" yeses on one cat: one sterilisation.
        teamYes(10, "2026-10-05T12:00:00Z"),
        teamYes(10, "2026-10-06T12:00:00Z"),
        // An update on a cat a visit in the range sterilised (with a cost): the visit's.
        teamYes(11, "2026-10-07T12:00:00Z"),
        visitRow(11, "2026-10-08T12:00:00Z", visit(["sterilised"])),
        // An update on a cat a visit in August sterilised: still the visit's.
        teamYes(12, "2026-10-09T12:00:00Z"),
        visitRow(12, "2026-08-08T12:00:00Z", visit(["sterilised"])),
        // A cat guardian's yes is not the team's "Update this cat".
        row({ catId: 13, kind: "sterilised", value: { sterilised: true }, observedAt: new Date("2026-10-10T12:00:00Z"), roleAtTime: "guardian", authorityScope: "colony:1" }),
      ],
      NAMES,
      OCT,
    );
    expect(r.noCost).toBe(1);
  });

  it("a Sterilised visit with no cost is no cost recorded whoever paid", () => {
    const r = vetCostsFrom([visitRow(20, "2026-10-02T12:00:00Z", visit(["sterilised"], { costEur: null, paidBy: "owner" }))], NAMES, OCT);
    expect(r.noCost).toBe(1);
    expect(r.perSterilisation).toBeNull();
  });

  it("files a visit in its Syros month: 23:59 on 30 Sep is September, 00:30 on 1 Oct is October", () => {
    const range = parseRange({ range: "custom", from: "2026-09-01", to: "2026-10-31" }, NOW);
    const r = vetCostsFrom(
      [
        visitRow(30, "2026-09-30T20:59:00Z", visit(["checked"], { costEur: 10 })),
        visitRow(31, "2026-09-30T21:30:00Z", visit(["checked"], { costEur: 20 })),
      ],
      NAMES,
      range,
    );
    expect(r.perMonth.map((m) => [m.visits, m.spendEur])).toEqual([[1, 10], [1, 20]]);
  });

  it("skips a visit row with no list of what was done, rather than failing", () => {
    const odd = visitRow(50, "2026-10-02T12:00:00Z", { clinicId: "symviosis", costEur: 10, paidBy: "syros_cats" } as unknown as VetVisitValue);
    const r = vetCostsFrom([odd, visitRow(51, "2026-10-03T12:00:00Z", visit(["checked"], { costEur: 5 }))], NAMES, OCT);
    expect(r.visits.map((v) => v.catId)).toEqual([51]);
    expect(r.perMonth[0]!.spendEur).toBe(5);
  });

  it("leaves out a redacted visit, as Home's vet spend and the cat page do", () => {
    const r = vetCostsFrom([visitRow(40, "2026-10-02T12:00:00Z", visit(["checked"], { costEur: 10 }), { redactedAt: new Date() })], NAMES, OCT);
    expect(r.visits).toEqual([]);
    expect(r.perMonth[0]!.spendEur).toBe(0);
  });
});

describe("vetCostsReport", () => {
  it("an owner-paid €60 visit appears in visits but not in spendEur", async () => {
    const range = month(3);
    const before = await vetCostsReport(range, NOW);
    const catId = await insertCat();
    await logVetVisit(STAFF, { catId, date: "2004-03-10", value: visit(["sterilised"], { paidBy: "owner" }) }, NOW);
    const after = await vetCostsReport(range, NOW);

    const mine = visitsOf(after, catId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ costEur: 60, paidBy: "owner", did: ["sterilised"] });
    expect(spend(after)).toBe(spend(before));
    expect(after.byPurpose.sterilised).toBe(before.byPurpose.sterilised);
    // Cost per sterilisation counts only Syros Cats' money (§8.4), too.
    expect(after.perSterilisation?.n ?? 0).toBe(before.perSterilisation?.n ?? 0);
    // It is still a visit in its month.
    const visits = (r: VetCostsReport) => r.perMonth.reduce((s, m) => s + m.visits, 0);
    expect(visits(after)).toBe(visits(before) + 1);
  });

  it("a Syros Cats and a donation visit are both spend, counted in cents", async () => {
    const range = month(4);
    const before = await vetCostsReport(range, NOW);
    const a = await insertCat();
    const b = await insertCat();
    await logVetVisit(STAFF, { catId: a, date: "2004-04-02", value: visit(["sterilised"], { costEur: 55.1 }) }, NOW);
    await logVetVisit(STAFF, { catId: b, date: "2004-04-03", value: visit(["sterilised"], { costEur: 0.2, paidBy: "donation" }) }, NOW);
    const after = await vetCostsReport(range, NOW);
    expect(Math.round((spend(after) - spend(before)) * 100)).toBe(5530);
    expect(after.perSterilisation!.n).toBe((before.perSterilisation?.n ?? 0) + 2);
    expect(after.perSterilisation!.min).toBeLessThanOrEqual(0.2);
    expect(after.perSterilisation!.max).toBeGreaterThanOrEqual(55.1);
  });

  it("a Sterilised-and-Vaccinated visit goes under sterilised in byPurpose only", async () => {
    const range = month(5);
    const before = await vetCostsReport(range, NOW);
    const catId = await insertCat();
    await logVetVisit(STAFF, { catId, date: "2004-05-12", value: visit(["sterilised", "vaccinated"], { costEur: 75 }) }, NOW);
    const after = await vetCostsReport(range, NOW);
    expect(after.byPurpose.sterilised).toBe(before.byPurpose.sterilised + 75);
    expect(after.byPurpose.vaccinated).toBe(before.byPurpose.vaccinated);
    expect(after.byPurpose.treated).toBe(before.byPurpose.treated);
    expect(after.byPurpose.checked).toBe(before.byPurpose.checked);
    // The purposes add up to the spend: nothing is counted twice.
    const purposes = (r: VetCostsReport) => Object.values(r.byPurpose).reduce((s, v) => s + v, 0);
    expect(Math.round(purposes(after) * 100)).toBe(Math.round(spend(after) * 100));
  });

  it("a sterilisation made with “Update this cat” counts in noCost, and so does a Sterilised visit with no cost", async () => {
    const range = month(6);
    const before = await vetCostsReport(range, NOW);
    const updated = await insertCat();
    await db.insert(observationsTable).values({
      catId: updated,
      kind: "sterilised",
      value: { sterilised: true },
      accountId: STAFF.id,
      roleAtTime: "staff",
      observedAt: new Date("2004-06-08T12:00:00Z"),
    });
    const noCostVisit = await insertCat();
    await logVetVisit(STAFF, { catId: noCostVisit, date: "2004-06-09", value: visit(["sterilised"], { costEur: null }) }, NOW);
    // A costed visit is not "no cost".
    const costed = await insertCat();
    await logVetVisit(STAFF, { catId: costed, date: "2004-06-10", value: visit(["sterilised"]) }, NOW);
    const after = await vetCostsReport(range, NOW);
    expect(after.noCost).toBe(before.noCost + 2);
    // A visit with no cost is listed, with no cost.
    expect(visitsOf(after, noCostVisit)[0]).toMatchObject({ costEur: null });
  });

  it("an undone visit is nowhere", async () => {
    const range = month(7);
    const before = await vetCostsReport(range, NOW);
    const sterilisedCat = await insertCat();
    const noCostCat = await insertCat();
    const a = await logVetVisit(STAFF, { catId: sterilisedCat, date: "2004-07-05", value: visit(["sterilised", "vaccinated"]) }, NOW);
    const b = await logVetVisit(STAFF, { catId: noCostCat, date: "2004-07-06", value: visit(["sterilised"], { costEur: null }) }, NOW);
    await undoVetVisit(STAFF, a.visitId, "wrong cat", NOW);
    await undoVetVisit(STAFF, b.visitId, "wrong cat", NOW);
    const after = await vetCostsReport(range, NOW);

    expect(visitsOf(after, sterilisedCat)).toEqual([]);
    expect(visitsOf(after, noCostCat)).toEqual([]);
    expect(after.perMonth).toEqual(before.perMonth);
    expect(after.byPurpose).toEqual(before.byPurpose);
    expect(after.perSterilisation).toEqual(before.perSterilisation);
    expect(after.noCost).toBe(before.noCost);
  });

  it("its month's spend is Home's vet spend for the same month", async () => {
    const range = month(10);
    const before = await vetCostsReport(range, NOW);
    const homeBefore = await vetSpend(range.from!, new Date(range.to.getTime() + 1));
    expect(spend(before)).toBe(homeBefore);
    const cats = [await insertCat(), await insertCat(), await insertCat(), await insertCat()];
    await logVetVisit(STAFF, { catId: cats[0]!, date: "2004-10-04", value: visit(["sterilised"], { costEur: 0.29 }) }, NOW);
    await logVetVisit(STAFF, { catId: cats[1]!, date: "2004-10-05", value: visit(["vaccinated"], { costEur: 0.57, paidBy: "donation" }) }, NOW);
    await logVetVisit(STAFF, { catId: cats[2]!, date: "2004-10-06", value: visit(["checked"], { costEur: 40, paidBy: "owner" }) }, NOW);
    const undone = await logVetVisit(STAFF, { catId: cats[3]!, date: "2004-10-07", value: visit(["sterilised"], { costEur: 60 }) }, NOW);
    await undoVetVisit(STAFF, undone.visitId, "wrong cat", NOW);
    const after = await vetCostsReport(range, NOW);
    const home = await vetSpend(range.from!, new Date(range.to.getTime() + 1));
    expect(spend(after)).toBe(home);
    expect(Math.round((home - homeBefore) * 100)).toBe(86);
  });

  it("counts a visit by its date, not by when it was entered", async () => {
    const catId = await insertCat();
    await logVetVisit(STAFF, { catId, date: "2004-08-31", value: visit(["checked"], { costEur: 20 }) }, NOW);
    expect(visitsOf(await vetCostsReport(month(8), NOW), catId)).toHaveLength(1);
    expect(visitsOf(await vetCostsReport(month(9), NOW), catId)).toHaveLength(0);
  });
});
