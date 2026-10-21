import { CELL_LAT_DEG, CELL_LNG_DEG } from "@workspace/geo";
import { namedAreasAt } from "../areas/areaHistory";
import { OFF_SYROS, areaForIn, type NamedArea } from "../areas/namedAreas";
import { cellCentre, cellOf, cellsFrom, sightingsIn, type Cell, type SightingPoint } from "../dashboard/coverageCells";
import { weeksIn, type Range } from "./range";

// Coverage and spotting (SYC-396 PR 3.3b, Task 3.3b.1; spec §9.3 report 3).
// Where spotters have looked in the period, and where to send them next.
//
// - The island as 250 m squares (coverageCells, plan Decision 13): shaded
//   where something was sighted, outlined "Not looked at yet" within 500 m of
//   a named area's centre with nothing sighted. Only squares on Syros (within
//   2 km of an area centre) are drawn; sightings further off are counted.
// - Sightings per week, and how many spotters sent at least one. Spotters are
//   a count, never a list: nobody is named or ranked (D6). `sightings` has no
//   account, so a spotter is a device. A deleted spotter's sightings have no
//   device: they count as sightings but not as spotters, and the page says so.
//
// No position leaves this module except as a square's row and column on the
// public grid, or an area centre's place on that grid, which the page turns
// into whole-number picture coordinates. These are sightings, not cats, so
// countedCats' street-cat rules (§9.5) don't apply: any sighting shows that
// someone looked there.
//
// Team-only: registered in guardianView.source.test.ts ISLAND_ONLY_MODULES
// (view_reports, export_report) until the guardian variant (SYC-472).

export interface CoverageArea {
  area: string;
  /** Squares with a sighting in the period. */
  seen: number;
  /** Squares within 500 m of the area's centre with nothing sighted. */
  notLookedAt: number;
  sightings: number;
}

export interface CoverageReport {
  /** The squares on Syros, north to south, each with the area it's in. */
  cells: (Cell & { area: string })[];
  /** Each area's centre on the grid, in squares (fractional), for its name on the map. */
  labels: { name: string; row: number; col: number }[];
  perWeek: { at: Date; sightings: number }[];
  sightings: number;
  spotters: number;
  /** Sightings whose spotter has since been deleted (no device). */
  withoutSpotter: number;
  /** Sightings more than 2 km from every area centre: counted, not drawn. */
  offSyros: number;
  /** Most squares not looked at first, then by name. */
  areas: CoverageArea[];
  areasVersion: number;
  workedOutAt: Date;
  ms: number;
}

/** Which week each moment falls in: the last week start at or before it. */
export function bucketWeeks<T>(starts: readonly Date[], items: readonly T[], at: (t: T) => Date): number[] {
  const counts = starts.map(() => 0);
  for (const item of items) {
    const t = at(item).getTime();
    let i = starts.length - 1;
    while (i > 0 && starts[i]!.getTime() > t) i--;
    if (i >= 0 && starts[i]!.getTime() <= t) counts[i]!++;
  }
  return counts;
}

/** The report from its inputs. Pure. */
export function coverageFrom(
  points: readonly SightingPoint[],
  areas: readonly NamedArea[],
  range: Range,
): Omit<CoverageReport, "areasVersion" | "workedOutAt" | "ms"> {
  const areaOf = (p: { lat: number; lng: number }) => areaForIn(areas, p.lat, p.lng);
  // On Syros by its square's centre, as the squares are, so the areas table and the map always agree (review of PR 3.3b).
  const onSyros = points.filter((p) => {
    const c = cellOf(p);
    return areaOf(cellCentre(c.row, c.col)).key !== OFF_SYROS.key;
  });
  const cells = cellsFrom(onSyros, areas)
    .map((c) => ({ ...c, areaKey: areaOf(cellCentre(c.row, c.col)) }))
    .filter((c) => c.areaKey.key !== OFF_SYROS.key);

  const byArea = new Map<string, CoverageArea>(areas.map((a) => [a.key, { area: a.name, seen: 0, notLookedAt: 0, sightings: 0 }]));
  for (const c of cells) {
    const row = byArea.get(c.areaKey.key);
    if (!row) continue;
    if (c.seen) row.seen++;
    else row.notLookedAt++;
  }
  for (const p of onSyros) {
    const c = cellOf(p);
    const row = byArea.get(areaOf(cellCentre(c.row, c.col)).key);
    if (row) row.sightings++;
  }

  const first = points[0]?.at ?? range.to;
  const starts = weeksIn(range, first);
  const counts = bucketWeeks(starts, points, (p) => p.at);

  return {
    cells: cells.map(({ areaKey, ...c }) => ({ ...c, area: areaKey.name })),
    labels: areas.map((a) => ({ name: a.name, row: a.lat / CELL_LAT_DEG, col: a.lng / CELL_LNG_DEG })),
    perWeek: starts.map((at, i) => ({ at, sightings: counts[i]! })),
    sightings: points.length,
    spotters: new Set(points.flatMap((p) => (p.deviceId === null ? [] : [p.deviceId]))).size,
    withoutSpotter: points.filter((p) => p.deviceId === null).length,
    offSyros: points.length - onSyros.length,
    areas: [...byArea.values()].sort((a, b) => b.notLookedAt - a.notLookedAt || a.area.localeCompare(b.area, "el")),
  };
}

export async function coverageReport(range: Range, now: Date): Promise<CoverageReport> {
  const started = Date.now();
  const [points, areas] = await Promise.all([sightingsIn(range), namedAreasAt(range.to)]);
  return { ...coverageFrom(points, areas.areas, range), areasVersion: areas.version, workedOutAt: now, ms: Date.now() - started };
}
