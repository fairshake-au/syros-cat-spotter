import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import { db, placementEndsAt, pool, scopeInForce, sightingsTable } from "@workspace/db";
import app from "../app";
import { removeTestPerson } from "../test/removeTestPerson";
import {
  endPlacements,
  guardianOn,
  hidePhoto,
  newColony,
  putInColony,
  seedCat,
  signedPerson,
  type SeededCat,
  type Signed,
} from "../test/roleKit";

// SYC-53 PR 0.5: a placed capability's target comes from the record (T5),
// and a placement's end date takes effect at the next request, by the
// database's clock, at midnight Athens time (T6).

const KEY = "vitest-placed-key-0123456789abcdef-0123456789";

let colonyA: number;
let colonyB: number;
let catA: SeededCat;
let catB: SeededCat;
let catNowhere: SeededCat;
let hiddenA: SeededCat;
let eleni: Signed;
let staff: Signed;
const people: string[] = [];

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  colonyA = await newColony("A");
  colonyB = await newColony("B");
  catA = await seedCat(colonyA);
  catB = await seedCat(colonyB);
  catNowhere = await seedCat(null);
  hiddenA = await seedCat(colonyA);
  await hidePhoto(hiddenA.photoId);
  eleni = await guardianOn("placed-eleni", [colonyA]);
  staff = await signedPerson("placed-staff", ["staff"]);
  people.push(eleni.email, staff.email);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  for (const e of people) await removeTestPerson(e);
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const photo = (publicId: string, cookie: string, query = "") =>
  request(app).get(`/api/team/photos/${publicId}${query}`).set("Cookie", cookie);

const FORBIDDEN = [403, '{"error":"forbidden"}'];

describe("T5: the catalogue photo route takes its target from the photo's cat", () => {
  it("a guardian sees a photo of a cat in her colony", async () => {
    const res = await photo(catA.photoPublicId, eleni.cookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
  });

  it("refuses her a cat in another colony, and a cat in no colony, whatever the request names", async () => {
    for (const cat of [catB, catNowhere]) {
      for (const q of ["", `?colonyId=${colonyA}`, `?colony=${colonyA}`, `?colonyId[]=${colonyA}`]) {
        const res = await photo(cat.photoPublicId, eleni.cookie, q);
        expect([res.status, res.text], `${cat.id} ${q}`).toEqual(FORBIDDEN);
      }
    }
  });

  it("moving the cat into her colony gives it to her at the next request; moving it out takes it away", async () => {
    const cat = await seedCat(colonyB);
    expect((await photo(cat.photoPublicId, eleni.cookie)).status).toBe(403);
    await putInColony(cat.id, colonyA);
    expect((await photo(cat.photoPublicId, eleni.cookie)).status).toBe(200);
    await putInColony(cat.id, null);
    expect((await photo(cat.photoPublicId, eleni.cookie)).status).toBe(403);
  });

  it("a photo tied to two cats needs both cats' colonies", async () => {
    const mine = await seedCat(colonyA);
    const other = await seedCat(colonyB);
    expect((await photo(mine.photoPublicId, eleni.cookie)).status).toBe(200);
    // A sighting of the second cat that used the first cat's photo.
    await db.insert(sightingsTable).values({
      catId: other.id,
      deviceId: "vt-roles-sighting",
      photoId: mine.photoId,
      lat: 37.445,
      lng: 24.942,
    });
    expect((await photo(mine.photoPublicId, eleni.cookie)).status).toBe(403);
    expect((await photo(mine.photoPublicId, staff.cookie)).status).toBe(200);
  });

  it("a hidden photo goes only to a holder of hide_photo: the team, never a guardian", async () => {
    const res = await photo(hiddenA.photoPublicId, eleni.cookie);
    expect([res.status, res.text]).toEqual(FORBIDDEN);
    expect((await photo(hiddenA.photoPublicId, staff.cookie)).status).toBe(200);
  });

  it("the team sees every photo, in any colony or none", async () => {
    for (const cat of [catA, catB, catNowhere]) {
      expect((await photo(cat.photoPublicId, staff.cookie)).status).toBe(200);
    }
  });

  it("a missing photo is the team's 404 and the guardian's 403 (she learns nothing about which ids exist)", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await photo(missing, staff.cookie)).status).toBe(404);
    expect([(await photo(missing, eleni.cookie)).status]).toEqual([403]);
  });
});

