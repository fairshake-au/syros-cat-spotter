import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import {
  addPerson,
  catsTable,
  db,
  feedingSitesTable,
  observationsTable,
  photosTable,
  pool,
  sightingsTable,
  welfareReportsTable,
} from "@workspace/db";
import { deleteTestSightings } from "../../test/sightings";
import { deleteTestRows } from "../../test/deleteGuarded";
import { northOf } from "../../test/feedingSites";
import { newColony } from "../../test/roleKit";
import { visibleColonyIds } from "../guardianView";
import { colonyFigures, GROWING_DAYS, KITTENS_DAYS, NOT_VISITED_DAYS, type ColonyFigures } from "./colonyFigures";

// SYC-396 PR 2.2, Task 2.2.1: each colony's figures and its four flags
// (spec §9.1). The test database is shared and never truncated, so every
// assertion reads this run's own colonies only.

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-cfig-${RUN}-`;
const DEVICE = `${PREFIX}device`;
const SITE = `vitest-site-cfig-${RUN}-`;
const NOW = new Date();
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);

// Somewhere on Syros away from every other test's default positions, so no
// other run's litter report lands within 300 m of these sites.
const BASE = { lat: 37.405 + Math.random() * 0.01, lng: 24.885 + Math.random() * 0.01 };

const TEAM = visibleColonyIds({ scopes: [{ role: "staff", colonyId: null, reach: "island" }] });
const guardianOf = (...colonies: number[]) =>
  visibleColonyIds({ scopes: colonies.map((colonyId) => ({ role: "guardian", colonyId, reach: "colony" })) });

let photoId: number;

/** Someone added directly with these roles (no session needed here); their id. */
async function person(label: string, roles: string[], colonyId?: number): Promise<string> {
  const p = await addPerson({
    email: `vitest-cfig-${label}-${RUN}@example.com`,
    name: `Vt ${label}`,
    addedBy: "cli:vitest",
    roles,
    colonyId,
  });
  return p.id;
}
let observedClock = NOW.getTime() - 400 * DAY;

async function cat(created: Date = daysAgo(400), at = BASE): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}${randomBytes(3).toString("hex")}`,
      primaryPhotoId: photoId,
      lat: at.lat,
      lng: at.lng,
      discovererDeviceId: DEVICE,
      createdAt: created,
    })
    .returning({ id: catsTable.id });
  return c!.id;
}

/** A statement, each one a minute after the last unless a time is given. */
async function say(catId: number, kind: string, value: unknown, observedAt?: Date) {
  observedClock += 60_000;
  await db.insert(observationsTable).values({
    catId,
    kind,
    value: value as never,
    deviceId: DEVICE,
    roleAtTime: "staff",
    observedAt: observedAt ?? new Date(observedClock),
  });
}

const into = (catId: number, colonyId: number | null, at?: Date) => say(catId, "colony", { colonyId }, at);

async function sighted(catId: number, when: Date) {
  await db.insert(sightingsTable).values({
    catId,
    deviceId: DEVICE,
    photoId,
    lat: BASE.lat,
    lng: BASE.lng,
    status: "resolved",
    createdAt: when,
  });
}

async function site(colonyId: number, lat: number, lng: number, retired = false) {
  await db.insert(feedingSitesTable).values({
    name: `${SITE}${randomBytes(3).toString("hex")}`,
    colonyId,
    lat,
    lng,
    ...(retired ? { retiredAt: daysAgo(1) } : {}),
  });
}

async function litter(o: { lat: number; lng: number; catId?: number; draft?: boolean; daysAgo?: number; isLitter?: boolean }) {
  const sent = daysAgo(o.daysAgo ?? 5);
  await db.insert(welfareReportsTable).values({
    publicId: `${PREFIX}${randomBytes(5).toString("hex")}`,
    kind: "welfare",
    severity: "attention",
    isLitter: o.isLitter ?? true,
    isDraft: o.draft ?? false,
    lat: o.lat,
    lng: o.lng,
    catId: o.catId ?? null,
    reporterDevice: DEVICE,
    clientRef: `${PREFIX}${randomBytes(5).toString("hex")}`,
    photoState: "none",
    submittedAt: o.draft ? null : sent,
    createdAt: sent,
  });
}

async function figuresFor(colonyId: number, visible = TEAM, island = true): Promise<ColonyFigures | undefined> {
  return (await colonyFigures(visible, { island }, NOW)).get(colonyId);
}

