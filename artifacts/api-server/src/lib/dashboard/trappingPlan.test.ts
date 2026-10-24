import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { catIdentityTable, catsTable, db, feedingSitesTable, observationsTable, photosTable, sightingsTable } from "@workspace/db";
import { deleteTestSightings } from "../../test/sightings";
import { deleteTestRows } from "../../test/deleteGuarded";
import { northOf } from "../../test/feedingSites";
import { newColony } from "../../test/roleKit";
import { visibleColonyIds } from "../guardianView";
import { areaFor } from "../areas/namedAreas";
import { getAppSettings } from "../appSettings";
import { trappingPlan, type GuardianPlanCat, type PlanCat } from "./trappingPlan";

// SYC-396 PR 2.3, Task 2.3.2 (SYC-621; spec §9.2, §10.2): a colony's
// trapping plan. The test database is shared and never truncated, so every
// assertion reads this run's own colonies only.

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-plan-${RUN}-`;
const DEVICE = `${PREFIX}device`;
const SITE = `vitest-site-plan-${RUN}-`;
const NOW = new Date();
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);

// Ermoupoli for sightings and sites; Kini, about 4.6 km west, for where a cat was first found.
const TOWN = { lat: 37.4447 + Math.random() * 0.001, lng: 24.9417 + Math.random() * 0.001 };
const KINI = { lat: 37.4436, lng: 24.8889 };

const TEAM = visibleColonyIds({ scopes: [{ role: "staff", colonyId: null, reach: "island" }] });
const guardianOf = (...colonies: number[]) =>
  visibleColonyIds({ scopes: colonies.map((colonyId) => ({ role: "guardian", colonyId, reach: "colony" })) });

let photoId: number;
let clock = NOW.getTime() - 400 * DAY;

async function cat(at = TOWN): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}${randomBytes(3).toString("hex")}`,
      primaryPhotoId: photoId,
      lat: at.lat,
      lng: at.lng,
      discovererDeviceId: DEVICE,
      createdAt: daysAgo(400),
    })
    .returning({ id: catsTable.id });
  return c!.id;
}

async function say(catId: number, kind: string, value: unknown, extra: { photoId?: number } = {}) {
  clock += 60_000;
  await db.insert(observationsTable).values({
    catId,
    kind,
    value: value as never,
    deviceId: DEVICE,
    roleAtTime: "staff",
    observedAt: new Date(clock),
    ...extra,
  });
}

const into = (catId: number, colonyId: number) => say(catId, "colony", { colonyId });
const sterilised = (catId: number, yes: boolean) => say(catId, "sterilised", { sterilised: yes });

async function sighted(catId: number, when: Date, at = TOWN) {
  await db.insert(sightingsTable).values({
    catId,
    deviceId: DEVICE,
    photoId,
    lat: at.lat,
    lng: at.lng,
    status: "resolved",
    createdAt: when,
  });
}

async function site(colonyId: number, at: { lat: number; lng: number }, o: { name?: string; label?: string; retired?: boolean } = {}) {
  await db.insert(feedingSitesTable).values({
    name: `${SITE}${o.name ?? randomBytes(3).toString("hex")}`,
    colonyId,
    lat: at.lat,
    lng: at.lng,
    ...(o.label ? { isPublic: true, publicLabel: o.label, publicId: `${PREFIX}${randomBytes(4).toString("hex")}` } : {}),
    ...(o.retired ? { retiredAt: daysAgo(1) } : {}),
  });
}

const ids = (cats: ReadonlyArray<{ id: number }>) => cats.map((c) => c.id);

