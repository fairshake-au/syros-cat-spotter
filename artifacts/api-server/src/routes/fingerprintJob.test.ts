import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, like, sql } from "drizzle-orm";
import { catsTable, db, photosTable, pool, sightingsTable } from "@workspace/db";

// SYC-527 piece 3, Task 9 (spec docs/specs/find-from-a-photo-whole-island.md
// §7): the nightly batch's route. The model is stubbed (deterministic
// vectors, fast). The test database is shared, so everything is seeded under
// this run's prefix and only this run's own photo ids are asserted on; "the
// island" is narrowed to this file's own cats by the same seam the find
// tests use.

const TOKEN = "vitest-fingerprint-job-token-0123456789";
const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-fpjob-${RUN}-`;

vi.mock("../lib/fingerprint/model", async (orig) => {
  const real = (await orig()) as typeof import("../lib/fingerprint/model");
  return {
    ...real,
    fingerprintOf: vi.fn(async () => {
      const v = new Float32Array(real.DIMENSIONS);
      v[0] = 1;
      return v;
    }),
  };
});
vi.mock("../lib/teamCatList", async (orig) => {
  const real = (await orig()) as typeof import("../lib/teamCatList");
  return {
    ...real,
    allTeamCats: vi.fn(async (f: Parameters<typeof real.allTeamCats>[0], now?: Date) => {
      const out = await real.allTeamCats(f, now);
      if (f.area !== undefined || f.colony !== undefined) return out;
      const cats = out.cats.filter((c) => c.name.startsWith(PREFIX));
      return { ...out, cats, catCount: cats.length };
    }),
  };
});

import app from "../app";
import { fingerprintOf } from "../lib/fingerprint/model";
import { setPhotoVisibility } from "../lib/photoVisibility";
import { deleteTestSightings } from "../test/sightings";

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let n = 0;
let staff: { id: string; scopes: { role: string; colonyId: number | null }[] };
const call = () => request(app).post("/api/internal/fingerprints/nightly");

async function seedPhoto(): Promise<{ id: number; publicId: string }> {
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}photo-${n++}`, data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning({ id: photosTable.id, publicId: photosTable.publicId });
  return p!;
}

async function seedCat(primaryPhotoId: number): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({ name: `${PREFIX}cat-${n++}`, primaryPhotoId, lat: 37.4447, lng: 24.9417, discovererDeviceId: `${PREFIX}d` })
    .returning({ id: catsTable.id });
  return c!.id;
}

async function haveRows(ids: number[]): Promise<number[]> {
  const r = await db.execute<{ photo_id: number }>(
    sql`select photo_id from photo_fingerprints where photo_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`,
  );
  return r.rows.map((x) => x.photo_id).sort((a, b) => a - b);
}

beforeAll(async () => {
  const p = await db.execute<{ id: string }>(sql`
    insert into people (email, name, added_by, accepted_at)
    values (${`${PREFIX}staff@example.com`}, 'Staff', 'cli:test', now()) returning id`);
  const id = p.rows[0]!.id;
  await db.execute(sql`insert into person_scopes (person_id, role, reach) values (${id}, 'staff', 'island')`);
  staff = { id, scopes: [{ role: "staff", colonyId: null }] };
});

beforeEach(() => {
  process.env["FINGERPRINT_JOB_TOKEN"] = TOKEN;
  vi.mocked(fingerprintOf).mockClear();
});

afterEach(async () => {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
});

afterAll(async () => {
  await db.delete(photosTable).where(
    and(
      like(photosTable.publicId, `${PREFIX}%`),
      sql`not exists (select 1 from photo_visibility_events e where e.photo_id = ${photosTable.id})`,
    ),
  );
  await pool.end();
});

describe("POST /api/internal/fingerprints/nightly", () => {
  it("no token or a wrong token gets 401 and does no work", async () => {
    const p = await seedPhoto();
    await seedCat(p.id);
    expect((await call()).status).toBe(401);
    expect((await call().set("Authorization", "Bearer nope")).status).toBe(401);
    // Another job's token does not open it.
    process.env["NEWS_JOB_TOKEN"] = "vitest-news-token-other";
    expect((await call().set("Authorization", "Bearer vitest-news-token-other")).status).toBe(401);
    expect(fingerprintOf).not.toHaveBeenCalled();
    expect(await haveRows([p.id])).toEqual([]);
    delete process.env["FINGERPRINT_JOB_TOKEN"];
    expect((await call().set("Authorization", `Bearer ${TOKEN}`)).status).toBe(503);
  });

  it("the pre-launch gate lets only the right token through", async () => {
    const before = process.env["PRELAUNCH_GATE"];
    process.env["PRELAUNCH_GATE"] = "on";
    try {
      expect((await call()).status).toBe(401);
      expect((await call().set("Authorization", "Bearer wrong")).status).toBe(401);
      const people = process.env["INTERNAL_PEOPLE_TOKEN"];
      process.env["INTERNAL_PEOPLE_TOKEN"] = "vitest-people-token-other";
      try {
        expect((await call().set("Authorization", "Bearer vitest-people-token-other")).status).toBe(401);
      } finally {
        if (people === undefined) delete process.env["INTERNAL_PEOPLE_TOKEN"];
        else process.env["INTERNAL_PEOPLE_TOKEN"] = people;
      }
      expect(fingerprintOf).not.toHaveBeenCalled();
      expect((await call().set("Authorization", `Bearer ${TOKEN}`)).status).toBe(200);
      // The job token opens nothing else.
      expect((await request(app).post("/api/internal/mail/drain").set("Authorization", `Bearer ${TOKEN}`)).status).toBe(401);
    } finally {
      if (before === undefined) delete process.env["PRELAUNCH_GATE"];
      else process.env["PRELAUNCH_GATE"] = before;
    }
  });

  it("the right token fills the missing fingerprints and answers with counts; a second run makes none", async () => {
    const photos = [await seedPhoto(), await seedPhoto(), await seedPhoto()];
    for (const p of photos) await seedCat(p.id);
    const ids = photos.map((p) => p.id);
    const first = await call().set("Authorization", `Bearer ${TOKEN}`);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ made: 3, failed: 0, left: 0 });
    expect(await haveRows(ids)).toEqual(ids);
    const calls = vi.mocked(fingerprintOf).mock.calls.length;
    const second = await call().set("Authorization", `Bearer ${TOKEN}`);
    expect(second.body).toEqual({ made: 0, failed: 0, left: 0 });
    expect(vi.mocked(fingerprintOf).mock.calls.length).toBe(calls);
    expect(await haveRows(ids)).toEqual(ids);
  });

  it("a hidden display photo's stand-in is the one fingerprinted", async () => {
    const main = await seedPhoto();
    const standIn = await seedPhoto();
    const catId = await seedCat(main.id);
    await db.insert(sightingsTable).values({
      catId,
      deviceId: `${PREFIX}d`,
      photoId: standIn.id,
      lat: 37.4447,
      lng: 24.9417,
      status: "resolved",
    });
    expect((await setPhotoVisibility(staff, { publicId: main.publicId, action: "hide" })).kind).toBe("changed");
    const res = await call().set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ made: 1, failed: 0, left: 0 });
    expect(await haveRows([main.id, standIn.id])).toEqual([standIn.id]);
  });
});
