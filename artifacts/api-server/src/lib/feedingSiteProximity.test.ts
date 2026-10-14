import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import {
  isNearFeedingSite,
  pointsNearFeedingSite,
} from "./feedingSiteProximity";
import {
  deleteTestFeedingSites,
  northOf,
  seedFeedingSite,
} from "../test/feedingSites";

// SYC-245 (SYC-209 PR 0.2): the 50 m question, answered in the query.

const LAT = 37.4441234;
const LNG = 24.9412345;

beforeEach(deleteTestFeedingSites);
afterEach(deleteTestFeedingSites);
afterAll(async () => {
  await pool.end();
});

describe("isNearFeedingSite", () => {
  it("is no when there are no feeding sites", async () => {
    expect(await isNearFeedingSite(LAT, LNG)).toBe(false);
  });

  it("is yes at 30 m and no at 80 m", async () => {
    await seedFeedingSite(northOf(LAT, 30), LNG);
    expect(await isNearFeedingSite(LAT, LNG)).toBe(true);
    await deleteTestFeedingSites();
    await seedFeedingSite(northOf(LAT, 80), LNG);
    expect(await isNearFeedingSite(LAT, LNG)).toBe(false);
  });

  it("is yes at 49 m and no at 51 m, in both directions", async () => {
    await seedFeedingSite(northOf(LAT, 49), LNG);
    expect(await isNearFeedingSite(LAT, LNG)).toBe(true);
    await deleteTestFeedingSites();
    await seedFeedingSite(northOf(LAT, 51), LNG);
    expect(await isNearFeedingSite(LAT, LNG)).toBe(false);
    await deleteTestFeedingSites();
    // 40 m east: one degree of longitude is shorter by cos(latitude).
    const metresPerDegreeLng =
      ((Math.PI / 180) * 6_371_000) * Math.cos((LAT * Math.PI) / 180);
    await seedFeedingSite(LAT, LNG + 40 / metresPerDegreeLng);
    expect(await isNearFeedingSite(LAT, LNG)).toBe(true);
    await deleteTestFeedingSites();
    await seedFeedingSite(LAT, LNG + 60 / metresPerDegreeLng);
    expect(await isNearFeedingSite(LAT, LNG)).toBe(false);
  });

  it("counts a site that is private, and any other site far away does not matter", async () => {
    await seedFeedingSite(northOf(LAT, 5000), LNG);
    expect(await isNearFeedingSite(LAT, LNG)).toBe(false);
    await seedFeedingSite(northOf(LAT, 10), LNG);
    expect(await isNearFeedingSite(LAT, LNG)).toBe(true);
  });
});

describe("pointsNearFeedingSite", () => {
  it("answers a whole batch in one go, by key, never naming the site", async () => {
    await seedFeedingSite(northOf(LAT, 30), LNG);
    const near = await pointsNearFeedingSite([
      { key: "close", lat: LAT, lng: LNG },
      { key: "far", lat: northOf(LAT, 500), lng: LNG },
    ]);
    expect([...near]).toEqual(["close"]);
  });

  it("is empty for an empty batch", async () => {
    expect((await pointsNearFeedingSite([])).size).toBe(0);
  });
});
