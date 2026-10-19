import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, peopleTable, pool } from "@workspace/db";
import { changeArea } from "./areaWrites";
import * as here from "./namedAreas";

// SYC-396 PR 2.4 (plan Task 2.4.2): the named-areas cache. `here` plays one
// server; a second copy of the module, loaded after vi.resetModules(), plays
// the server that makes the change. Areas written here use this run's own
// key and sit in the sea off Syros's south-west corner (see areaWrites.test.ts).

const RUN = crypto.randomBytes(3).toString("hex");
const K = `vt-${RUN}-cache`;
// Its own point (each areas test file has one, kilometres apart): the sea off
// the south-west corner, about 3.7 km from Posidonia.
const SEA = { lat: 37.362, lng: 24.863 };
const MOVED = { lat: 37.363, lng: 24.864 };

type Areas = typeof here;
let other: Areas;
let otherWrites: typeof import("./areaWrites");
let otherDb: typeof import("@workspace/db");
let person: { id: string };

beforeAll(async () => {
  const [p] = await db
    .insert(peopleTable)
    .values({ email: `areas-cache-${RUN}@example.com`, name: "Jacky", addedBy: "cli:test" })
    .returning({ id: peopleTable.id });
  person = { id: p!.id };
  vi.resetModules();
  other = await import("./namedAreas");
  otherWrites = await import("./areaWrites");
  otherDb = await import("@workspace/db");
});

afterAll(async () => {
  vi.useRealTimers();
  await pool.end();
  await otherDb.pool.end().catch(() => {});
});

describe("before the first load", () => {
  it("answers from the seed, as version 0", () => {
    expect(here.currentAreas()).toBe(here.SEED_AREAS);
    expect(here.areasVersion()).toBe(0);
    for (const a of here.SEED_AREAS) expect(here.areaFor(a.lat, a.lng)).toBe(a);
  });
});

describe("after a change on another server", () => {
  it("the changing server sees it at once; this one within AREAS_TTL_MS", async () => {
    await here.loadAreas();
    await other.loadAreas();
    for (const a of here.SEED_AREAS) expect(here.areaFor(a.lat, a.lng).key).toBe(a.key);
    expect(here.areaFor(SEA.lat, SEA.lng)).toBe(here.OFF_SYROS);

    await otherWrites.changeArea(person, { kind: "add", key: K, name: `VT ${RUN} Cache`, ...SEA });
    await otherWrites.changeArea(person, { kind: "move", key: K, ...MOVED });
    expect(other.areaFor(SEA.lat, SEA.lng)).toMatchObject({ key: K, ...MOVED });
    // This server's cache is still fresh, so it still has the old list.
    expect(here.areaFor(SEA.lat, SEA.lng)).toBe(here.OFF_SYROS);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + here.AREAS_TTL_MS + 1_000);
    // The stale call answers at once from what it has, and starts a reload.
    expect(here.areaFor(SEA.lat, SEA.lng)).toBe(here.OFF_SYROS);
    await vi.waitFor(() => expect(here.areaFor(SEA.lat, SEA.lng)).toMatchObject({ key: K, ...MOVED }));
    expect(here.areasVersion()).toBe(other.areasVersion());
    vi.useRealTimers();
  });

  it("a reload that fails keeps the last good list", async () => {
    const before = other.currentAreas();
    expect(before.length).toBeGreaterThan(0);
    await otherDb.pool.end();
    await other.loadAreas();
    expect(other.currentAreas()).toBe(before);
    expect(other.areaFor(MOVED.lat, MOVED.lng).key).toBe(K);
  });

  it("afterwards, retires the run's area through this server's own writer and pool", async () => {
    await changeArea(person, { kind: "retire", key: K });
    expect(here.areaByKey(K)).toBeUndefined();
  });
});