beforeAll(async () => {
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}photo`, data: Buffer.from("x").toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  photoId = p!.id;
});

afterAll(async () => {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await deleteTestRows("feeding_sites", "name like $1", [`${SITE}%`]);
});

describe("To do, Done and Not on the street", () => {
  it("lists not sterilised, then not known, then probably, most recently seen first; sterilised cats are Done", async () => {
    const c = await newColony("plan-order");
    const unknownOld = await cat();
    await into(unknownOld, c);
    await sighted(unknownOld, daysAgo(20));
    const unknownNew = await cat();
    await into(unknownNew, c);
    await sighted(unknownNew, daysAgo(2));
    const unknownNever = await cat();
    await into(unknownNever, c);
    const no = await cat();
    await sterilised(no, false);
    await into(no, c);
    await sighted(no, daysAgo(30));
    const probably = await cat();
    await say(probably, "ear_tip", { clipped: true }, { photoId });
    await into(probably, c);
    await sighted(probably, daysAgo(1));
    const done = await cat();
    await sterilised(done, true);
    await into(done, c);

    const plan = (await trappingPlan(TEAM, c, { island: true }, NOW))!;
    expect(ids(plan.toDo)).toEqual([no, unknownNew, unknownOld, unknownNever, probably]);
    expect(ids(plan.done)).toEqual([done]);
    expect(plan.other).toEqual([]);
    // The ear clip someone photographed.
    expect((plan.toDo as PlanCat[]).find((x) => x.id === probably)!.earClipSeen).toBe(true);
    expect((plan.toDo as PlanCat[]).find((x) => x.id === no)!.earClipSeen).toBe(false);
  });

  it("never lists a homed, in-care or gone cat in To do or Done: they are Not on the street", async () => {
    const c = await newColony("plan-other");
    const street = await cat();
    await into(street, c);
    const homed = await cat();
    await sterilised(homed, false);
    await say(homed, "life_status", { status: "homed" });
    await into(homed, c);
    const care = await cat();
    await say(care, "life_status", { status: "in_care" });
    await into(care, c);
    const gone = await cat();
    await say(gone, "life_status", { status: "deceased" });
    await into(gone, c);

    const plan = (await trappingPlan(TEAM, c, { island: true }, NOW))!;
    expect(ids(plan.toDo)).toEqual([street]);
    expect(plan.done).toEqual([]);
    expect(new Map(plan.other.map((o) => [o.id, o.why]))).toEqual(
      new Map([
        [homed, "homed"],
        [care, "in_care"],
        [gone, "gone"],
      ]),
    );
  });

  it("keeps a merged-away half in the colony as Not on the street", async () => {
    const c = await newColony("plan-merged");
    const keep = await cat();
    await into(keep, c);
    const half = await cat();
    await into(half, c);
    await db.insert(catIdentityTable).values({ catId: half, canonicalCatId: keep, createdBy: "vitest-plan" });
    const plan = (await trappingPlan(TEAM, c, { island: true }, NOW))!;
    expect(ids(plan.toDo)).toEqual([keep]);
    expect(plan.other).toEqual([expect.objectContaining({ id: half, why: "merged" })]);
  });

  it("never cuts the list short", async () => {
    const c = await newColony("plan-long");
    for (let i = 0; i < 30; i += 1) await into(await cat(), c);
    const plan = (await trappingPlan(TEAM, c, { island: true }, NOW))!;
    expect(plan.toDo).toHaveLength(30);
  });
});

describe("the estimate", () => {
  it("is N cats × the standard price from Vet settings, for the team", async () => {
    const c = await newColony("plan-estimate");
    for (let i = 0; i < 7; i += 1) await into(await cat(), c);
    const price = (await getAppSettings()).sterilisationPriceEur;
    const plan = (await trappingPlan(TEAM, c, { island: true }, NOW))!;
    expect(plan.estimate).toEqual({ cats: 7, priceEur: price, totalEur: 7 * price });
  });

  it("is null for a cat guardian", async () => {
    const c = await newColony("plan-estimate-g");
    await into(await cat(), c);
    expect((await trappingPlan(guardianOf(c), c, { island: false }, NOW))!.estimate).toBeNull();
  });
});

describe("who sees the plan", () => {
  it("a colony outside what the viewer sees is null, like one that doesn't exist", async () => {
    const mine = await newColony("plan-mine");
    const other = await newColony("plan-theirs");
    expect(await trappingPlan(guardianOf(mine), other, { island: false }, NOW)).toBeNull();
    expect(await trappingPlan(TEAM, 2_000_000_000, { island: true }, NOW)).toBeNull();
    expect(await trappingPlan(guardianOf(mine), mine, { island: false }, NOW)).not.toBeNull();
  });
});

describe("where the cat is usually seen", () => {
  it("the team reads the nearest site's public label from the last sighting; a guardian reads where it was first found", async () => {
    expect(areaFor(TOWN.lat, TOWN.lng).name).not.toBe(areaFor(KINI.lat, KINI.lng).name);
    const c = await newColony("plan-place");
    await site(c, { lat: northOf(TOWN.lat, 50), lng: TOWN.lng }, { label: "harbour steps" });
    const mimi = await cat(KINI);
    await into(mimi, c);
    await sighted(mimi, daysAgo(1), TOWN);

    const team = (await trappingPlan(TEAM, c, { island: true }, NOW))!.toDo as PlanCat[];
    expect(team[0]!.usualPlace).toBe(`${areaFor(TOWN.lat, TOWN.lng).name}, harbour steps`);
    const hers = (await trappingPlan(guardianOf(c), c, { island: false }, NOW))!.toDo as GuardianPlanCat[];
    expect(hers[0]!.usualPlace).toBe(areaFor(KINI.lat, KINI.lng).name);
  });

  it("a site more than 300 m away, a retired site and a private site never give a label", async () => {
    const c = await newColony("plan-far");
    await site(c, { lat: northOf(TOWN.lat, 400), lng: TOWN.lng }, { label: "too far" });
    await site(c, { lat: northOf(TOWN.lat, 20), lng: TOWN.lng }, { retired: true });
    await site(c, { lat: northOf(TOWN.lat, 30), lng: TOWN.lng }, { name: "private yard" });
    const tom = await cat();
    await into(tom, c);
    await sighted(tom, daysAgo(1));
    const plan = (await trappingPlan(TEAM, c, { island: true }, NOW))!;
    expect((plan.toDo as PlanCat[])[0]!.usualPlace).toBe(areaFor(TOWN.lat, TOWN.lng).name);
    // The retired site is not on the map either.
    expect(plan.sites).toHaveLength(2);
  });

  it("never holds a site's internal name", async () => {
    const c = await newColony("plan-name");
    await site(c, { lat: northOf(TOWN.lat, 10), lng: TOWN.lng }, { name: "Vaporia — Eleni's", label: "harbour steps" });
    await site(c, { lat: northOf(TOWN.lat, -10), lng: TOWN.lng }, { name: "Vaporia — Eleni's private" });
    const kit = await cat();
    await into(kit, c);
    await sighted(kit, daysAgo(1));
    for (const [visible, island] of [
      [TEAM, true],
      [guardianOf(c), false],
    ] as const) {
      const plan = await trappingPlan(visible, c, { island }, NOW);
      expect(JSON.stringify(plan)).not.toContain("Eleni");
    }
  });
});

describe("a guardian's plan", () => {
  it("carries no sighting position, place or snapshot", async () => {
    const c = await newColony("plan-serial");
    const cats = [await cat(KINI), await cat(KINI)];
    for (const id of cats) {
      await into(id, c);
      await sighted(id, daysAgo(3));
    }
    await sterilised(cats[1]!, true);
    const plan = (await trappingPlan(guardianOf(c), c, { island: false }, NOW))!;
    expect(plan.toDo).toHaveLength(1);
    expect(plan.done).toHaveLength(1);
    const json = JSON.stringify({ toDo: plan.toDo, done: plan.done, other: plan.other });
    for (const key of ["lastSeen", "placedAt", "place", "snapshot", "lat", "lng", "areaKey"]) {
      expect(json).not.toContain(`"${key}"`);
    }
    expect(json).not.toMatch(/\d+\.\d{4,}/);
  });
});
