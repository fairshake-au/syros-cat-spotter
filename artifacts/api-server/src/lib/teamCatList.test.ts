import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { catIdentityTable, catsTable, db, observationsTable, photosTable, sightingsTable } from "@workspace/db";
import { deleteTestSightings } from "../test/sightings";
import { newColony, putInColony } from "../test/roleKit";
import { listTeamCats, livesOf, loadTeamCats, markOf, PAGE_SIZE } from "./teamCatList";
import { loadCatRecords } from "./observations";
import { resolveCat, type CatSnapshot } from "./resolve";

// SYC-396 PR 1.3, Task 1.3.1: the team's list of every cat.

describe("markOf: the four sterilisation marks", () => {
  it.each([
    [{ value: true, confidence: "confirmed" }, "sterilised"],
    [{ value: true, confidence: "likely" }, "probably"],
    [{ value: false, confidence: "confirmed" }, "not_sterilised"],
    [{ value: null, confidence: "unknown" }, "not_known"],
    [{ value: true, confidence: "reported" }, "not_known"],
    [{ value: false, confidence: "reported" }, "not_known"],
    [{ value: false, confidence: "likely" }, "not_known"],
  ])("markOf(%o) is %s", (s, want) =>
    expect(markOf({ ...s, asOf: "", clippedTipSightings: 0 } as never)).toBe(want),
  );
});

describe("livesOf", () => {
  const snap = (o: Partial<CatSnapshot>) => o as CatSnapshot;
  it("a presumed-deceased street cat is gone", () => {
    expect(livesOf(snap({ lifeStatus: "street", presumedDeceased: true }))).toBe("gone");
  });
  it("deceased is gone", () => {
    expect(livesOf(snap({ lifeStatus: "deceased", presumedDeceased: false }))).toBe("gone");
  });
  it("street, homed and in care are themselves", () => {
    for (const l of ["street", "homed", "in_care"] as const) {
      expect(livesOf(snap({ lifeStatus: l, presumedDeceased: false }))).toBe(l);
    }
  });
});

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-list-${RUN}-`;
// loadTeamCats's own cats (SYC-396 PR 2.0), kept out of the grid tests' name box.
const LOAD = `vt-load-${RUN}-`;
const DEVICE = `${PREFIX}device`;
const NOW = new Date("2026-10-15T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

let photoId: number;
let colonyA: number;
const ids: Record<string, number> = {};

async function cat(key: string, o: Partial<typeof catsTable.$inferInsert> = {}) {
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}${key}`,
      primaryPhotoId: photoId,
      lat: 37.4447,
      lng: 24.9417, // Ermoupoli
      discovererDeviceId: DEVICE,
      ...o,
    })
    .returning({ id: catsTable.id });
  ids[key] = c!.id;
  return c!.id;
}

async function say(catId: number, kind: string, value: unknown, observedAt = daysAgo(40)) {
  await db.insert(observationsTable).values({
    catId,
    kind,
    value: value as never,
    deviceId: DEVICE,
    roleAtTime: "staff",
    observedAt,
  });
}

async function sighted(catId: number, when: Date, lat: number, lng: number, status = "resolved") {
  await db.insert(sightingsTable).values({
    catId,
    deviceId: DEVICE,
    photoId,
    lat,
    lng,
    status,
    createdAt: when,
  });
}

const mine = <T extends { name: string }>(items: T[]) => items.filter((i) => i.name.startsWith(PREFIX));
const names = (items: { name: string }[]) => mine(items).map((i) => i.name.slice(PREFIX.length));
const list = (f: Parameters<typeof listTeamCats>[0] = {}) =>
  listTeamCats({ q: PREFIX, ...f }, NOW);

