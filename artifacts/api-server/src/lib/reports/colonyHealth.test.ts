import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { catsTable, coloniesTable, db, observationsTable, photosTable, pool, sightingsTable } from "@workspace/db";
import { deleteTestSightings } from "../../test/sightings";
import { visibleColonyIds } from "../guardianView";
import { colonyHealthReport, sortHealth, type HealthRow } from "./colonyHealth";
import { parseRange } from "./range";

// SYC-396 PR 3.3a, Task 3.3a.3 (spec §9.3 report 2): Colony health. Every
// assertion is on this file's own colony; the database is shared by the run.

const PREFIX = `VitestHealth${randomBytes(3).toString("hex")}`;
const DEVICE = `${PREFIX}-device`;
const DAY = 86_400_000;
const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const TEAM = visibleColonyIds({ scopes: [{ role: "staff", colonyId: null, reach: "island" }] });
let photoId: number;
let colonyId: number;

async function cat(created: Date): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({ name: `${PREFIX}${randomBytes(3).toString("hex")}`, primaryPhotoId: photoId, lat: 37.445, lng: 24.942, discovererDeviceId: DEVICE, createdAt: created })
    .returning({ id: catsTable.id });
  return c!.id;
}

/** The cat joins the colony, entered (and observed) at `at`. */
async function into(catId: number, at: Date) {
  await db.insert(observationsTable).values({ catId, kind: "colony", value: { colonyId }, deviceId: DEVICE, roleAtTime: "staff", observedAt: at, createdAt: at });
}

beforeAll(async () => {
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}photo`, data: Buffer.from("x").toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  photoId = p!.id;
  const name = `${PREFIX} colony`;
  const [col] = await db
    .insert(coloniesTable)
    .values({ name, normalisedName: name.toLowerCase(), createdAt: daysAgo(200) })
    .returning({ id: coloniesTable.id });
  colonyId = col!.id;
  // Two cats there 120 days ago, one of them last sighted 50 days ago; one new 10 days ago.
  const old1 = await cat(daysAgo(120));
  await into(old1, daysAgo(120));
  const old2 = await cat(daysAgo(120));
  await into(old2, daysAgo(120));
  await db.insert(sightingsTable).values({ catId: old2, deviceId: DEVICE, photoId, lat: 37.445, lng: 24.942, status: "resolved", createdAt: daysAgo(50) });
  const young = await cat(daysAgo(10));
  await into(young, daysAgo(10));
});

afterAll(async () => {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await pool.end();
});

const mine = async () => {
  const r = await colonyHealthReport(TEAM, parseRange({ range: "3months" }, NOW), NOW);
  return r.rows.find((x) => x.colonyId === colonyId)!;
};

describe("a colony's row", () => {
  it("cats now, the change over 90 days (as the records stood then), not seen lately, guardian no, last visit", async () => {
    const row = await mine();
    expect(row).toMatchObject({
      name: `${PREFIX} colony`,
      catsNow: 3,
      change: 1,
      kittens: false,
      notSeenLately: 1,
      guardian: false,
    });
    expect(row.lastVisit?.getTime()).toBe(daysAgo(50).getTime());
    // The flags are the Colonies list's own.
    expect(row.flags).toContain("no_guardian");
    expect(row.flags).toContain("not_visited");
  });

  it("for a range that ended in the past, last visit and the flags use the records as they stood then (review of #260)", async () => {
    // Ended 60 days ago: the sighting 50 days ago hadn't happened yet.
    const end = daysAgo(60);
    const d = (t: Date) => t.toLocaleDateString("en-CA", { timeZone: "Europe/Athens" });
    const range = parseRange({ range: "custom", from: d(daysAgo(150)), to: d(end) }, NOW);
    const r = await colonyHealthReport(TEAM, range, NOW);
    const row = r.rows.find((x) => x.colonyId === colonyId)!;
    expect(row.lastVisit).toBeNull();
    expect(row.catsNow).toBe(2);
  });

  it("a colony created after the range ends isn't in it", async () => {
    const r = await colonyHealthReport(TEAM, parseRange({ range: "custom", from: "2026-01-01", to: "2026-01-31" }, NOW), NOW);
    expect(r.rows.find((x) => x.colonyId === colonyId)).toBeUndefined();
  });
});

describe("sorting", () => {
  const row = (name: string, o: Partial<HealthRow>): HealthRow => ({
    colonyId: name.length,
    name,
    catsNow: 0,
    change: 0,
    kittens: false,
    notSeenLately: 0,
    guardian: true,
    lastVisit: null,
    flags: [],
    ...o,
  });
  const rows = [
    row("Beta", { catsNow: 5, change: -2, lastVisit: new Date("2026-10-01") }),
    row("Alpha", { catsNow: 5, change: 3 }),
    row("Gamma", { catsNow: 1, change: 0, lastVisit: new Date("2026-10-10") }),
  ];
  it("by a number, ties by name; never visited last both ways", () => {
    expect(sortHealth(rows, "cats", "desc").map((r) => r.name)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(sortHealth(rows, "change", "asc").map((r) => r.name)).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(sortHealth(rows, "lastvisit", "desc").map((r) => r.name)).toEqual(["Gamma", "Beta", "Alpha"]);
    expect(sortHealth(rows, "lastvisit", "asc").map((r) => r.name)).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(sortHealth(rows, "name", "desc").map((r) => r.name)).toEqual(["Gamma", "Beta", "Alpha"]);
  });
});
