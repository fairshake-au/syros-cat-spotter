import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { catsTable, db, photosTable, sightingsTable, welfareReportsTable } from "@workspace/db";
import { seedReport } from "../teamAuth/__fixtures__/queueKit";
import { deleteTestSightings } from "../../test/sightings";
import { listWelfareQueue, type QueueReport, type WelfareQueue } from "../welfareQueue";
import { listLikelyForReview, type LikelyCat } from "../likelyReview";
import { listColourCheck, type ColourCheckCat } from "../colourCheck";
import type { TeamCat } from "../teamCatList";
import type { ColonyFigures } from "./colonyFigures";
import { athensMonths } from "../athensTime";
import {
  countAwaitingMatch,
  countOpenIssues,
  HOME_LINES_LIMIT,
  homeData,
  monthFigures,
  vetSpend,
  type HomeDeps,
} from "./home";
import { logVetVisit, undoVetVisit } from "../vetVisits";

// SYC-396 PR 2.1, Task 2.1.1: the figures behind Home. The test database is
// shared and never truncated, so every database check is a delta against a
// "before" read, or looks only at this run's own rows.

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-home-${RUN}-`;
const DEVICE = `${PREFIX}device`;
const NOW = new Date("2026-10-18T12:00:00Z");

let photoId: number;
const redactedIds: number[] = [];

beforeAll(async () => {
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}photo`, data: Buffer.from("x").toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  photoId = p!.id;
});

