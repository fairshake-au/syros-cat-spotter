import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  profilesTable,
  pointsLedgerTable,
  weeklyResultsTable,
} from "@workspace/db";
import { like, sql } from "drizzle-orm";
import app from "../app";
import { spotterCode } from "../lib/catHelpers";
import {
  athensDay,
  weekStartAthens,
  weekStartInstant,
} from "../lib/weeks";

// Every fixture shares this prefix so cleanup never touches real data.
const PREFIX = "vitest-lbweek-";
const dev = (s: string) => `${PREFIX}${s}`;

type Entry = {
  spotterCode: string;
  username: string | null;
  points: number;
  rank: number;
};

let sightingSeq = 1_900_000_000;
const nextSighting = () => sightingSeq++;

async function cleanup() {
  await db.delete(pointsLedgerTable).where(like(pointsLedgerTable.deviceId, `${PREFIX}%`));
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${PREFIX}%`));
  await db.delete(weeklyResultsTable).where(like(weeklyResultsTable.deviceId, `${PREFIX}%`));
}

async function profile(suffix: string, values: { points?: number; createdAt?: Date } = {}) {
  await db.insert(profilesTable).values({
    deviceId: dev(suffix),
    username: `LbWeek${suffix}`,
    points: values.points ?? 0,
    ...(values.createdAt ? { createdAt: values.createdAt } : {}),
  });
}

async function ledger(
  suffix: string,
  points: number,
  earnedAt: Date,
  opts: { weekStart?: string; source?: string } = {},
) {
  const sightingId = nextSighting();
  await db.insert(pointsLedgerTable).values({
    deviceId: dev(suffix),
    sightingId,
    // A fresh cat each time, so the once-a-day rule never trips the fixtures.
    catId: sightingId,
    points,
    athensDay: athensDay(earnedAt),
    weekStart: opts.weekStart ?? weekStartAthens(earnedAt),
    earnedAt,
    source: opts.source ?? "live",
  });
}

const mine = (entries: Entry[]) => entries.filter((e) => e.username?.startsWith("LbWeek"));

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("GET /api/leaderboard", () => {
  it("all-time board shares places on equal points", async () => {
    await profile("tie-a", { points: 1_900_000_000 });
    await profile("tie-b", { points: 1_900_000_000 });
    await profile("tie-c", { points: 1_899_999_999 });
    const res = await request(app).get("/api/leaderboard");
    expect(res.status).toBe(200);
    const [first, second, third] = mine(res.body);
    expect(first.points).toBe(1_900_000_000);
    expect(second.points).toBe(1_900_000_000);
    expect(second.rank).toBe(first.rank);
    expect(third.rank).toBe(first.rank + 2);
    // Never exposes the device id.
    expect(JSON.stringify(res.body)).not.toContain(PREFIX);
  });

  it("breaks equal points by whoever scored last earliest, then falls back to joining order", async () => {
    await profile("ord-late", { points: 1_800_000_000 });
    await profile("ord-early", { points: 1_800_000_000 });
    await ledger("ord-late", 25, new Date("2026-03-10T10:00:00Z"));
    await ledger("ord-early", 25, new Date("2026-03-09T10:00:00Z"));
    // Zero-point ledger rows (history) don't count as scoring.
    await ledger("ord-late", 0, new Date("2026-01-01T10:00:00Z"), { source: "history" });
    await ledger("ord-early", 0, new Date("2026-04-01T10:00:00Z"), { source: "history" });
    const res = await request(app).get("/api/leaderboard");
    const codes = res.body.map((e: Entry) => e.spotterCode);
    expect(codes.indexOf(spotterCode(dev("ord-early")))).toBeLessThan(
      codes.indexOf(spotterCode(dev("ord-late"))),
    );
  });

  it("zero-point spotters never take a top-20 place", async () => {
    await profile("zero", { points: 0, createdAt: new Date("2000-01-01T00:00:00Z") });
    const res = await request(app).get("/api/leaderboard");
    expect(res.body.every((e: Entry) => e.points > 0)).toBe(true);
    expect(res.body.map((e: Entry) => e.spotterCode)).not.toContain(spotterCode(dev("zero")));
  });
});

describe("GET /api/leaderboard/week", () => {
  const now = new Date();
  const thisWeek = weekStartAthens(now);
  const lastWeekStart = weekStartAthens(new Date(weekStartInstant(thisWeek).getTime() - 1));

  it("week board counts only this Athens week's ledger", async () => {
    await profile("wk-in", { points: 5 });
    await profile("wk-old", { points: 5 });
    await profile("wk-hist", { points: 5 });
    await ledger("wk-in", 1_000_025, new Date(weekStartInstant(thisWeek).getTime() + 3_600_000), { weekStart: thisWeek });
    await ledger("wk-in", 15, new Date(weekStartInstant(thisWeek).getTime() + 7_200_000), { weekStart: thisWeek });
    await ledger("wk-old", 1_000_000_000, new Date(weekStartInstant(thisWeek).getTime() - 3_600_000), { weekStart: lastWeekStart });
    // History rows carry points 0 and may sit in this week; they must not appear.
    await ledger("wk-hist", 0, new Date(weekStartInstant(thisWeek).getTime() + 1_000), { weekStart: thisWeek, source: "history" });

    const res = await request(app).get("/api/leaderboard/week");
    expect(res.status).toBe(200);
    expect(res.body.weekStart).toBe(thisWeek);
    expect(typeof res.body.endsAt).toBe("string");
    expect(new Date(res.body.endsAt).getTime()).toBeGreaterThan(now.getTime());
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries.length).toBeLessThanOrEqual(20);
    expect(res.body.entries.every((e: Entry) => e.points > 0)).toBe(true);
    const found = mine(res.body.entries);
    const inEntry = found.find((e) => e.username === "LbWeekwk-in");
    expect(inEntry?.points).toBe(1_000_040);
    expect(found.find((e) => e.username === "LbWeekwk-old")).toBeUndefined();
    expect(found.find((e) => e.username === "LbWeekwk-hist")).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(PREFIX);
  });

  it("week board breaks ties by who reached the total first", async () => {
    await profile("tb-slow");
    await profile("tb-fast");
    await profile("tb-same-a");
    const base = weekStartInstant(thisWeek).getTime();
    // Same total of 2_000_030; the fast one got there first.
    await ledger("tb-slow", 2_000_000, new Date(base + 1_000), { weekStart: thisWeek });
    await ledger("tb-slow", 30, new Date(base + 9_000), { weekStart: thisWeek });
    await ledger("tb-fast", 2_000_030, new Date(base + 5_000), { weekStart: thisWeek });
    await ledger("tb-same-a", 2_000_030, new Date(base + 5_000), { weekStart: thisWeek });
    const res = await request(app).get("/api/leaderboard/week");
    const found = mine(res.body.entries).filter((e) => e.username?.startsWith("LbWeektb-"));
    expect(found.map((e) => e.points)).toEqual([2_000_030, 2_000_030, 2_000_030]);
    expect(found[2]!.username).toBe("LbWeektb-slow");
    // Equal points share a rank.
    expect(new Set(found.map((e) => e.rank)).size).toBe(1);
  });

  it('lastWeek is empty before the first close and shows "a spotter" for a deleted winner', async () => {
    // Nothing written for the previous week: empty.
    await db.delete(weeklyResultsTable).where(sql`week_start = ${lastWeekStart}::date`);
    const before = await request(app).get("/api/leaderboard/week");
    expect(before.body.lastWeek).toEqual([]);

    await db.insert(weeklyResultsTable).values([
      { weekStart: lastWeekStart, place: 1, deviceId: null, displayName: null, points: 90 },
      { weekStart: lastWeekStart, place: 2, deviceId: dev("lw2"), displayName: "Maria", points: 70 },
    ]);
    try {
      const after = await request(app).get("/api/leaderboard/week");
      expect(after.body.lastWeek).toEqual([
        { place: 1, name: null, points: 90 },
        { place: 2, name: "Maria", points: 70 },
      ]);
    } finally {
      await db.delete(weeklyResultsTable).where(sql`week_start = ${lastWeekStart}::date`);
    }
  });
});