async function cleanup() {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${LOAD}%`));
  await db.delete(photosTable).where(like(photosTable.publicId, `${PREFIX}%`));
}

beforeAll(async () => {
  await cleanup();
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}photo`, data: Buffer.from("x").toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  photoId = p!.id;
  colonyA = await newColony("list");

  // Ginger, sterilised, in the colony, seen 2 days ago at Kini.
  await cat("Ginger");
  await say(ids["Ginger"]!, "coat", { colours: ["ginger"] });
  await say(ids["Ginger"]!, "sterilised", { sterilised: true });
  await putInColony(ids["Ginger"]!, colonyA);
  await sighted(ids["Ginger"]!, daysAgo(2), 37.4436, 24.8889);

  // Black, not sterilised, no colony, seen 20 days ago in Ermoupoli.
  await cat("Black");
  await say(ids["Black"]!, "coat", { colours: ["black"] });
  await say(ids["Black"]!, "sterilised", { sterilised: false });
  await sighted(ids["Black"]!, daysAgo(20), 37.4447, 24.9417);

  // Never seen again; found at Vari. No colour known.
  await cat("Never", { lat: 37.3983488, lng: 24.9467109 });

  // Two resolved sightings (Galissas 10 days ago, Finikas 4 days ago), then a
  // NEWER pending one (Vari) and a NEWER awaiting_team one (Posidonia).
  await cat("Mixed");
  await sighted(ids["Mixed"]!, daysAgo(10), 37.4226, 24.8825);
  await sighted(ids["Mixed"]!, daysAgo(4), 37.3976, 24.8783);
  await sighted(ids["Mixed"]!, daysAgo(2.5), 37.3983, 24.9467, "pending");
  await sighted(ids["Mixed"]!, daysAgo(1), 37.3889, 24.8874, "awaiting_team");

  // Two resolved sightings at exactly the same moment: the later row wins.
  await cat("Tie");
  const same = daysAgo(6);
  await sighted(ids["Tie"]!, same, 37.4436, 24.8889); // Kini, first row
  await sighted(ids["Tie"]!, same, 37.4447, 24.9417); // Ermoupoli, second row

  // No longer with us.
  await cat("Gone");
  await say(ids["Gone"]!, "life_status", { status: "deceased" });
});

afterAll(cleanup);

