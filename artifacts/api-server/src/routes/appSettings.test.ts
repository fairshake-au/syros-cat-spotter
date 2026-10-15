import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  appSettingsTable,
  catsTable,
  db,
  deviceCredentialsTable,
  photosTable,
  pool,
  sightingsTable,
} from "@workspace/db";
import { eq, like } from "drizzle-orm";
import app from "../app";
import { _resetAppSettingsCacheForTests, SIGN_OFF_FACT_IDS } from "../lib/appSettings";
import { WITHDRAWN, writeObservation } from "../lib/observations";
import { todayInStreakTimezone } from "../lib/streak";

// SYC-36 / SYC-48, match-wait plan PR 1: GET /api/app-settings and
// GET /api/app-settings/:deviceId/signals.

const PREFIX = "vitest-appsettings-";
type Phone = { id: string; secret: string };
function phone(label: string): Phone {
  const tag = randomBytes(4).toString("hex");
  return { id: `${PREFIX}${label}-${tag}`, secret: `${PREFIX}secret-${label}-${tag}` };
}

/** Bind a phone's secret the way the app does on its first request. */
async function bind(p: Phone) {
  const res = await request(app).get(`/api/profiles/${p.id}/username`).set("X-Device-Secret", p.secret);
  expect(res.status).toBe(200);
}

const signals = (p: Phone, secret = p.secret) =>
  request(app).get(`/api/app-settings/${p.id}/signals`).set("X-Device-Secret", secret);

const DAY = 86_400_000;

/** A sighting whose photo arrived `arrivedDaysAgo` ago, captured
 * `capturedDaysAgo` ago (a library photo can be older than its arrival). */
async function sighting(p: Phone, arrivedDaysAgo: number, capturedDaysAgo = arrivedDaysAgo) {
  const [photo] = await db
    .insert(photosTable)
    .values({ data: "AAAA", mime: "image/jpeg", createdAt: new Date(Date.now() - arrivedDaysAgo * DAY) })
    .returning();
  await db.insert(sightingsTable).values({
    deviceId: p.id,
    photoId: photo!.id,
    lat: 37.44,
    lng: 24.94,
    status: "pending",
    createdAt: new Date(Date.now() - capturedDaysAgo * DAY),
  });
  return photo!.id;
}

