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
import { colonyFigures, GROWING_DAYS, KITTENS_DAYS, NOT_VISITED_DAYS, wholePct, type ColonyFigures } from "./colonyFigures";

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

// SYC-620: Home asks for `lean` figures. Everything it shows is unchanged; only
// the guardian names and the two flags built on guardians and growth are left out.
describe("lean figures (Home)", () => {
  it("are the same as the full figures except guardian names and the Growing / No guardian flags", async () => {
    const c = await newColony("lean");
    await person("lean", ["guardian"], c);
    const when = daysAgo(10);
    for (let i = 0; i < 3; i++) await into(await cat(when), c, when);
    const full = (await colonyFigures(TEAM, { island: true }, NOW)).get(c)!;
    const lean = (await colonyFigures(TEAM, { island: true, lean: true }, NOW)).get(c)!;
    expect(full.flags).toContain("growing");
    expect(full.guardianNames).toEqual(["Vt lean"]);
    expect(lean.guardianNames).toEqual([]);
    expect(lean.flags).not.toContain("growing");
    expect(lean.flags).not.toContain("no_guardian");
    expect({ ...lean, guardianNames: [], flags: [] }).toEqual({ ...full, guardianNames: [], flags: [] });
  });

  it("still flags Kittens and Not visited lately", async () => {
    const c = await newColony("leankit");
    await into(await cat(daysAgo(100)), c, daysAgo(100));
    const lean = (await colonyFigures(TEAM, { island: true, lean: true }, NOW)).get(c)!;
    expect(lean.flags).toContain("not_visited");
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

// From the adversarial review of PR 2.2 (each failed before its fix).
describe("review findings", () => {
  const FAR = { lat: 37.98, lng: 23.72 }; // Athens: Off Syros

  it("an Off Syros cat is not in a colony's cat count (spec §3.3)", async () => {
    const c = await newColony("offsyros");
    const here = await cat();
    await into(here, c);
    const away = await cat(daysAgo(400), FAR);
    await say(away, "life_status", { status: "homed" });
    await into(away, c);
    expect((await figuresFor(c))!.catCount).toBe(1);
  });

  it("a colony whose only cats are gone is not 'Not visited lately', and their sightings set no date", async () => {
    const c = await newColony("onlygone");
    const gone = await cat();
    await into(gone, c);
    await sighted(gone, daysAgo(200));
    // Said to have died after that sighting.
    await say(gone, "life_status", { status: "deceased" }, daysAgo(100));
    const f = (await figuresFor(c))!;
    expect(f.street + f.catCount).toBe(0);
    expect(f.flags).not.toContain("not_visited");
    expect(f.latestSightingAt).toBeNull();
  });

  it("a guardian who hasn't accepted the invitation is not named and doesn't clear No guardian", async () => {
    const c = await newColony("pending");
    const g = await person("pend", ["guardian"], c);
    await pool.query("update people set accepted_at = null where id = $1", [g]);
    const f = (await figuresFor(c))!;
    expect(f.guardianNames).toEqual([]);
    expect(f.flags).toContain("no_guardian");
  });

  it("Growing reads the same for the team and for the colony's own cat guardian", async () => {
    const a = await newColony("growA");
    const b = await newColony("growB");
    for (let i = 0; i < 3; i++) {
      const k = await cat(daysAgo(10));
      await into(k, a, daysAgo(10));
      await into(k, b, daysAgo(5));
    }
    expect((await figuresFor(a))!.flags).toContain("growing");
    expect((await figuresFor(a, guardianOf(a), false))!.flags).toContain("growing");
    // ...and her answer still holds only her colony.
    expect([...(await colonyFigures(guardianOf(a), { island: false }, NOW)).keys()]).toEqual([a]);
  });

  it("% confirmed sterilised is 100 only when all are, and 0 only when none are", () => {
    expect(wholePct(199, 200)).toBe(99);
    expect(wholePct(200, 200)).toBe(100);
    expect(wholePct(1, 300)).toBe(1);
    expect(wholePct(0, 300)).toBe(0);
    expect(wholePct(1, 3)).toBe(33);
  });
});

// From the second critic on PR 2.2, and Samuel's answer on Not visited (19 Oct).
describe("second review", () => {
  it("two different guardians who share a name are both named", async () => {
    const c = await newColony("samename");
    await person("twin", ["guardian"], c);
    await addPerson({ email: `vitest-cfig-twin2-${RUN}@example.com`, name: "Vt twin", addedBy: "cli:vitest", roles: ["guardian"], colonyId: c });
    expect((await figuresFor(c))!.guardianNames).toEqual(["Vt twin", "Vt twin"]);
  });

  it("a colony whose street cats were all rehomed is not 'Not visited lately'", async () => {
    const c = await newColony("allhomed");
    const k = await cat();
    await into(k, c);
    await sighted(k, daysAgo(200));
    await say(k, "life_status", { status: "homed" }, daysAgo(100));
    const f = (await figuresFor(c))!;
    expect(f.street).toBe(0);
    expect(f.catCount).toBe(1);
    expect(f.flags).not.toContain("not_visited");
  });

  it("a street cat beside a recently seen homed cat still makes it 'Not visited lately'", async () => {
    const c = await newColony("mixedvisit");
    const street = await cat();
    await into(street, c);
    await sighted(street, daysAgo(NOT_VISITED_DAYS + 5));
    const homed = await cat();
    await into(homed, c);
    await sighted(homed, daysAgo(1));
    await say(homed, "life_status", { status: "homed" }, daysAgo(1));
    expect((await figuresFor(c))!.flags).toContain("not_visited");
  });

  it("a sighting exactly 30 days ago still counts as a visit", async () => {
    const c = await newColony("exact30");
    const k = await cat();
    await into(k, c);
    await sighted(k, daysAgo(NOT_VISITED_DAYS));
    expect((await figuresFor(c))!.flags).not.toContain("not_visited");
  });
});