afterAll(async () => {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  if (redactedIds.length) await deleteTestSightings(inArray(sightingsTable.id, redactedIds));
  await db.delete(welfareReportsTable).where(like(welfareReportsTable.publicId, `${PREFIX}%`));
  await db.delete(photosTable).where(like(photosTable.publicId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
});

const pid = (k: string) => `${PREFIX}${k}`;

function fakeReport(id: string, over: Partial<QueueReport> = {}): QueueReport {
  return {
    id,
    severity: "attention",
    isLitter: false,
    lat: 37.4447,
    lng: 24.9417,
    at: NOW.toISOString(),
    note: "x",
    state: "new",
    stateChangedAt: null,
    stateChangedBy: null,
    photo: { status: "none", url: null },
    cat: null,
    suggestedCat: null,
    contactLeft: false,
    emailToReporter: null,
    teamNote: null,
    teamNoteAt: null,
    teamNoteBy: null,
    emailToTeam: null,
    unchecked: false,
    ...over,
  } as QueueReport;
}

function fakeQueue(over: Partial<WelfareQueue> = {}): WelfareQueue {
  return {
    open: [],
    closed: [],
    closedTotal: 0,
    drafts: [],
    draftsTotal: 0,
    unchecked: { reports: [], reportsTotal: 0, drafts: [], draftsTotal: 0 },
    mail: {} as WelfareQueue["mail"],
    ...over,
  };
}

function fakeCat(over: Partial<TeamCat> & { sterilised?: Partial<TeamCat["snapshot"]["sterilised"]> }): TeamCat {
  const { sterilised, ...rest } = over;
  return {
    id: 1,
    name: "Fake",
    lives: "street",
    mark: "not_known",
    areaKey: "ermoupoli",
    colonyId: null,
    lastSeenAt: null,
    createdAt: new Date("2020-01-01T00:00:00Z"),
    snapshot: {
      sterilised: { value: null, confidence: "unknown", asOf: "2020-01-01T00:00:00Z", clippedTipSightings: 0, ...sterilised },
    },
    ...rest,
  } as unknown as TeamCat;
}

/** Every reader faked: nothing touches the database. */
const pure = (over: Partial<HomeDeps> = {}): Partial<HomeDeps> => ({
  listWelfareQueue: async () => fakeQueue(),
  countOpenIssues: async () => 0,
  countAwaitingMatch: async () => 0,
  listLikelyForReview: async () => [],
  listColourCheck: async () => [],
  loadTeamCats: async () => [],
  monthFigures: async () => ({ sightings: 0, newCats: 0, sterilisations: 0, vetSpendEur: 0 }),
  allColonyChoices: async () => [],
  colonyFigures: async () => new Map(),
  standardPriceNow: async () => 60,
  ...over,
});

describe("Needs us now", () => {
  it("an urgent report comes before a newer 'needs attention' one (the queue's own order)", async () => {
    const before = (await homeData(NOW)).needs;
    const urgent = await seedReport({ publicId: pid("urgent"), severity: "urgent", sentMinutesAgo: 60 });
    const newer = await seedReport({ publicId: pid("newer"), severity: "attention", sentMinutesAgo: 1 });
    const after = (await homeData(NOW)).needs;
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    const total = (n: typeof after.value) => n.linesTotal + n.otherOpen;
    expect(total(after.value)).toBe(total(before.value) + 2);
    const ids = (await listWelfareQueue()).open.map((r) => r.id);
    expect(ids.indexOf(urgent.publicId)).toBeGreaterThan(-1);
    expect(ids.indexOf(urgent.publicId)).toBeLessThan(ids.indexOf(newer.publicId));
  });

  const at = (h: number) => new Date(Date.UTC(2026, 9, 18, h)).toISOString();

  it("lines are urgent and kitten reports, urgent first then newest", async () => {
    const open = [
      fakeReport("urgent-09", { severity: "urgent", at: at(9) }),
      fakeReport("litter-11", { isLitter: true, at: at(11) }),
      fakeReport("plain-12", { at: at(12) }),
      fakeReport("urgent-10", { severity: "urgent", at: at(10) }),
    ];
    const d = await homeData(NOW, pure({ listWelfareQueue: async () => fakeQueue({ open }) }));
    expect(d.needs.ok).toBe(true);
    if (!d.needs.ok) return;
    expect(d.needs.value.lines.map((r) => r.id)).toEqual(["urgent-10", "urgent-09", "litter-11"]);
    expect(d.needs.value.linesTotal).toBe(3);
    expect(d.needs.value.otherOpen).toBe(1);
  });

  it("an urgent litter report is one line, counted once", async () => {
    const open = [fakeReport("both", { severity: "urgent", isLitter: true })];
    const d = await homeData(NOW, pure({ listWelfareQueue: async () => fakeQueue({ open }) }));
    expect(d.needs.ok && d.needs.value.lines.map((r) => r.id)).toEqual(["both"]);
    expect(d.needs.ok && [d.needs.value.linesTotal, d.needs.value.otherOpen]).toEqual([1, 0]);
  });

  it("seven lines of kind cap at five; linesTotal 7; otherOpen excludes them", async () => {
    const open = [
      ...Array.from({ length: 7 }, (_, i) => fakeReport(`u${i}`, { severity: "urgent", at: at(10 - i) })),
      fakeReport("plain-a"),
      fakeReport("plain-b"),
    ];
    const d = await homeData(NOW, pure({ listWelfareQueue: async () => fakeQueue({ open }) }));
    expect(d.needs.ok).toBe(true);
    if (!d.needs.ok) return;
    expect(HOME_LINES_LIMIT).toBe(5);
    expect(d.needs.value.lines.map((r) => r.id)).toEqual(["u0", "u1", "u2", "u3", "u4"]);
    expect(d.needs.value.linesTotal).toBe(7);
    expect(d.needs.value.otherOpen).toBe(2);
  });

  it("counts the reports waiting for a check apart: they are not in the open total", async () => {
    const q = fakeQueue({
      open: [fakeReport("o1"), fakeReport("o2")],
      unchecked: { reports: [], reportsTotal: 3, drafts: [], draftsTotal: 0 },
    });
    const d = await homeData(NOW, pure({ listWelfareQueue: async () => q }));
    expect(d.needs.ok).toBe(true);
    if (!d.needs.ok) return;
    expect(d.needs.value.unchecked).toBe(3);
    expect(d.needs.value.linesTotal + d.needs.value.otherOpen).toBe(2);
  });

  it("SYC-519: Home asks the queue for no drafts and carries none", async () => {
    const asked: unknown[] = [];
    const d = await homeData(
      NOW,
      pure({
        listWelfareQueue: async (opts?: { drafts?: boolean }) => {
          asked.push(opts);
          return fakeQueue();
        },
      }),
    );
    expect(asked).toEqual([{ drafts: false }]);
    expect(d.needs.ok).toBe(true);
    if (!d.needs.ok) return;
    expect(d.needs.value).not.toHaveProperty("drafts");
    expect(d.needs.value).not.toHaveProperty("draftsTotal");
  });

  it("a 'Report an issue' row raises the open issues by one; a done one and a draft don't", async () => {
    const before = await countOpenIssues();
    await seedReport({ publicId: pid("issue-new"), kind: "content", state: "new" });
    expect(await countOpenIssues()).toBe(before + 1);
    await seedReport({ publicId: pid("issue-done"), kind: "content", state: "done" });
    await seedReport({ publicId: pid("issue-draft"), kind: "content", state: "new", isDraft: true });
    expect(await countOpenIssues()).toBe(before + 1);
    // An ordinary open welfare report is not an issue (review of #243).
    await seedReport({ publicId: pid("issue-welfare"), kind: "welfare", state: "new" });
    expect(await countOpenIssues()).toBe(before + 1);
  });

  it("counts a sighting held for the team to match", async () => {
    const before = await countAwaitingMatch();
    await db.insert(sightingsTable).values({
      deviceId: DEVICE,
      photoId,
      lat: 37.4447,
      lng: 24.9417,
      status: "awaiting_team",
    });
    expect(await countAwaitingMatch()).toBe(before + 1);
  });
});

describe("redacted sightings are never counted", () => {
  // Redaction is an UPDATE that clears the device (sightings_append_only),
  // so these rows lose the device the cleanup matches on: track their ids.
  async function redactedSighting(over: Partial<typeof sightingsTable.$inferInsert>) {
    const [row] = await db
      .insert(sightingsTable)
      .values({ deviceId: DEVICE, photoId, lat: 37.4447, lng: 24.9417, ...over })
      .returning({ id: sightingsTable.id });
    await db
      .update(sightingsTable)
      .set({ deviceId: null, redactedAt: new Date(), redactionReason: "vitest" })
      .where(eq(sightingsTable.id, row!.id));
    redactedIds.push(row!.id);
  }

  it("not as waiting for a match", async () => {
    const before = await countAwaitingMatch();
    await redactedSighting({ status: "awaiting_team" });
    expect(await countAwaitingMatch()).toBe(before);
  });

  it("nor in this month's sightings", async () => {
    const from = new Date("2002-03-01T00:00:00Z");
    const to = new Date("2002-04-01T00:00:00Z");
    const before = (await monthFigures(from, to, [])).sightings;
    await redactedSighting({ status: "resolved", createdAt: new Date("2002-03-15T12:00:00Z") });
    expect((await monthFigures(from, to, [])).sightings).toBe(before);
  });
});

describe("Cats to check", () => {
  it("counts match the two lists' own rules", async () => {
    const d = await homeData(NOW);
    const likely = await listLikelyForReview(NOW);
    const colour = await listColourCheck(NOW);
    expect(d.toCheck.ok).toBe(true);
    if (!d.toCheck.ok) return;
    expect(d.toCheck.value.earClips).toBe(likely.length);
    expect(d.toCheck.value.colour).toBe(colour.filter((c) => c.group === "check").length);
  });

  it("toCheck is counts only", async () => {
    const likely = Array.from({ length: 6 }, (_, i) => ({ catId: i, evidence: [] })) as unknown as LikelyCat[];
    const colour = [
      { catId: 1, group: "check", photoUrl: "/api/team/photos/c1" },
      { catId: 2, group: "check", photoUrl: null },
      { catId: 3, group: "not_described", photoUrl: "/api/team/photos/c3" },
    ] as unknown as ColourCheckCat[];
    const d = await homeData(NOW, pure({ listLikelyForReview: async () => likely, listColourCheck: async () => colour }));
    expect(d.toCheck).toEqual({ ok: true, value: { earClips: 6, colour: 2 } });
  });
});

describe("Where to trap next", () => {
  const visible = { ids: null } as never;

  function fig(id: number, notSterilised: number, flags: ColonyFigures["flags"] = []): ColonyFigures {
    return {
      colonyId: id,
      street: notSterilised,
      split: { sterilised: 0, probably: 0, not_known: 0, not_sterilised: notSterilised },
      confirmedPct: 0,
      catCount: notSterilised,
      latestSightingAt: null,
      flags,
      guardianNames: [],
    };
  }

  it("trapNext reuses Home's loaded cats", async () => {
    const cats = [fakeCat({ id: 1, colonyId: 7, mark: "not_sterilised" })];
    let loads = 0;
    let passed: unknown;
    let island: unknown;
    const d = await homeData(
      NOW,
      pure({
        loadTeamCats: async () => ((loads += 1), cats),
        colonyFigures: async (_v, opts) => ((passed = opts.cats), (island = opts.island), new Map([[7, fig(7, 1)]])),
        allColonyChoices: async () => [{ id: 7, name: "Harbour" }],
      }),
      visible,
    );
    expect(loads).toBe(1);
    expect(passed).toBe(cats);
    expect(island).toBe(true);
    expect(d.trapNext.ok).toBe(true);
    if (!d.trapNext.ok) return;
    expect(d.trapNext.value.colonies.map((c) => [c.name, c.toDo])).toEqual([["Harbour", 1]]);
    expect(d.trapNext.value.colonyCount).toBe(1);
  });

  it("trapNext for a viewer who isn't island-wide fails closed (the 300 m kittens rule reads exact positions)", async () => {
    let asked = false;
    const d = await homeData(
      NOW,
      pure({ colonyFigures: async () => ((asked = true), new Map()) }),
      { ids: [7] } as never,
    );
    expect(d.trapNext.ok).toBe(false);
    expect(asked).toBe(false);
  });

  it("trapNext without visible fails closed", async () => {
    let asked = false;
    const d = await homeData(NOW, pure({ colonyFigures: async () => ((asked = true), new Map()) }));
    expect(d.trapNext.ok).toBe(false);
    expect(asked).toBe(false);
  });

  it("trapNext noColony counts street cats with no colony that aren't sterilised", async () => {
    const cats = [
      fakeCat({ id: 1, colonyId: null, mark: "not_sterilised" }),
      fakeCat({ id: 2, colonyId: null, mark: "probably" }),
      fakeCat({ id: 3, colonyId: null, mark: "sterilised" }),
      fakeCat({ id: 4, colonyId: null, mark: "not_known", lives: "homed" }),
      fakeCat({ id: 5, colonyId: 7, mark: "not_sterilised" }),
    ];
    const d = await homeData(NOW, pure({ loadTeamCats: async () => cats }), visible);
    expect(d.trapNext.ok && d.trapNext.value.noColony).toBe(2);
  });

  it("carries the standard price from Vet settings", async () => {
    const d = await homeData(NOW, pure({ standardPriceNow: async () => 55 }), visible);
    expect(d.trapNext.ok && d.trapNext.value.priceEur).toBe(55);
  });

  it("a failing colony read fails only Where to trap next", async () => {
    const d = await homeData(
      NOW,
      pure({ colonyFigures: async () => { throw new Error("boom"); } }),
      visible,
    );
    expect(d.trapNext.ok).toBe(false);
    expect(d.needs.ok && d.headline.ok && d.toCheck.ok && d.month.ok).toBe(true);
  });
});

describe("the headline", () => {
  it("the headline counts street cats, through countedCats", async () => {
    const cats = [
      fakeCat({ id: 1, mark: "sterilised" }),
      fakeCat({ id: 2, mark: "not_known" }),
      fakeCat({ id: 3, lives: "homed" }),
      fakeCat({ id: 4, lives: "street", areaKey: "off" }),
    ];
    const d = await homeData(NOW, pure({ loadTeamCats: async () => cats }));
    expect(d.headline.ok).toBe(true);
    if (!d.headline.ok) return;
    expect(d.headline.value.street).toBe(2);
    expect(d.headline.value.homed).toBe(1);
    expect(d.headline.value.at).toEqual(NOW);
  });
});

describe("This month", () => {
  it("months are Athens calendar months, across the October clock change", () => {
    expect(athensMonths(NOW)).toEqual({
      now: { from: new Date("2026-09-30T21:00:00Z"), to: new Date("2026-10-31T22:00:00Z") },
      last: { from: new Date("2026-08-31T21:00:00Z"), to: new Date("2026-09-30T21:00:00Z") },
    });
    expect(athensMonths(new Date("2026-11-02T12:00:00Z")).now.from).toEqual(new Date("2026-10-31T22:00:00Z"));
    // Just after midnight on 1 Nov in Athens is November, though it's still 31 Oct in UTC.
    expect(athensMonths(new Date("2026-10-31T22:30:00Z")).now.from).toEqual(new Date("2026-10-31T22:00:00Z"));
    expect(athensMonths(new Date("2027-01-10T12:00:00Z")).last.from).toEqual(new Date("2026-11-30T22:00:00Z"));
  });

  it("homeData asks for Athens months: just after midnight on 1 Oct there is already October", async () => {
    const asked: [Date, Date][] = [];
    // 00:30 on 1 October in Athens is still 21:30 on 30 September in UTC.
    const at = new Date("2026-09-30T21:30:00Z");
    await homeData(at, pure({ monthFigures: async (from, to) => (asked.push([from, to]), { sightings: 0, newCats: 0, sterilisations: 0, vetSpendEur: 0 }) }));
    expect(asked[0]).toEqual([new Date("2026-09-30T21:00:00Z"), new Date("2026-10-31T22:00:00Z")]);
    expect(asked[1]![0]).toEqual(new Date("2026-08-31T21:00:00Z"));
  });

  it("a sterilisation counts in the month of the operation, however late it was entered", async () => {
    const m = athensMonths(NOW);
    const cats = [
      fakeCat({ id: 1, createdAt: new Date("2026-10-18T09:00:00Z"), sterilised: { value: true, confidence: "confirmed", asOf: "2026-10-03T12:00:00Z" } }),
      fakeCat({ id: 2, sterilised: { value: true, confidence: "confirmed", asOf: "2026-09-28T12:00:00Z" } }),
      fakeCat({ id: 3, sterilised: { value: true, confidence: "likely", asOf: "2026-10-05T12:00:00Z" } }),
      fakeCat({ id: 4, areaKey: "off", createdAt: new Date("2026-10-10T09:00:00Z"), sterilised: { value: true, confidence: "confirmed", asOf: "2026-10-04T12:00:00Z" } }),
    ];
    // A window far in the past holds none of our sightings; only the cat figures matter here.
    const oct = await monthFigures(m.now.from, m.now.to, cats);
    const sep = await monthFigures(m.last.from, m.last.to, cats);
    expect([oct.sterilisations, oct.newCats]).toEqual([1, 1]);
    expect([sep.sterilisations, sep.newCats]).toEqual([1, 0]);
  });

  it("a cat adopted, in care or gone since still counts in the month it was recorded or operated on (SYC-486)", async () => {
    const m = athensMonths(NOW);
    const op = { value: true, confidence: "confirmed" as const, asOf: "2026-10-03T12:00:00Z" };
    const cats = (["street", "homed", "in_care", "gone"] as const).map((lives, i) =>
      fakeCat({ id: i + 1, lives, createdAt: new Date("2026-10-05T09:00:00Z"), sterilised: op }),
    );
    const oct = await monthFigures(m.now.from, m.now.to, cats);
    expect([oct.newCats, oct.sterilisations]).toEqual([4, 4]);
    // ...but a cat off the island never does.
    const off = await monthFigures(m.now.from, m.now.to, [fakeCat({ id: 9, areaKey: "off", createdAt: new Date("2026-10-05T09:00:00Z"), sterilised: op })]);
    expect([off.newCats, off.sterilisations]).toEqual([0, 0]);
  });

  it("counts resolved sightings on Syros entered in the month, never Off Syros ones", async () => {
    const from = new Date("2001-03-01T00:00:00Z");
    const to = new Date("2001-04-01T00:00:00Z");
    const before = (await monthFigures(from, to, [])).sightings;
    const at = new Date("2001-03-15T12:00:00Z");
    const row = { deviceId: DEVICE, photoId, status: "resolved", createdAt: at };
    await db.insert(sightingsTable).values([
      { ...row, lat: 37.4447, lng: 24.9417 },
      { ...row, lat: 33.4, lng: -112.0 },
      { ...row, lat: 37.4447, lng: 24.9417, status: "pending" },
    ]);
    expect((await monthFigures(from, to, [])).sightings).toBe(before + 1);
  });
});

describe("one failing figure doesn't take Home down (§13)", () => {
  it("a failing queue fails only Needs us now", async () => {
    const d = await homeData(NOW, pure({ listWelfareQueue: async () => { throw new Error("queue down"); } }));
    expect(d.needs).toEqual({ ok: false });
    expect([d.toCheck.ok, d.headline.ok, d.month.ok]).toEqual([true, true, true]);
  });

  it("failing cats fail only the sections built on them", async () => {
    const d = await homeData(NOW, pure({ loadTeamCats: async () => { throw new Error("cats down"); } }), { ids: null } as never);
    expect([d.needs.ok, d.toCheck.ok]).toEqual([true, true]);
    expect([d.trapNext.ok, d.headline.ok, d.month.ok]).toEqual([false, false, false]);
  });
});

describe("This month's vet spend (SYC-396 PR 3.1a; §8.4)", () => {
  const staff = { id: `${PREFIX}staff`, scopes: [{ role: "staff", colonyId: null }] };
  const at = new Date("2026-10-21T10:00:00Z");
  const from = new Date("2026-08-31T21:00:00Z"); // 1 Sep 2026 on Syros
  const to = new Date("2026-09-30T21:00:00Z"); // 1 Oct 2026 on Syros
  let n = 0;
  const newCat = async () => {
    n += 1;
    const [cat] = await db
      .insert(catsTable)
      .values({ name: `${PREFIX}cat-${n}`, description: "", primaryPhotoId: 0, lat: 37.44, lng: 24.9, discovererDeviceId: DEVICE })
      .returning({ id: catsTable.id });
    return cat!.id;
  };
  const visit = async (catId: number, date: string, costEur: number | null, paidBy: "syros_cats" | "donation" | "owner") =>
    logVetVisit(staff, { catId, date, value: { did: ["sterilised"], clinicId: "symviosis", costEur, paidBy } }, at);

  it("counts a €60 Syros Cats visit and leaves out a €70 owner-paid one", async () => {
    const before = await vetSpend(from, to);
    await visit(await newCat(), "2026-09-10", 60, "syros_cats");
    await visit(await newCat(), "2026-09-11", 70, "owner");
    expect(await vetSpend(from, to)).toBe(before + 60);
  });

  it("counts a donation for the cat, skips an unknown cost, an undone visit and another month", async () => {
    const before = await vetSpend(from, to);
    await visit(await newCat(), "2026-09-12", 55.5, "donation");
    await visit(await newCat(), "2026-09-13", null, "syros_cats");
    const undone = await visit(await newCat(), "2026-09-14", 40, "syros_cats");
    await undoVetVisit(staff, undone.visitId, "Wrong cat", at);
    await visit(await newCat(), "2026-10-02", 45, "syros_cats");
    expect(await vetSpend(from, to)).toBe(before + 55.5);
  });

  it("is part of the month's figures", async () => {
    const figures = await monthFigures(from, to, []);
    expect(figures.vetSpendEur).toBe(await vetSpend(from, to));
  });
});