async function streetCat() {
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}${randomBytes(4).toString("hex")}`,
      description: "",
      primaryPhotoId: 0,
      lat: 37.44,
      lng: 24.94,
      discovererDeviceId: `${PREFIX}discoverer`,
    })
    .returning();
  return c!.id;
}

async function claim(catId: number, p: Phone) {
  return writeObservation(db, {
    catId,
    kind: "life_status",
    value: { status: "homed" },
    deviceId: p.id,
    roleAtTime: "public",
    authorityScope: "owner_of_this_cat",
    observedAt: new Date(),
  });
}

beforeEach(async () => {
  await db.delete(appSettingsTable);
  _resetAppSettingsCacheForTests();
});

afterAll(async () => {
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
  await pool.end();
});

describe("GET /api/app-settings", () => {
  it("with no rows: no donation link, the nine sign-off facts hidden", async () => {
    const res = await request(app).get("/api/app-settings");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ feedNudge: null, hiddenFacts: [...SIGN_OFF_FACT_IDS] });
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
  });

  it("an https page switches the nudge's link on and sends only its host", async () => {
    await db.insert(appSettingsTable).values({ key: "feed_nudge_donate_url", value: "https://syroscats.com/donations" });
    const res = await request(app).get("/api/app-settings");
    expect(res.body.feedNudge).toEqual({ donateHost: "syroscats.com" });
    expect(JSON.stringify(res.body)).not.toContain("/donations");
  });

  it.each([["http://syroscats.com/donations"], ["javascript:alert(1)"], [""]])(
    "a donation page of %j leaves the link off",
    async (value) => {
      await db.insert(appSettingsTable).values({ key: "feed_nudge_donate_url", value });
      const res = await request(app).get("/api/app-settings");
      expect(res.body.feedNudge).toBeNull();
    },
  );

  it("an empty list hides nothing; an unknown id is ignored", async () => {
    await db.insert(appSettingsTable).values({ key: "starter_facts_hidden", value: ["fact.nope"] });
    const res = await request(app).get("/api/app-settings");
    expect(res.body.hiddenFacts).toEqual([]);
  });

  it("answers from its cache for a minute, then reads the change", async () => {
    await request(app).get("/api/app-settings");
    await db.insert(appSettingsTable).values({ key: "starter_facts_hidden", value: [] });
    const cachedRes = await request(app).get("/api/app-settings");
    expect(cachedRes.body.hiddenFacts).toEqual([...SIGN_OFF_FACT_IDS]);
    _resetAppSettingsCacheForTests();
    const fresh = await request(app).get("/api/app-settings");
    expect(fresh.body.hiddenFacts).toEqual([]);
  });
});

describe("GET /api/app-settings/:deviceId/signals", () => {
  it("a bound phone with no sightings: not claimed, no first spot; never cached", async () => {
    const p = phone("new");
    await bind(p);
    const res = await signals(p);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasClaimedCat: false, firstSpotDate: null });
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("firstSpotDate is the Athens day the first photo ARRIVED, not when it was taken (plan C1)", async () => {
    const p = phone("library");
    await bind(p);
    // Arrived 2 days ago, but the photo was taken 20 days ago.
    await sighting(p, 2, 20);
    const res = await signals(p);
    expect(res.body.firstSpotDate).toBe(todayInStreakTimezone(new Date(Date.now() - 2 * DAY)));
  });

  it("the earliest of several arrivals wins: 20 and 21 days ago", async () => {
    const p = phone("old");
    await bind(p);
    await sighting(p, 3);
    await sighting(p, 21);
    await sighting(p, 20);
    const res = await signals(p);
    expect(res.body.firstSpotDate).toBe(todayInStreakTimezone(new Date(Date.now() - 21 * DAY)));
  });

  it("a sighting whose photo row is gone still counts, by its own time (plan C1)", async () => {
    const p = phone("nophoto");
    await bind(p);
    await sighting(p, 1);
    const goneId = await sighting(p, 10);
    await db.delete(photosTable).where(eq(photosTable.id, goneId));
    const res = await signals(p);
    expect(res.body.firstSpotDate).toBe(todayInStreakTimezone(new Date(Date.now() - 10 * DAY)));
  });

  it("a claim makes it true, and letting the cat go keeps it true (plan C2)", async () => {
    const p = phone("owner");
    await bind(p);
    const catId = await streetCat();
    const homed = await claim(catId, p);
    expect((await signals(p)).body.hasClaimedCat).toBe(true);
    await writeObservation(db, {
      catId,
      kind: "life_status",
      value: WITHDRAWN,
      allowWithdrawal: true,
      deviceId: p.id,
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
      observedAt: new Date(),
      supersedesId: homed.id,
      supersedeReason: "owner: doesn't live with me any more",
    });
    expect((await signals(p)).body.hasClaimedCat).toBe(true);
  });

  it("someone else's claim doesn't count", async () => {
    const p = phone("visitor");
    const other = phone("other");
    await bind(p);
    await claim(await streetCat(), other);
    expect((await signals(p)).body.hasClaimedCat).toBe(false);
  });

  it("no secret: 401", async () => {
    const p = phone("nosecret");
    await bind(p);
    const res = await request(app).get(`/api/app-settings/${p.id}/signals`);
    expect(res.status).toBe(401);
  });

  it("a wrong secret: 403, and not device_moved", async () => {
    const p = phone("wrong");
    await bind(p);
    const res = await signals(p, `${PREFIX}secret-not-this-one-000`);
    expect(res.status).toBe(403);
    expect(res.body.error).not.toBe("device_moved");
  });

  it("a phone that has never bound gets 403 and stays unbound (bind: false)", async () => {
    const p = phone("unbound");
    const res = await signals(p);
    expect(res.status).toBe(403);
    const rows = await db
      .select()
      .from(deviceCredentialsTable)
      .where(eq(deviceCredentialsTable.deviceId, p.id));
    expect(rows).toHaveLength(0);
  });
});
