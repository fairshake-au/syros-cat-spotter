import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CELL_LAT_DEG } from "@workspace/geo";
import { db, photosTable, pool, sightingsTable } from "@workspace/db";
import { deleteTestSightings } from "../../test/sightings";
import { SEED_AREAS } from "../areas/namedAreas";
import { cellOf } from "../dashboard/coverageCells";
import { coverageTables, csvOf, renderCoveragePage } from "../teamPages/reportPages";
import { coverageFrom, coverageReport, type CoverageReport } from "./coverage";
import { parseRange } from "./range";

// SYC-396 PR 3.3b, Task 3.3b.1 (spec §9.3 report 3): Coverage and spotting.
// The database test reads a custom range in 2003, where only this file
// seeds, and asserts on deltas: the database is shared by the run.

const PREFIX = `VitestCoverage${randomBytes(3).toString("hex")}`;
const NOW = new Date("2026-10-21T10:00:00Z");
const RANGE = parseRange({ range: "3months" }, NOW);
const at = (iso: string) => new Date(iso);

// Exact positions with many decimals, so a leak would show.
const ERMOUPOLI_EXACT = { lat: 37.4447123, lng: 24.9417456 };
const KINI_EXACT = { lat: 37.4436789, lng: 24.8889123 };

const points = [
  { ...ERMOUPOLI_EXACT, at: at("2026-10-01T09:00:00Z"), deviceId: "a" },
  { lat: ERMOUPOLI_EXACT.lat + CELL_LAT_DEG / 10, lng: ERMOUPOLI_EXACT.lng, at: at("2026-10-02T09:00:00Z"), deviceId: "a" },
  { ...KINI_EXACT, at: at("2026-10-15T09:00:00Z"), deviceId: "b" },
  { ...KINI_EXACT, at: at("2026-10-16T09:00:00Z"), deviceId: null },
  // Athens: counted, not drawn.
  { lat: 37.9838, lng: 23.7275, at: at("2026-10-16T09:00:00Z"), deviceId: "c" },
];

const report = (): CoverageReport => ({ ...coverageFrom(points, SEED_AREAS, RANGE), areasVersion: 21, workedOutAt: NOW, ms: 1 });

describe("coverageFrom", () => {
  it("makes one square of two sightings in the same square", () => {
    const r = report();
    const erm = cellOf(ERMOUPOLI_EXACT);
    expect(r.cells.filter((c) => c.row === erm.row && c.col === erm.col)).toHaveLength(1);
    expect(r.cells.filter((c) => c.seen)).toHaveLength(2);
  });

  it("counts a spotter once, and a deleted spotter's sightings as sightings only", () => {
    const r = report();
    expect(r.sightings).toBe(5);
    expect(r.spotters).toBe(3);
    expect(r.withoutSpotter).toBe(1);
  });

  it("counts a sighting off Syros but doesn't draw it", () => {
    const r = report();
    expect(r.offSyros).toBe(1);
    expect(r.cells.every((c) => c.area !== "Off Syros")).toBe(true);
  });

  it("puts each sighting in its week, and the weeks add up", () => {
    const r = report();
    expect(r.perWeek.reduce((n, w) => n + w.sightings, 0)).toBe(5);
  });

  it("lists every area, most squares not looked at first", () => {
    const r = report();
    expect(r.areas).toHaveLength(SEED_AREAS.length);
    for (let i = 1; i < r.areas.length; i++) expect(r.areas[i - 1]!.notLookedAt).toBeGreaterThanOrEqual(r.areas[i]!.notLookedAt);
    expect(r.areas.find((a) => a.area === "Kini")).toMatchObject({ seen: 1, sightings: 2 });
  });
});