beforeAll(async () => {
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}photo`, data: Buffer.from("x").toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  photoId = p!.id;
});

afterAll(async () => {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(welfareReportsTable).where(like(welfareReportsTable.publicId, `${PREFIX}%`));
  await deleteTestRows("feeding_sites", "name like $1", [`${SITE}%`]);
});

describe("the bar's figures", () => {
  it("counts street cats four ways, the cats, the latest sighting and % confirmed sterilised", async () => {
    const c = await newColony("figures");
    const ster = await cat();
    await say(ster, "sterilised", { sterilised: true });
    await into(ster, c);
    await sighted(ster, daysAgo(3));
    const no = await cat();
    await say(no, "sterilised", { sterilised: false });
    await into(no, c);
    const unknown = await cat();
    await into(unknown, c);
    await sighted(unknown, daysAgo(1));
    const homed = await cat();
    await say(homed, "life_status", { status: "homed" });
    await into(homed, c);
    const gone = await cat();
    await say(gone, "life_status", { status: "deceased" });
    await into(gone, c);

    const f = (await figuresFor(c))!;
    expect(f.colonyId).toBe(c);
    expect(f.street).toBe(3);
    expect(f.split).toEqual({ sterilised: 1, probably: 0, not_sterilised: 1, not_known: 1 });
    expect(f.confirmedPct).toBe(33);
    // Street and homed cats; never "No longer with us".
    expect(f.catCount).toBe(4);
    expect(f.latestSightingAt?.getTime()).toBe(daysAgo(1).getTime());
  });

  it("confirmedPct is null with no street cats, and a colony with no cats still has figures", async () => {
    const c = await newColony("empty");
    const f = (await figuresFor(c))!;
    expect(f).toBeDefined();
    expect(f.street).toBe(0);
    expect(f.confirmedPct).toBeNull();
    expect(f.catCount).toBe(0);
    expect(f.latestSightingAt).toBeNull();
    // No cats: never "Not visited lately".
    expect(f.flags).not.toContain("not_visited");
  });

  it("a cat that moved away counts for its new colony only", async () => {
    const from = await newColony("from");
    const to = await newColony("to");
    const mover = await cat();
    await into(mover, from);
    await into(mover, to);
    expect((await figuresFor(from))!.catCount).toBe(0);
    expect((await figuresFor(to))!.catCount).toBe(1);
  });
});

describe("Growing", () => {
  async function newCats(colonyId: number, n: number, created: Date) {
    for (let i = 0; i < n; i++) {
      const id = await cat(created);
      await into(id, colonyId, created);
    }
  }

  it("fires at 3 new cats against 1 in the 90 days before", async () => {
    const c = await newColony("growing");
    await newCats(c, 3, daysAgo(10));
    await newCats(c, 1, daysAgo(GROWING_DAYS + 20));
    expect((await figuresFor(c))!.flags).toContain("growing");
  });

  it("does not fire at 3 against 3", async () => {
    const c = await newColony("steady");
    await newCats(c, 3, daysAgo(10));
    await newCats(c, 3, daysAgo(GROWING_DAYS + 20));
    expect((await figuresFor(c))!.flags).not.toContain("growing");
  });

  it("does not fire at 2 new cats against none", async () => {
    const c = await newColony("two");
    await newCats(c, 2, daysAgo(10));
    expect((await figuresFor(c))!.flags).not.toContain("growing");
  });

  it("does not count 3 new cats moved in from another colony", async () => {
    const c = await newColony("movedin");
    const elsewhere = await newColony("elsewhere");
    for (let i = 0; i < 3; i++) {
      const id = await cat(daysAgo(20));
      await into(id, elsewhere, daysAgo(19));
      await into(id, c, daysAgo(5));
    }
    expect((await figuresFor(c))!.flags).not.toContain("growing");
    // ...and they do count where they were first recorded.
    expect((await figuresFor(elsewhere))!.flags).toContain("growing");
  });

  it("a cat first said to be in no colony, then put here, is new here", async () => {
    const c = await newColony("nocolonyfirst");
    for (let i = 0; i < 3; i++) {
      const id = await cat(daysAgo(20));
      await into(id, null, daysAgo(19));
      await into(id, c, daysAgo(5));
    }
    expect((await figuresFor(c))!.flags).toContain("growing");
  });
});

describe("Kittens reported", () => {
  it("a litter report 250 m from a site flags the colony for the team, not for its cat guardian", async () => {
    const c = await newColony("kit250");
    const at = { lat: BASE.lat + 0.004, lng: BASE.lng };
    await site(c, at.lat, at.lng);
    await litter({ lat: northOf(at.lat, 250), lng: at.lng });
    expect((await figuresFor(c))!.flags).toContain("kittens");
    expect((await figuresFor(c, guardianOf(c), false))!.flags).not.toContain("kittens");
  });

  it("a litter report tied to her cat flags it for both", async () => {
    const c = await newColony("kitcat");
    const kit = await cat();
    await into(kit, c);
    // Far from any site: only the tie counts.
    await litter({ lat: BASE.lat - 0.02, lng: BASE.lng - 0.02, catId: kit });
    expect((await figuresFor(c))!.flags).toContain("kittens");
    expect((await figuresFor(c, guardianOf(c), false))!.flags).toContain("kittens");
  });

  it("a report 350 m away, a draft, an old one, a retired site or a report without kittens doesn't flag it", async () => {
    const c = await newColony("kitnot");
    const at = { lat: BASE.lat + 0.008, lng: BASE.lng + 0.004 };
    await site(c, at.lat, at.lng);
    await litter({ lat: northOf(at.lat, 350), lng: at.lng });
    await litter({ lat: northOf(at.lat, 100), lng: at.lng, draft: true });
    await litter({ lat: northOf(at.lat, 100), lng: at.lng, daysAgo: KITTENS_DAYS + 1 });
    await litter({ lat: northOf(at.lat, 100), lng: at.lng, isLitter: false });
    const retiredAt = { lat: BASE.lat - 0.006, lng: BASE.lng + 0.008 };
    await site(c, retiredAt.lat, retiredAt.lng, true);
    await litter({ lat: northOf(retiredAt.lat, 50), lng: retiredAt.lng });
    expect((await figuresFor(c))!.flags).not.toContain("kittens");
  });
});

describe("No guardian", () => {
  it("an expired placement with a blank name is flagged; a free-text name isn't", async () => {
    const c = await newColony("noguard");
    const g = await person("exp", ["guardian"], c);
    await pool.query("update person_scopes set expires_at = $2 where person_id = $1", [g, daysAgo(1)]);
    expect((await figuresFor(c))!.flags).toContain("no_guardian");
    expect((await figuresFor(c))!.guardianNames).toEqual([]);

    await pool.query("update colonies set guardian_name = 'Eleni' where id = $1", [c]);
    expect((await figuresFor(c))!.flags).not.toContain("no_guardian");
  });

  it("a placement in force is a guardian, and her name is on the card", async () => {
    const c = await newColony("placed");
    await person("placed", ["guardian"], c);
    const f = (await figuresFor(c))!;
    expect(f.flags).not.toContain("no_guardian");
    expect(f.guardianNames).toEqual(["Vt placed"]);
  });

  it("a blank or spaces-only typed name with no placement is flagged", async () => {
    const c = await newColony("blank");
    await pool.query("update colonies set guardian_name = '   ' where id = $1", [c]);
    expect((await figuresFor(c))!.flags).toContain("no_guardian");
  });

  it("a team member placed on the island is not this colony's guardian", async () => {
    const c = await newColony("staffonly");
    await person("staff", ["staff"]);
    expect((await figuresFor(c))!.flags).toContain("no_guardian");
  });
});

describe("Not visited lately", () => {
  it("31 days is flagged, 29 isn't", async () => {
    const old = await newColony("old");
    const a = await cat();
    await into(a, old);
    await sighted(a, daysAgo(NOT_VISITED_DAYS + 1));
    expect((await figuresFor(old))!.flags).toContain("not_visited");

    const fresh = await newColony("fresh");
    const b = await cat();
    await into(b, fresh);
    await sighted(b, daysAgo(NOT_VISITED_DAYS - 1));
    expect((await figuresFor(fresh))!.flags).not.toContain("not_visited");
  });

  it("cats never sighted are not visited", async () => {
    const c = await newColony("never");
    const a = await cat();
    await into(a, c);
    expect((await figuresFor(c))!.flags).toContain("not_visited");
  });
});

describe("who sees which colony", () => {
  it("a cat guardian's Visible never returns another colony's figures", async () => {
    const hers = await newColony("hers");
    const other = await newColony("other");
    const figures = await colonyFigures(guardianOf(hers), { island: false }, NOW);
    expect([...figures.keys()]).toEqual([hers]);
    expect(figures.has(other)).toBe(false);
  });

  it("someone who sees nothing gets nothing", async () => {
    const nothing = visibleColonyIds({ scopes: [] });
    expect((await colonyFigures(nothing, { island: false }, NOW)).size).toBe(0);
  });

  it("the team sees every colony", async () => {
    const a = await newColony("teamA");
    const b = await newColony("teamB");
    const figures = await colonyFigures(TEAM, { island: true }, NOW);
    expect(figures.has(a)).toBe(true);
    expect(figures.has(b)).toBe(true);
  });
});
