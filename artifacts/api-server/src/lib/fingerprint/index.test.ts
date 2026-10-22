import { randomBytes } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db, photosTable } from "@workspace/db";
import { setPhotoVisibility } from "../photoVisibility";
import { markRemoved } from "../../test/removalKit";

// SYC-527 piece 3, spec docs/specs/find-from-a-photo-whole-island.md §3
// ("Two searches at once"), §6.2 and §7: saving, reading, ranking and filling
// fingerprints. The model is stubbed here (fast, and no 30 MB load): what is
// under test is the bookkeeping around it. The hide-versus-save race, run
// with two real connections, is in privacy.test.ts.
//
// Everything is seeded under this run's prefix, and only this run's ids are
// asserted on (the test database is shared).

const model = vi.hoisted(() => ({
  calls: 0,
  /** Run on every stubbed fingerprintOf call, before it returns. */
  onCall: undefined as undefined | (() => Promise<void> | void),
  fail: false,
}));

vi.mock("./model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./model")>();
  return {
    ...actual,
    fingerprintOf: vi.fn(async () => {
      model.calls += 1;
      await model.onCall?.();
      if (model.fail) throw new actual.FingerprintUnavailable("stubbed failure");
      return unit(0);
    }),
  };
});

import { DIMENSIONS, MODEL_ID } from "./model";
import { __fillClock, fillMissing, fingerprintsFor, rank, saveFingerprint } from "./index";

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-fp-index-${RUN}-`;
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

/** A length-1 vector pointing along axis `i`. */
function unit(i: number): Float32Array {
  const v = new Float32Array(DIMENSIONS);
  v[i] = 1;
  return v;
}

/** A length-1 vector in the plane of axes 0 and 1, at `deg` degrees from axis 0. */
function at(deg: number): Float32Array {
  const v = new Float32Array(DIMENSIONS);
  v[0] = Math.cos((deg * Math.PI) / 180);
  v[1] = Math.sin((deg * Math.PI) / 180);
  return v;
}

let n = 0;
let staff: { id: string; scopes: { role: string; colonyId: number | null }[] };

async function seedPhoto(): Promise<{ id: number; publicId: string }> {
  n += 1;
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}photo-${n}`, data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning({ id: photosTable.id, publicId: photosTable.publicId });
  return p!;
}

async function seedPhotos(count: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < count; i += 1) ids.push((await seedPhoto()).id);
  return ids;
}

async function rowOf(photoId: number): Promise<{ model: string; vector: number[]; made_at: Date } | undefined> {
  const r = await db.execute<{ model: string; vector: number[]; made_at: Date }>(
    sql`select model, vector, made_at from photo_fingerprints where photo_id = ${photoId}`,
  );
  return r.rows[0];
}

beforeAll(async () => {
  const p = await db.execute<{ id: string }>(sql`
    insert into people (email, name, added_by, accepted_at)
    values (${`${PREFIX}staff@example.com`}, 'Staff', 'cli:test', now()) returning id`);
  const id = p.rows[0]!.id;
  await db.execute(sql`insert into person_scopes (person_id, role, reach) values (${id}, 'staff', 'island')`);
  staff = { id, scopes: [{ role: "staff", colonyId: null }] };
});

afterEach(() => {
  model.calls = 0;
  model.onCall = undefined;
  model.fail = false;
  __fillClock.now = () => Date.now();
});

describe("rank", () => {
  it("orders photo ids by closeness, largest dot product first", () => {
    const rows = new Map<number, Float32Array>([
      [10, at(80)],
      [11, at(5)],
      [12, at(40)],
      [13, at(170)],
    ]);
    expect(rank(at(0), rows, 4)).toEqual([11, 12, 10, 13]);
  });

  it("breaks ties by the lower photo id, whatever the map's order", () => {
    const rows = new Map<number, Float32Array>([
      [30, at(20)],
      [7, at(20)],
      [19, at(20)],
      [2, at(60)],
    ]);
    expect(rank(at(0), rows, 4)).toEqual([7, 19, 30, 2]);
  });

  it("keeps only the closest k; k of 0 or less gives none; k past the size gives all", () => {
    const rows = new Map<number, Float32Array>([
      [1, at(50)],
      [2, at(10)],
      [3, at(30)],
    ]);
    expect(rank(at(0), rows, 2)).toEqual([2, 3]);
    expect(rank(at(0), rows, 0)).toEqual([]);
    expect(rank(at(0), rows, -1)).toEqual([]);
    expect(rank(at(0), rows, 99)).toEqual([2, 3, 1]);
    expect(rank(at(0), new Map(), 5)).toEqual([]);
  });
});

