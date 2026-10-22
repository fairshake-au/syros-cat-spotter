import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { like } from "drizzle-orm";
import { db, pool, sightingsTable } from "@workspace/db";
import app from "../app";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "../test/removeTestPerson";
import { deleteTestSightings } from "../test/sightings";
import { guardianOn, newColony, RUN, seedCat, signedPerson, type SeededCat, type Signed } from "../test/roleKit";

// SYC-396 PR 1.5 (spec §6.1, §10.2, §10.4; plan Task 1.5.2): the island map's
// cat positions. A signed-in POST with the grid's filters in the BODY, never
// the address; every matching cat, unpaged, at the place it was last seen
// (else first found). Team-only: a cat guardian gets the 403.

const KEY = "vitest-catpositions-key-0123456789abcdef-012345";
const DEVICE = `vt-catpos-${RUN}`;
let staff: Signed;
let guardian: Signed;
let colony: number;
let seen: SeededCat;
let neverSeen: SeededCat;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  colony = await newColony("catpositions");
  seen = await seedCat(colony);
  neverSeen = await seedCat(colony);
  await db.insert(sightingsTable).values({
    catId: seen.id,
    deviceId: DEVICE,
    photoId: seen.photoId,
    lat: 37.4436,
    lng: 24.8889,
    status: "resolved",
    createdAt: new Date(Date.now() - 3 * 86_400_000),
  });
  staff = await signedPerson("catpositions-staff", ["staff"]);
  guardian = await guardianOn("catpositions-guardian", [colony]);
});

afterAll(async () => {
  await deleteTestSightings(like(sightingsTable.deviceId, `${DEVICE}%`));
  await removeTestPerson(staff.email);
  await removeTestPerson(guardian.email);
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const positions = (who: Signed | undefined, body: unknown, path = "/api/team/cats/positions") => {
  const t = request(app).post(path).set("Origin", TEAM_ORIGIN).set("Accept", "application/json");
  return (who ? t.set("Cookie", who.cookie) : t).send(body as object);
};

interface Pos {
  id: number;
  name: string;
  mark: string;
  lat: number;
  lng: number;
  place: string;
  lastSeenAt: string | null;
  seen: string;
  colony: number | null;
  photo: string | null;
}

describe("the island map's cat positions", () => {
  it("gives every matching cat at its last-seen spot, else where it was first found, no-store", async () => {
    const res = await positions(staff, { colony: String(colony) });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const cats = res.body.cats as Pos[];
    expect(cats.map((c) => c.id).sort()).toEqual([seen.id, neverSeen.id].sort());
    const a = cats.find((c) => c.id === seen.id)!;
    expect([a.lat, a.lng]).toEqual([37.4436, 24.8889]);
    expect(a.lastSeenAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(a.mark).toBe("not_known");
    expect(a.place.length).toBeGreaterThan(0);
    expect(a.photo).toBe(`/api/team/photos/${seen.photoPublicId}/small`);
    const b = cats.find((c) => c.id === neverSeen.id)!;
    expect([b.lat, b.lng]).toEqual([37.445, 24.942]);
    expect(b.lastSeenAt).toBeNull();
    // Exactly these fields, nothing else about the cat.
    expect(Object.keys(a).sort()).toEqual(["colony", "id", "lastSeenAt", "lat", "lng", "mark", "name", "photo", "place", "seen"]);
    expect(a.colony).toBe(colony);
    expect(a.seen).toBe("Last seen 3 days ago");
    expect(b.seen).toBe("Never seen since first recorded");
  });

  it("takes the filters from the body, in the grid's shape", async () => {
    const none = await positions(staff, { colony: String(colony), sterilised: ["sterilised"] });
    expect(none.body.cats).toEqual([]);
    const some = await positions(staff, { colony: String(colony), sterilised: ["not_known"], lastSeen: "week" });
    expect((some.body.cats as Pos[]).map((c) => c.id)).toEqual([seen.id]);
  });

  it("ignores filters in the address: a ?area= or ?colony= query string does nothing", async () => {
    const withQuery = await positions(staff, { colony: String(colony) }, "/api/team/cats/positions?area=kini&sterilised=sterilised");
    expect(withQuery.status).toBe(200);
    expect((withQuery.body.cats as Pos[]).map((c) => c.id).sort()).toEqual([seen.id, neverSeen.id].sort());
    // A colony only in the address is no filter at all: more than our two cats come back.
    const onlyQuery = await positions(staff, {}, `/api/team/cats/positions?colony=${colony}`);
    expect(onlyQuery.status).toBe(200);
    const ids = (onlyQuery.body.cats as Pos[]).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([seen.id, neverSeen.id]));
  });

  it("is unpaged: a page number is ignored", async () => {
    const all = await positions(staff, {});
    const paged = await positions(staff, { page: "2" });
    // "Last seen 3 minutes ago" can tick over between the two calls (SYC-563),
    // so compare everything but that relative label.
    const settled = (cats: Pos[]) => cats.map(({ seen: _seen, ...rest }) => rest);
    expect((all.body.cats as Pos[]).length).toBeGreaterThan(0);
    expect(settled(paged.body.cats as Pos[])).toEqual(settled(all.body.cats as Pos[]));
  });

  it("anything odd in the body is no filter, never an error", async () => {
    for (const body of [[], "colony=1", { colony: { $gt: 0 } }, { colony: [String(colony), "2"] }]) {
      const res = await positions(staff, body);
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(Array.isArray(res.body.cats)).toBe(true);
    }
  });

  it("is the team's only: a cat guardian gets the 403 even for her own colony, nobody signed in the 401", async () => {
    const g = await positions(guardian, { colony: String(colony) });
    expect([g.status, g.body]).toEqual([403, { error: "forbidden" }]);
    expect((await positions(undefined, {})).status).toBe(401);
    const foreign = await request(app)
      .post("/api/team/cats/positions")
      .set("Origin", "https://evil.example")
      .set("Cookie", staff.cookie)
      .send({});
    expect(foreign.status).toBe(401);
  });
});
