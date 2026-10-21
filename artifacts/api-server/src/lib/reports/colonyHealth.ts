import { coloniesTable, db } from "@workspace/db";
import { colonyFigures, type ColonyFlag } from "../dashboard/colonyFigures";
import { isActive, notSeenLately } from "../dashboard/countedCats";
import { colonyFilter, type Visible } from "../guardianView";
import { namedAreasAt } from "../areas/areaHistory";
import { loadTeamCats, type TeamCat } from "../teamCatList";
import type { Range } from "./range";

// Colony health (SYC-396 PR 3.3a, Task 3.3a.3; spec §9.3 report 2): one row
// per colony, worked out at the end of the range.
//
// - Cats now: its active cats on Syros, as the Colonies list counts them.
// - Change over 90 days: cats now, less the cats it had 90 days before, with
//   that count read as the records stood then ("as of", Decision 10).
// - Kittens reported, guardian yes or no and last visit come from
//   `colonyFigures`, so they match the Colonies list's flags exactly. Last
//   visit is the latest resolved sighting of any of its cats.
// - Not seen lately: countedCats' `notSeenLately`, street cats only.
//
// Patterns, not performance (D6): nobody is named, and "guardian" is only yes
// or no. Team-only for now: guardianView.source.test.ts holds every call to
// a route behind view_reports, which answers for island rows only until the
// guardian variant (SYC-472).

const DAY = 86_400_000;
export const CHANGE_DAYS = 90;

export interface HealthRow {
  colonyId: number;
  name: string;
  catsNow: number;
  /** Cats now less cats CHANGE_DAYS before. */
  change: number;
  kittens: boolean;
  notSeenLately: number;
  guardian: boolean;
  lastVisit: Date | null;
  flags: ColonyFlag[];
}

export const HEALTH_SORTS = ["name", "cats", "change", "kittens", "notseen", "guardian", "lastvisit"] as const;
export type HealthSort = (typeof HEALTH_SORTS)[number];
export type SortDir = "asc" | "desc";

export interface HealthReport {
  rows: HealthRow[];
  areasVersion: number;
  workedOutAt: Date;
  ms: number;
}

/** Active cats on Syros in each colony, as the Colonies list counts its cats. */
function countByColony(cats: readonly TeamCat[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const c of cats) {
    if (c.colonyId === null || !isActive(c) || c.areaKey === "off") continue;
    out.set(c.colonyId, (out.get(c.colonyId) ?? 0) + 1);
  }
  return out;
}

export async function colonyHealthReport(visible: Visible, range: Range, now: Date): Promise<HealthReport> {
  const started = Date.now();
  const end = range.to;
  const atEnd = end.getTime() === now.getTime() ? undefined : end;
  const before = new Date(end.getTime() - CHANGE_DAYS * DAY);
  const [colonies, figures, catsEnd, catsBefore, areas] = await Promise.all([
    db
      .select({ id: coloniesTable.id, name: coloniesTable.name, createdAt: coloniesTable.createdAt })
      .from(coloniesTable)
      .where(colonyFilter(coloniesTable.id, visible)),
    colonyFigures(visible, { island: true }, end),
    loadTeamCats(end, { asOf: atEnd }),
    loadTeamCats(before, { asOf: before }),
    namedAreasAt(end),
  ]);
  const nowCount = countByColony(catsEnd);
  const thenCount = countByColony(catsBefore);
  const quiet = new Map<number, number>();
  for (const c of notSeenLately(catsEnd, end)) {
    if (c.colonyId !== null) quiet.set(c.colonyId, (quiet.get(c.colonyId) ?? 0) + 1);
  }

  const rows = colonies
    .filter((c) => c.createdAt.getTime() <= end.getTime())
    .map((c): HealthRow => {
      const f = figures.get(c.id);
      const flags = f?.flags ?? [];
      const catsNow = nowCount.get(c.id) ?? 0;
      return {
        colonyId: c.id,
        name: c.name,
        catsNow,
        change: catsNow - (thenCount.get(c.id) ?? 0),
        kittens: flags.includes("kittens"),
        notSeenLately: quiet.get(c.id) ?? 0,
        guardian: !flags.includes("no_guardian"),
        lastVisit: f?.latestSightingAt ?? null,
        flags,
      };
    });
  return { rows, areasVersion: areas.version, workedOutAt: now, ms: Date.now() - started };
}

/** Sorted by one column (an allowed one; anything else is by name), ties by name. Pure. */
export function sortHealth(rows: readonly HealthRow[], sort: HealthSort, dir: SortDir): HealthRow[] {
  const key = (r: HealthRow): number | string | null => {
    switch (sort) {
      case "cats":
        return r.catsNow;
      case "change":
        return r.change;
      case "kittens":
        return r.kittens ? 1 : 0;
      case "notseen":
        return r.notSeenLately;
      case "guardian":
        return r.guardian ? 1 : 0;
      case "lastvisit":
        return r.lastVisit?.getTime() ?? null;
      default:
        return r.name;
    }
  };
  const byName = (a: HealthRow, b: HealthRow) => a.name.localeCompare(b.name, "el") || a.colonyId - b.colonyId;
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    // Never visited goes last either way.
    if (ka === null || kb === null) return (ka === null ? 1 : 0) - (kb === null ? 1 : 0) || byName(a, b);
    if (typeof ka === "string" && typeof kb === "string") return sign * ka.localeCompare(kb, "el") || a.colonyId - b.colonyId;
    return sign * ((ka as number) - (kb as number)) || byName(a, b);
  });
}