describe("listTeamCats", () => {
  it("lists cats with no filters, most recently seen first, never-seen last", async () => {
    const r = await list();
    expect(names(r.items)).toEqual(["Ginger", "Mixed", "Tie", "Black", "Never"]);
    expect(r.total).toBe(5);
  });

  it("hides cats who are gone by default, and shows them when asked", async () => {
    expect(names((await list()).items)).not.toContain("Gone");
    expect(names((await list({ lives: ["gone"] })).items)).toEqual(["Gone"]);
  });

  it("includes a cat with no colony", async () => {
    const r = mine((await list()).items);
    expect(r.find((i) => i.name.endsWith("Black"))!.colonyId).toBeNull();
    expect(r.find((i) => i.name.endsWith("Ginger"))!.colonyId).toBe(colonyA);
  });

  it("last seen comes from the newest RESOLVED sighting, never a newer pending or awaiting one", async () => {
    const m = mine((await list()).items).find((i) => i.name.endsWith("Mixed"))!;
    expect(m.lastSeenAt!.getTime()).toBe(daysAgo(4).getTime());
    expect(m.place).toBe("Finikas");
    expect(m.lastSeen).toEqual({ lat: 37.3976, lng: 24.8783 });
  });

  it("two resolved sightings at the same moment: the later row wins", async () => {
    const t = mine((await list()).items).find((i) => i.name.endsWith("Tie"))!;
    expect(t.place).toBe("Ermoupoli");
  });

  it("counts every cat, so the page can tell 'none yet' from 'all hidden'", async () => {
    const r = await list();
    expect(r.catCount).toBeGreaterThanOrEqual(6);
  });

  it("filters by colour (any chosen), and by 'not sure' for a cat with no colour known", async () => {
    expect(names((await list({ colours: ["ginger"] })).items)).toEqual(["Ginger"]);
    expect(names((await list({ colours: ["ginger", "black"] })).items)).toEqual(["Ginger", "Black"]);
    expect(names((await list({ colours: ["not_sure"] })).items)).toEqual(["Mixed", "Tie", "Never"]);
  });

  it("filters by area using the last sighting, else where the cat was first found", async () => {
    expect(names((await list({ area: "kini" })).items)).toEqual(["Ginger"]);
    expect(names((await list({ area: "ermoupoli" })).items)).toEqual(["Tie", "Black"]);
    expect(names((await list({ area: "vari" })).items)).toEqual(["Never"]);
  });

  it("filters by colony number", async () => {
    expect(names((await list({ colony: colonyA })).items)).toEqual(["Ginger"]);
  });

  it("filters by the four marks, including not sterilised", async () => {
    const r = mine((await list()).items);
    const markOfName = (n: string) => r.find((i) => i.name.endsWith(n))!.mark;
    expect(markOfName("Black")).toBe("not_sterilised");
    expect(markOfName("Never")).toBe("not_known");
    expect(names((await list({ sterilised: ["not_sterilised"] })).items)).toEqual(["Black"]);
    expect(names((await list({ sterilised: ["not_known", "not_sterilised"] })).items)).toEqual(["Mixed", "Tie", "Black", "Never"]);
  });

  it("filters by when it was last seen", async () => {
    // The bands add up: a cat seen 3 days ago is in both This week and This month.
    expect(names((await list({ lastSeen: "week" })).items)).toEqual(["Ginger", "Mixed", "Tie"]);
    expect(names((await list({ lastSeen: "month" })).items)).toEqual(["Ginger", "Mixed", "Tie", "Black"]);
    expect(names((await list({ lastSeen: "1to3" })).items)).toEqual([]);
    expect(names((await list({ lastSeen: "never" })).items)).toEqual(["Never"]);
    expect(names((await list({ lastSeen: "over3" })).items)).toEqual([]);
  });

  it("matches the name box on the folded name and on the SYR number", async () => {
    expect(names((await listTeamCats({ q: `${PREFIX}GINGER` }, NOW)).items)).toEqual(["Ginger"]);
    const bySyr = await listTeamCats({ q: `SYR-${String(ids["Black"]).padStart(4, "0")}` }, NOW);
    expect(bySyr.items.map((i) => i.id)).toContain(ids["Black"]);
  });

  it("sorts by name and by newest to the records", async () => {
    expect(names((await list({ sort: "name" })).items)).toEqual(["Black", "Ginger", "Mixed", "Never", "Tie"]);
    expect(names((await list({ sort: "newest" })).items)).toEqual(["Tie", "Mixed", "Never", "Black", "Ginger"]);
  });

  it("names the place in words and keeps the position off the page-facing fields", async () => {
    const g = mine((await list()).items).find((i) => i.name.endsWith("Ginger"))!;
    expect(g.place).toBe("Kini");
    expect(g.syr).toMatch(/^SYR-\d{4,}$/);
    expect(g.photoPublicId).toBe(`${PREFIX}photo`);
  });

  it("pages 48 at a time: page 2 starts at item 49", async () => {
    const bulk = `${PREFIX}bulk-`;
    await db.insert(catsTable).values(
      Array.from({ length: 50 }, (_, i) => ({
        name: `${bulk}${String(i).padStart(2, "0")}`,
        primaryPhotoId: photoId,
        lat: 37.4447,
        lng: 24.9417,
        discovererDeviceId: DEVICE,
      })),
    );
    const one = await listTeamCats({ q: bulk, sort: "name" }, NOW);
    const two = await listTeamCats({ q: bulk, sort: "name", page: 2 }, NOW);
    expect(one.total).toBe(50);
    expect(one.items).toHaveLength(PAGE_SIZE);
    expect(two.items.map((i) => i.name)).toEqual([`${bulk}48`, `${bulk}49`]);
  });
});