describe("saveFingerprint and fingerprintsFor", () => {
  it("saves a fingerprint, and reads it back as the same numbers", async () => {
    const a = await seedPhoto();
    const v = at(33);
    expect(await saveFingerprint(a.id, v)).toBe("saved");
    const row = await rowOf(a.id);
    expect(row?.model).toBe(MODEL_ID);
    const got = await fingerprintsFor([a.id]);
    expect([...got.keys()]).toEqual([a.id]);
    expect(got.get(a.id)).toBeInstanceOf(Float32Array);
    expect(Array.from(got.get(a.id)!)).toEqual(Array.from(v));
  });

  it("returns hidden_or_removed for a hidden photo, and writes nothing", async () => {
    const a = await seedPhoto();
    expect((await setPhotoVisibility(staff, { publicId: a.publicId, action: "hide" })).kind).toBe("changed");
    expect(await saveFingerprint(a.id, unit(0))).toBe("hidden_or_removed");
    expect(await rowOf(a.id)).toBeUndefined();
  });

  it("returns hidden_or_removed for a removed photo, and for a photo that doesn't exist", async () => {
    const a = await seedPhoto();
    await markRemoved(a.id, staff.id);
    expect(await saveFingerprint(a.id, unit(0))).toBe("hidden_or_removed");
    expect(await rowOf(a.id)).toBeUndefined();
    const missing = 2_000_000_000;
    expect(await saveFingerprint(missing, unit(0))).toBe("hidden_or_removed");
  });

  it("saves again once a hidden photo is restored", async () => {
    const a = await seedPhoto();
    await setPhotoVisibility(staff, { publicId: a.publicId, action: "hide" });
    await setPhotoVisibility(staff, { publicId: a.publicId, action: "restore" });
    expect(await saveFingerprint(a.id, unit(0))).toBe("saved");
    expect((await rowOf(a.id))?.model).toBe(MODEL_ID);
  });

  it("replaces another model's fingerprint, and leaves a same-model one alone", async () => {
    const a = await seedPhoto();
    const b = await seedPhoto();
    await db.execute(
      sql`insert into photo_fingerprints (photo_id, model, vector) values (${a.id}, 'old-model/v0', array_fill(0.05::real, array[384]))`,
    );
    expect(await saveFingerprint(a.id, unit(3))).toBe("saved");
    const replaced = await rowOf(a.id);
    expect(replaced?.model).toBe(MODEL_ID);
    expect(replaced?.vector[3]).toBe(1);

    expect(await saveFingerprint(b.id, unit(4))).toBe("saved");
    const first = await rowOf(b.id);
    expect(await saveFingerprint(b.id, unit(5))).toBe("saved");
    const second = await rowOf(b.id);
    expect(second?.vector[4]).toBe(1);
    expect(second?.vector[5]).toBe(0);
    expect(second?.made_at).toEqual(first?.made_at);
  });

  it("refuses a vector of the wrong length (a programming error)", async () => {
    const a = await seedPhoto();
    await expect(saveFingerprint(a.id, new Float32Array(10))).rejects.toThrow(/384/);
    expect(await rowOf(a.id)).toBeUndefined();
  });

  it("fingerprintsFor reads only the current model's rows, and only the ids asked for", async () => {
    const [a, b, c] = await seedPhotos(3);
    await saveFingerprint(a!, unit(1));
    await db.execute(
      sql`insert into photo_fingerprints (photo_id, model, vector) values (${b!}, 'old-model/v0', array_fill(0.05::real, array[384]))`,
    );
    await saveFingerprint(c!, unit(2));
    const got = await fingerprintsFor([a!, b!]);
    expect([...got.keys()]).toEqual([a]);
    expect((await fingerprintsFor([])).size).toBe(0);
  });
});