describe("T6: a placement's end takes effect at the next request, by the database's clock", () => {
  it("ends at midnight Athens time at the end of the date, right across the 25 October 2026 clock change", () => {
    // Clocks go back at 04:00 Athens (01:00 UTC) on Sunday 25 October:
    // midnight that night is 22:00 UTC, not 21:00.
    expect(placementEndsAt("2026-10-25").toISOString()).toBe("2026-10-25T22:00:00.000Z");
    // Summer time: midnight Athens is 21:00 UTC.
    expect(placementEndsAt("2026-10-24").toISOString()).toBe("2026-10-24T21:00:00.000Z");
    expect(placementEndsAt("2026-07-01").toISOString()).toBe("2026-07-01T21:00:00.000Z");
    // Clocks go forward on 29 March 2026: that day already ends in summer time.
    expect(placementEndsAt("2026-03-28").toISOString()).toBe("2026-03-28T22:00:00.000Z");
    expect(placementEndsAt("2026-03-29").toISOString()).toBe("2026-03-29T21:00:00.000Z");
    expect(placementEndsAt("2026-12-31").toISOString()).toBe("2026-12-31T22:00:00.000Z");
  });

  it("refuses a date that isn't one", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "25/10/2026", "2026-10-25T00:00", ""]) {
      expect(() => placementEndsAt(bad), bad).toThrow();
    }
  });

  it("the database's own condition: in force at 21:59:59 UTC on 25 October, ended at 22:00:01", async () => {
    const g = await guardianOn("placed-athens", [colonyA]);
    people.push(g.email);
    await pool.query(`update person_scopes set expires_at = $2 where person_id = $1`, [
      g.id,
      placementEndsAt("2026-10-25"),
    ]);
    const inForceAt = async (iso: string) => {
      const r = await db.execute(
        sql`select count(*)::int as n from person_scopes
            where person_id = ${g.id} and ${scopeInForce(sql`${iso}::timestamptz`)}`,
      );
      return (r.rows[0] as { n: number }).n;
    };
    expect(await inForceAt("2026-10-25T21:59:59Z")).toBe(1);
    expect(await inForceAt("2026-10-25T22:00:01Z")).toBe(0);
    // The hour the clocks went back: 21:00 UTC is 23:00 Athens, still that day.
    expect(await inForceAt("2026-10-25T21:00:01Z")).toBe(1);
  });

  it("a placement still running works; the next request after its end gets 'Your access has ended', with no job run", async () => {
    const g = await guardianOn("placed-cover", [colonyA]);
    people.push(g.email);
    await pool.query(
      `update person_scopes set expires_at = now() + interval '1 hour' where person_id = $1`,
      [g.id],
    );
    expect((await photo(catA.photoPublicId, g.cookie)).status).toBe(200);
    expect((await request(app).get("/api/team/me").set("Cookie", g.cookie)).status).toBe(200);

    await endPlacements(g.id);
    const json = await request(app).get("/api/team/me").set("Cookie", g.cookie);
    expect([json.status, json.text]).toEqual(FORBIDDEN);
    const page = await request(app)
      .get("/api/team/me")
      .set("Cookie", g.cookie)
      .set("Sec-Fetch-Mode", "navigate");
    expect(page.status).toBe(403);
    expect(page.text).toContain("Your access has ended. Ask Syros Cats if you think that&#39;s a mistake.");
    expect(page.headers["cache-control"]).toBe("no-store");
    expect((await photo(catA.photoPublicId, g.cookie)).status).toBe(403);
  });

  it("is the database's clock, not the app's: an app clock an hour behind still sees the placement ended", async () => {
    const g = await guardianOn("placed-clock", [colonyA]);
    people.push(g.email);
    await endPlacements(g.id);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() - 60 * 60 * 1000));
    const res = await request(app).get("/api/team/me").set("Cookie", g.cookie);
    expect([res.status, res.text]).toEqual(FORBIDDEN);
  });

  it("one placement ending leaves her others working", async () => {
    const g = await guardianOn("placed-two", [colonyA, colonyB]);
    people.push(g.email);
    expect((await photo(catB.photoPublicId, g.cookie)).status).toBe(200);
    await pool.query(
      `update person_scopes set expires_at = now() - interval '1 second' where person_id = $1 and colony_id = $2`,
      [g.id, colonyB],
    );
    expect((await photo(catB.photoPublicId, g.cookie)).status).toBe(403);
    expect((await photo(catA.photoPublicId, g.cookie)).status).toBe(200);
    const me = await request(app).get("/api/team/me").set("Cookie", g.cookie);
    const where = (me.body.capabilities as { capability: string; where: unknown }[]).find(
      (c) => c.capability === "view_exact_location",
    )!.where;
    expect(where).toEqual([colonyA]);
  });
});