// SYC-396 PR 2.0, Task 2.0.1: every team cat, unfiltered, resolved once.
describe("loadTeamCats", () => {
  const load: Record<string, number> = {};
  const OLD = new Date("2022-01-01T09:00:00Z");
  const CREATED = new Date("2026-03-04T05:06:07Z");

  async function loadCat(key: string, o: Partial<typeof catsTable.$inferInsert> = {}) {
    const [c] = await db
      .insert(catsTable)
      .values({
        name: `${LOAD}${key}`,
        primaryPhotoId: photoId,
        lat: 37.4447,
        lng: 24.9417, // Ermoupoli
        discovererDeviceId: DEVICE,
        ...o,
      })
      .returning({ id: catsTable.id });
    load[key] = c!.id;
    return c!.id;
  }
  const loaded = async () => (await loadTeamCats(NOW)).filter((c) => c.name.startsWith(LOAD));
  const byKey = async (key: string) => (await loaded()).find((c) => c.id === load[key]);

  beforeAll(async () => {
    // No evidence of life for over 36 months: presumed deceased.
    await loadCat("Old", { createdAt: OLD });

    // Keeper is the canonical cat. Folded was merged into it, and no newer
    // row undid that. Back was merged into it too, then the merge was undone.
    await loadCat("Keeper", { createdAt: CREATED });
    await say(load["Keeper"]!, "sterilised", { sterilised: true });
    await loadCat("Folded");
    await say(load["Folded"]!, "life_status", { status: "homed" });
    await db.insert(catIdentityTable).values({ catId: load["Folded"]!, canonicalCatId: load["Keeper"]!, reason: LOAD });
    await loadCat("Back");
    const [merge] = await db
      .insert(catIdentityTable)
      .values({ catId: load["Back"]!, canonicalCatId: load["Keeper"]!, reason: LOAD })
      .returning({ id: catIdentityTable.id });
    await db.insert(catIdentityTable).values({
      catId: load["Back"]!,
      canonicalCatId: load["Back"]!,
      supersedesId: merge!.id,
      reason: `${LOAD}undo`,
    });

    // Arizona: the test report's kind, Off Syros.
    await loadCat("Arizona", { lat: 33.4484, lng: -112.074 });
  });

  it("returns a presumed-deceased cat as gone, and the grid's default still hides it", async () => {
    const old = await byKey("Old");
    expect(old?.lives).toBe("gone");
    expect(old?.snapshot.presumedDeceased).toBe(true);
    const grid = await listTeamCats({ q: LOAD }, NOW);
    expect(grid.items.map((i) => i.id)).not.toContain(load["Old"]);
    const gone = await listTeamCats({ q: LOAD, lives: ["gone"] }, NOW);
    expect(gone.items.map((i) => i.id)).toContain(load["Old"]);
  });

  it("leaves out a cat merged into another, and keeps its canonical cat", async () => {
    const ids = (await loaded()).map((c) => c.id);
    expect(ids).not.toContain(load["Folded"]);
    expect(ids).toContain(load["Keeper"]);
    // The grid, the map and the counts agree: the merged half is not a cat of its own.
    const grid = await listTeamCats({ q: LOAD, lives: ["street", "homed", "in_care", "gone"] }, NOW);
    expect(grid.items.map((i) => i.id)).not.toContain(load["Folded"]);
    expect(grid.items.map((i) => i.id)).toContain(load["Keeper"]);
  });

  it("the grid's area filter uses the same key: area=off finds the Off Syros cat", async () => {
    const off = await listTeamCats({ q: LOAD, area: "off" }, NOW);
    expect(off.items.map((i) => i.id)).toEqual([load["Arizona"]]);
    const erm = await listTeamCats({ q: LOAD, area: "ermoupoli" }, NOW);
    expect(erm.items.map((i) => i.id)).not.toContain(load["Arizona"]);
    expect(erm.items.map((i) => i.id)).toContain(load["Keeper"]);
  });

  it("keeps a cat whose merge was undone", async () => {
    expect(await byKey("Back")).toBeDefined();
  });

  it("carries the cat's created_at", async () => {
    expect((await byKey("Keeper"))!.createdAt.getTime()).toBe(CREATED.getTime());
  });

  it("carries the snapshot resolveCat gives for the same records, merged halves included", async () => {
    const recs = await loadCatRecords([load["Keeper"]!]);
    const rec = recs.get(load["Keeper"]!);
    const want = resolveCat(rec?.observations ?? [], rec?.evidenceOfLife ?? null, NOW);
    const keeper = (await byKey("Keeper"))!;
    expect(keeper.snapshot.sterilised).toEqual(want.sterilised);
    expect(keeper.snapshot.lifeStatus).toEqual(want.lifeStatus);
    expect(keeper.mark).toBe("sterilised");
  });

  it("names the area by key, and Off Syros as off", async () => {
    expect((await byKey("Keeper"))!.areaKey).toBe("ermoupoli");
    expect((await byKey("Arizona"))!.areaKey).toBe("off");
  });
});