describe("fillMissing", () => {
  it("fingerprints only the photos with no current-model fingerprint", async () => {
    const [a, b, c] = await seedPhotos(3);
    await saveFingerprint(b!, unit(7));
    const out = await fillMissing([c!, a!, b!], 60_000);
    expect(out).toEqual({ made: 2, failed: 0, left: [] });
    expect(model.calls).toBe(2);
    expect([...(await fingerprintsFor([a!, b!, c!])).keys()].sort((x, y) => x - y)).toEqual([a, b, c]);
    // b's own fingerprint was not touched.
    expect((await rowOf(b!))?.vector[7]).toBe(1);
  });

  it("stops starting photos at the budget, and returns what was left, oldest first", async () => {
    const ids = await seedPhotos(5);
    let now = 1_000;
    __fillClock.now = () => now;
    // Each photo takes 10 "ms". Budget 25: photos start at 0, 10 and 20; the
    // fourth would start at 30, past the budget.
    model.onCall = () => {
      now += 10;
    };
    const out = await fillMissing([...ids].reverse(), 25);
    expect(out).toEqual({ made: 3, failed: 0, left: ids.slice(3) });
    const done = await fingerprintsFor(ids);
    expect([...done.keys()].sort((x, y) => x - y)).toEqual(ids.slice(0, 3));
  });

  it("a budget of 0 starts nothing, and leaves every missing photo", async () => {
    const ids = await seedPhotos(2);
    __fillClock.now = () => 5;
    expect(await fillMissing(ids, 0)).toEqual({ made: 0, failed: 0, left: ids });
    expect(model.calls).toBe(0);
  });

  it("counts a hidden photo, a removed photo and a model failure as failed, and stores nothing for them", async () => {
    const hidden = await seedPhoto();
    const [removed, broken] = await seedPhotos(2);
    expect((await setPhotoVisibility(staff, { publicId: hidden.publicId, action: "hide" })).kind).toBe("changed");
    await markRemoved(removed!, staff.id);
    expect(await fillMissing([hidden.id, removed!], 60_000)).toEqual({ made: 0, failed: 2, left: [] });
    model.fail = true;
    expect(await fillMissing([broken!], 60_000)).toEqual({ made: 0, failed: 1, left: [] });
    for (const id of [hidden.id, removed!, broken!]) expect(await rowOf(id)).toBeUndefined();
  });

  it("two fills at once fingerprint each photo once", async () => {
    const ids = await seedPhotos(4);
    // Slow enough that the second call arrives while the first is working.
    model.onCall = () => new Promise((r) => setTimeout(r, 20));
    const [first, second] = await Promise.all([fillMissing(ids, 60_000), fillMissing(ids, 60_000)]);
    expect(model.calls).toBe(4);
    expect(first).toEqual({ made: 4, failed: 0, left: [] });
    expect(second).toEqual({ made: 0, failed: 0, left: [] });
    expect((await fingerprintsFor(ids)).size).toBe(4);
  });

  it("a second fill waits for the first, then fills what is still missing within its own budget", async () => {
    const [a, b, c] = await seedPhotos(3);
    let now = 0;
    __fillClock.now = () => now;
    model.onCall = () => {
      now += 10;
    };
    // The first fill has budget for one photo (it starts a at 0; b would
    // start at 10, past its 5). The second is called at 0 too, with budget
    // 15, and waits for the first. Its budget runs from its own call, so the
    // 10 spent waiting counts: it starts b at 10 and stops before c at 20.
    // (Timed from the end of the wait instead, it would do c as well.)
    const [first, second] = await Promise.all([fillMissing([a!, b!, c!], 5), fillMissing([a!, b!, c!], 15)]);
    expect(first).toEqual({ made: 1, failed: 0, left: [b, c] });
    expect(second).toEqual({ made: 1, failed: 0, left: [c] });
    expect(model.calls).toBe(2);
  });

  it("after a fill ends, even with every photo failed, the next fill runs", async () => {
    const [a] = await seedPhotos(1);
    model.fail = true;
    expect(await fillMissing([a!], 60_000)).toEqual({ made: 0, failed: 1, left: [] });
    model.fail = false;
    expect(await fillMissing([a!], 60_000)).toEqual({ made: 1, failed: 0, left: [] });
    expect((await fingerprintsFor([a!])).size).toBe(1);
  });
});
