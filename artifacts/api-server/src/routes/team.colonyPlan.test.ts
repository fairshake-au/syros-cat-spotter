import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, feedingSitesTable, observationsTable, sightingsTable } from "@workspace/db";
import { like } from "drizzle-orm";
import app from "../app";
import { areaFor } from "../lib/areas/namedAreas";
import { getAppSettings } from "../lib/appSettings";
import { removeTestPerson } from "../test/removeTestPerson";
import { deleteTestRows } from "../test/deleteGuarded";
import { deleteTestSightings } from "../test/sightings";
import { guardianOn, newColony, RUN, seedCat, signedPerson, type Signed } from "../test/roleKit";

// SYC-396 PR 2.3, Task 2.3.3 (SYC-621; spec §9.2, §10.2): the colony page
// leads with the trapping plan, and the printable plan is the team's only.

const KEY = "vitest-plan-key-0123456789abcdef-0123456789";
const DEVICE = `vt-plan-route-${RUN}`;
const SITE = `vitest-site-planroute-${RUN}-`;

let team: Signed;
let guardian: Signed;
let colony: number;
let empty: number;
let catIds: number[] = [];

const say = (catId: number, kind: string, value: unknown) =>
  db.insert(observationsTable).values({
    catId,
    kind,
    value: value as never,
    deviceId: DEVICE,
    roleAtTime: "staff",
    observedAt: new Date(Date.now() - 86_400_000 * 30),
  });

const page = (path: string, who: Signed) =>
  request(app).get(path).set("Cookie", who.cookie).set("Sec-Fetch-Mode", "navigate");

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  colony = await newColony("plan-route");
  empty = await newColony("plan-route-done");
  for (let i = 0; i < 3; i += 1) catIds.push((await seedCat(colony)).id);
  // A sighting near a site whose internal name holds a guardian's name.
  await db.insert(feedingSitesTable).values([
    { name: `${SITE}Vaporia — Eleni's`, colonyId: colony, lat: 37.4447, lng: 24.9475, isPublic: true, publicLabel: "harbour steps", publicId: `${SITE}pub` },
    { name: `${SITE}Maria's yard`, colonyId: colony, lat: 37.4449, lng: 24.9477 },
  ]);
  await db.insert(sightingsTable).values({
    catId: catIds[0]!,
    deviceId: DEVICE,
    photoId: (await seedCat(null)).photoId,
    lat: 37.44471,
    lng: 24.94751,
    status: "resolved",
    createdAt: new Date(Date.now() - 86_400_000),
  });
  const ster = await seedCat(empty);
  await say(ster.id, "sterilised", { sterilised: true });
  team = await signedPerson("plan-route-team", ["staff"]);
  guardian = await guardianOn("plan-route-g", [colony, empty]);
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
});

afterAll(async () => {
  delete process.env["TEAM_SESSION_KEYS"];
  await removeTestPerson(team.email);
  await removeTestPerson(guardian.email);
  await deleteTestSightings(like(sightingsTable.deviceId, `${DEVICE}%`));
  await deleteTestRows("feeding_sites", "name like $1", [`${SITE}%`]);
});

describe("the colony page", () => {
  it("puts To do before the feeding sites, with the estimate from Vet settings for the team", async () => {
    const res = await page(`/api/team/colonies/${colony}`, team);
    expect(res.status).toBe(200);
    const html = res.text;
    expect(html.indexOf('<h2 id="todo">To do (3)</h2>')).toBeGreaterThan(-1);
    expect(html.indexOf('<h2 id="todo">')).toBeLessThan(html.indexOf("<h2>Feeding sites</h2>"));
    const price = (await getAppSettings()).sterilisationPriceEur;
    expect(html).toContain(`3 cats × €${price} = €${3 * price}`);
    expect(html).toContain(`href="/api/team/colonies/${colony}/plan"`);
    // The sites on a small map, with no zoom or pan buttons.
    expect(html).toContain('<div class="planmap">');
    expect(html).not.toContain('name="go"');
    // The cat seen by the public site reads its public label.
    expect(html).toContain(`Usually seen: ${areaFor(37.4447, 24.9475).name}, harbour steps`);
  });

  it("never shows a cat guardian the estimate or the print, and her JSON holds no position", async () => {
    const res = await page(`/api/team/colonies/${colony}`, guardian);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<h2 id="todo">');
    expect(res.text).not.toContain("×");
    expect(res.text).not.toContain("/plan\"");
    const json = await request(app).get(`/api/team/colonies/${colony}`).set("Cookie", guardian.cookie).set("Accept", "application/json");
    expect(json.status).toBe(200);
    expect(json.body.plan.estimate).toBeNull();
    const plan = JSON.stringify(json.body.plan);
    expect(plan).not.toMatch(/\d+\.\d{4,}/);
    for (const key of ["lastSeen", "placedAt", "place", "snapshot", "lat", "lng"]) expect(plan).not.toContain(`"${key}"`);
  });

  it("says every street cat is sterilised when To do is empty", async () => {
    const res = await page(`/api/team/colonies/${empty}`, team);
    expect(res.text).toContain("Every street cat here is sterilised.");
    expect(res.text).not.toContain('<p class="estimate">');
  });
});

describe("GET /api/team/colonies/:id/plan, the printable plan", () => {
  it("is a print page with the cats, and no coordinate, map company or internal site name", async () => {
    const res = await page(`/api/team/colonies/${colony}/plan`, team);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const html = res.text;
    expect(html).toContain("@media print");
    for (const id of catIds) expect(html).toContain(`SYR-${String(id).padStart(4, "0")}`);
    expect(html).toContain("harbour steps");
    expect(html).toMatch(/Syros Cats · printed \d{1,2} [A-Z][a-z]{2} \d{4} · for the team only/);
    expect(html).not.toMatch(/\d+\.\d{4,}/);
    expect(html).not.toMatch(/openstreetmap|google\.com\/maps|geo:|tile/i);
    expect(html).not.toContain("Eleni");
    expect(html).not.toContain("Maria");
    // No menu.
    expect(html).not.toContain('class="bar"');
  });

  it("refuses a cat guardian, even for her own colony", async () => {
    expect((await page(`/api/team/colonies/${colony}/plan`, guardian)).status).toBe(403);
  });

  it("is not found for a colony that doesn't exist", async () => {
    expect((await page(`/api/team/colonies/1999999999/plan`, team)).status).toBe(404);
  });
});
