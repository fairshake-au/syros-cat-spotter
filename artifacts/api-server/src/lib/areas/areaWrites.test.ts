import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, mappingEventsTable, namedAreasTable, peopleTable, pool } from "@workspace/db";
import { namedAreasAt } from "./areaHistory";
import { AreaChangeRefused, changeArea } from "./areaWrites";
import { areaByKey, areaFor, areasVersion, currentAreas, loadAreas, SEED_AREAS } from "./namedAreas";

// SYC-396 PR 2.4 (plan Task 2.4.2): changing the named areas, their history,
// and the list as it stood at a moment.
//
// The run's database is shared by every file, and mapping_events can't be
// cleaned up. So every area written here has this run's own key and name,
// sits in the sea off Syros's south-east corner (more than 2 km from every
// seed centre, so it never captures another file's places), and the seed
// rows are never moved, renamed or retired. Versions are asserted as deltas.

const RUN = crypto.randomBytes(3).toString("hex");
const key = (s: string) => `vt-${RUN}-${s}`;
const name = (s: string) => `VT ${RUN} ${s}`;
// Off Syros today: about 4 km from Fabrika, the nearest seed centre. Each
// areas test file has its own point, kilometres apart.
const SEA = { lat: 37.365, lng: 24.982 };
/** Two changes in one millisecond would share a moment; keep them apart. */
const tick = () => new Promise((r) => setTimeout(r, 5));

let person: { id: string };

beforeAll(async () => {
  const [p] = await db
    .insert(peopleTable)
    .values({ email: `areas-${RUN}@example.com`, name: "Jacky", addedBy: "cli:test" })
    .returning({ id: peopleTable.id });
  person = { id: p!.id };
  await loadAreas();
});

afterAll(async () => {
  await pool.end();
});

const eventsOf = async (k: string) => {
  const [row] = await db.select({ id: namedAreasTable.id }).from(namedAreasTable).where(eq(namedAreasTable.key, k));
  return db
    .select()
    .from(mappingEventsTable)
    .where(and(eq(mappingEventsTable.subjectKind, "named_area"), eq(mappingEventsTable.subjectId, row!.id)))
    .orderBy(mappingEventsTable.id);
};

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof AreaChangeRefused) return err.field;
    throw err;
  }
  throw new Error("expected a refusal");
};

describe("the seed, as namedAreasAt sees it", () => {
  it("from 15 Oct 2026 the list is the seed, as version 21", async () => {
    const at = await namedAreasAt(new Date("2026-10-15T00:00:00Z"));
    expect(at.version).toBe(21);
    expect(at.areas).toEqual(SEED_AREAS.map((a) => ({ ...a })));
  });

  it("before 15 Oct 2026 there's no history, so it falls back to the seed as version 0", async () => {
    const at = await namedAreasAt(new Date("2026-10-14T23:59:59Z"));
    expect(at).toEqual({ version: 0, areas: SEED_AREAS.map((a) => ({ ...a })) });
  });

  it("the loaded list gives the same answer as the seed for every seed centre", () => {
    for (const a of SEED_AREAS) expect(areaFor(a.lat, a.lng).key).toBe(a.key);
    expect(areasVersion()).toBeGreaterThanOrEqual(21);
  });
});