describe("the page and the spreadsheets hold no position at all (plan 3.3b.1)", () => {
  const LONG_DECIMAL = /\d+\.\d{3,}/;

  it("the page draws whole-number squares and names, nothing with 3 or more decimals", () => {
    const html = renderCoveragePage(report(), { personName: "Jacky", range: RANGE, canExport: true });
    const body = html.slice(html.indexOf("<main"));
    expect(body).not.toMatch(LONG_DECIMAL);
    const map = body.slice(body.indexOf('<section id="coverage">'));
    const rects = [...map.slice(0, map.indexOf("</svg>")).matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)];
    expect(rects.length).toBeGreaterThan(0);
    for (const m of rects) {
      for (const v of m.slice(1)) expect(Number.isInteger(Number(v)), m[0]).toBe(true);
    }
    // The squares say which they are, and their area, never where.
    expect(body).toContain("<title>Sighted in this period · Ermoupoli</title>");
    expect(body).toContain("Not looked at yet · Kini</title>");
    expect(body).toContain('aria-label="Squares sighted in this period, and squares not looked at yet"');
  });

  it("the spreadsheets list weeks and areas with counts, never a square's position", () => {
    const t = coverageTables(report(), true);
    for (const csv of [csvOf(t.weeks), csvOf(t.areas)]) expect(csv).not.toMatch(LONG_DECIMAL);
    expect(t.areas.columns.map((c) => c.label)).toEqual(["Area", "Squares not looked at yet", "Squares with a sighting", "Sightings"]);
  });

  it("names spotters by count only: no device id reaches the page", () => {
    const html = renderCoveragePage(
      { ...report(), ...coverageFrom([{ ...KINI_EXACT, at: at("2026-10-15T09:00:00Z"), deviceId: "device-secret-xyz" }], SEED_AREAS, RANGE) },
      { personName: "Jacky", range: RANGE, canExport: true },
    );
    expect(html).not.toContain("device-secret-xyz");
    expect(html).toContain("<strong>1</strong> spotter");
  });

  it("no coverage source prints a position with toFixed", () => {
    for (const f of ["./coverage.ts", "./coverageMap.ts", "../dashboard/coverageCells.ts"]) {
      expect(readFileSync(new URL(f, import.meta.url), "utf8"), f).not.toMatch(/toFixed/);
    }
  });
});

describe("coverageReport, from the database", () => {
  const RANGE_2003 = parseRange({ range: "custom", from: "2003-03-01", to: "2003-03-31" }, NOW);
  let photoId: number;

  beforeAll(async () => {
    const [p] = await db
      .insert(photosTable)
      .values({ publicId: `${PREFIX}photo`, data: Buffer.from("x").toString("base64"), mime: "image/jpeg" })
      .returning({ id: photosTable.id });
    photoId = p!.id;
  });

  afterAll(async () => {
    await deleteTestSightings(eq(sightingsTable.photoId, photoId));
    await pool.end();
  });

  it("counts sightings and spotters in the range, never a redacted sighting, never one outside it", async () => {
    const before = await coverageReport(RANGE_2003, NOW);
    const one = `${PREFIX}-one`;
    const two = `${PREFIX}-two`;
    await db.insert(sightingsTable).values([
      { deviceId: one, photoId, ...ERMOUPOLI_EXACT, status: "pending", createdAt: at("2003-03-10T10:00:00Z") },
      { deviceId: one, photoId, ...KINI_EXACT, status: "resolved", createdAt: at("2003-03-11T10:00:00Z") },
      { deviceId: two, photoId, ...KINI_EXACT, status: "awaiting_team", createdAt: at("2003-03-12T10:00:00Z") },
      // Redacted for privacy below: gone from every report.
      { deviceId: `${PREFIX}-gone`, photoId, ...KINI_EXACT, status: "pending", createdAt: at("2003-03-12T10:00:00Z") },
      // The day after the range.
      { deviceId: `${PREFIX}-late`, photoId, ...KINI_EXACT, status: "pending", createdAt: at("2003-04-01T10:00:00Z") },
    ]);
    await db
      .update(sightingsTable)
      .set({ deviceId: null, redactedAt: at("2003-03-13T10:00:00Z"), redactionReason: "test" })
      .where(eq(sightingsTable.deviceId, `${PREFIX}-gone`));
    const after = await coverageReport(RANGE_2003, NOW);
    expect(after.sightings - before.sightings).toBe(3);
    expect(after.spotters - before.spotters).toBe(2);
  });
});