describe("changeArea", () => {
  it("adds an area, in the list at once, with a history row holding the whole row", async () => {
    const v = areasVersion();
    await changeArea(person, { kind: "add", key: key("add"), name: name("Add"), ...SEA });
    expect(areaByKey(key("add"))).toMatchObject({ name: name("Add"), ...SEA });
    expect(areaFor(SEA.lat, SEA.lng).key).toBe(key("add"));
    expect(areasVersion()).toBe(v + 1);
    const [e] = await eventsOf(key("add"));
    expect(e).toMatchObject({ kind: "area_added", personId: person.id, before: null });
    expect(e!.after).toEqual({ key: key("add"), name: name("Add"), ...SEA, retired: false });
    await changeArea(person, { kind: "retire", key: key("add") });
  });

  it("moves a centre: namedAreasAt before the move gives the old centre, after it the new one", async () => {
    const k = key("move");
    await changeArea(person, { kind: "add", key: k, name: name("Move"), ...SEA });
    await tick();
    await changeArea(person, { kind: "move", key: k, lat: 37.366, lng: 24.981 });
    // This server sees it at once: the old centre is now nearest the moved one.
    expect(areaFor(SEA.lat, SEA.lng)).toMatchObject({ key: k, lat: 37.366, lng: 24.981 });

    const events = await eventsOf(k);
    const moved = events.at(-1)!;
    expect(moved.kind).toBe("area_moved");
    const before = await namedAreasAt(new Date(moved.at.getTime() - 1));
    const after = await namedAreasAt(moved.at);
    expect(before.areas.find((a) => a.key === k)).toMatchObject(SEA);
    expect(after.areas.find((a) => a.key === k)).toMatchObject({ lat: 37.366, lng: 24.981 });
    expect(after.version).toBe(before.version + 1);
    // before and after always hold the whole row.
    expect(moved.before).toEqual({ key: k, name: name("Move"), ...SEA, retired: false });
    expect(moved.after).toEqual({ key: k, name: name("Move"), lat: 37.366, lng: 24.981, retired: false });
    await changeArea(person, { kind: "retire", key: k });
  });

  it("renames, keeping the key", async () => {
    const k = key("ren");
    await changeArea(person, { kind: "add", key: k, name: name("Ren"), ...SEA });
    await changeArea(person, { kind: "rename", key: k, name: name("Renamed") });
    expect(areaByKey(k)?.name).toBe(name("Renamed"));
    const e = (await eventsOf(k)).at(-1)!;
    expect(e.kind).toBe("area_renamed");
    expect(e.before).toEqual({ key: k, name: name("Ren"), ...SEA, retired: false });
    expect(e.after).toEqual({ key: k, name: name("Renamed"), ...SEA, retired: false });
    await changeArea(person, { kind: "retire", key: k });
  });

  it("a retired area drops out of the list now, but stays in namedAreasAt for earlier moments", async () => {
    const k = key("ret");
    await changeArea(person, { kind: "add", key: k, name: name("Ret"), ...SEA });
    await tick();
    await changeArea(person, { kind: "retire", key: k });
    expect(areaByKey(k)).toBeUndefined();
    expect(currentAreas().some((a) => a.key === k)).toBe(false);
    const events = await eventsOf(k);
    const retired = events.at(-1)!;
    expect(retired.kind).toBe("area_retired");
    expect(retired.after).toEqual({ key: k, name: name("Ret"), ...SEA, retired: true });
    expect((await namedAreasAt(new Date(retired.at.getTime() - 1))).areas.some((a) => a.key === k)).toBe(true);
    expect((await namedAreasAt(retired.at)).areas.some((a) => a.key === k)).toBe(false);
    // And a retired area can't be changed again.
    expect(await refusal(changeArea(person, { kind: "rename", key: k, name: name("Back") }))).toBe("area");
  });

  it("refuses a centre at Mykonos", async () => {
    expect(
      await refusal(changeArea(person, { kind: "add", key: key("myk"), name: name("Myk"), lat: 37.45, lng: 25.33 })),
    ).toBe("lng");
    expect(areaByKey(key("myk"))).toBeUndefined();
  });

  it("refuses a name another area in use has, in any case, and changes nothing", async () => {
    const v = areasVersion();
    expect(await refusal(changeArea(person, { kind: "add", key: key("dup"), name: "kini", ...SEA }))).toBe("name");
    expect(areaByKey(key("dup"))).toBeUndefined();
    expect(areasVersion()).toBe(v);
  });

  it("refuses the key off, a used key, a short name, and a change to an area that doesn't exist", async () => {
    expect(await refusal(changeArea(person, { kind: "add", key: "off", name: name("Off"), ...SEA }))).toBe("key");
    expect(await refusal(changeArea(person, { kind: "add", key: "kini", name: name("K"), ...SEA }))).toBe("key");
    expect(await refusal(changeArea(person, { kind: "add", key: key("x"), name: " a ", ...SEA }))).toBe("name");
    expect(await refusal(changeArea(person, { kind: "move", key: key("nope"), ...SEA }))).toBe("area");
  });
});
