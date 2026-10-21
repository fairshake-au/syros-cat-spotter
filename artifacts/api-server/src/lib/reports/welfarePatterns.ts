import { db, welfareReportsTable } from "@workspace/db";
import { and, gte, lte, sql } from "drizzle-orm";
import { namedAreasAt } from "../areas/areaHistory";
import { areaForIn, type NamedArea } from "../areas/namedAreas";
import { WELFARE_ORDER, kindOf, type WelfareKind } from "../dashboard/welfareKinds";
import { bucketWeeks } from "./coverage";
import { weeksIn, type Range } from "./range";

// Welfare patterns (SYC-396 PR 3.3b, Task 3.3b.2; spec §9.3 report 4).
// Patterns, not performance.
//
// - Welfare reports per week, split into Urgent, Needs attention and Litter
//   (welfareKinds: every report in exactly one kind, Decision 11).
// - "Started, not sent" (drafts) counted separately.
// - "Report an issue" rows (kind = 'content') are about photos and names,
//   not welfare: their own count, "Problems reported with photos or names",
//   and never on the welfare chart or in the areas table.
// - The named areas with the most welfare reports. A report's area comes
//   from its position, which never leaves this module.
//
// **No response times, no "time open", no per-person figures (D6).** The
// query selects no state, no state change time and no one who changed it:
// welfarePatterns.test.ts fails if this file names them, with a mutation
// probe. Nothing here says who sent a report or who handled it.
//
// A report counts on the day it was sent (submitted_at), or on the day it was
// started if it never was (a draft). "As of" is entered by then (Decision 10).
//
// welfareKindGuard.test.ts: this file reads welfare_reports, and decides both
// kinds: welfare rows feed the chart, drafts and the areas; content rows are
// only counted.

export interface WelfareWeek {
  at: Date;
  counts: Record<WelfareKind, number>;
}

export interface WelfarePatterns {
  perWeek: WelfareWeek[];
  /** Welfare reports sent in the period (the chart's total). */
  total: number;
  drafts: number;
  contentReports: number;
  /** Areas with at least one report, most first; at most TOP_AREAS. */
  topAreas: { area: string; count: number }[];
  areasVersion: number;
  workedOutAt: Date;
  ms: number;
}

export const TOP_AREAS = 10;

/** One row of the read: what kind it is, when it counts, and where (positions stay here). */
export interface WelfareRow {
  kind: string;
  isDraft: boolean;
  severity: "urgent" | "attention";
  isLitter: boolean;
  lat: number | null;
  lng: number | null;
  at: Date;
}

/** The report from its rows. Pure. */
export function patternsFrom(rows: readonly WelfareRow[], areas: readonly NamedArea[], range: Range): Omit<WelfarePatterns, "areasVersion" | "workedOutAt" | "ms"> {
  const sent = rows.filter((r) => r.kind === "welfare" && !r.isDraft);
  const drafts = rows.filter((r) => r.kind === "welfare" && r.isDraft).length;
  const contentReports = rows.filter((r) => r.kind === "content" && !r.isDraft).length;

  const first = sent.reduce<Date>((m, r) => (r.at < m ? r.at : m), range.to);
  const starts = weeksIn(range, first);
  const perWeek: WelfareWeek[] = starts.map((at) => ({ at, counts: { urgent: 0, attention: 0, litter: 0 } }));
  for (const kind of WELFARE_ORDER) {
    const counts = bucketWeeks(starts, sent.filter((r) => kindOf(r) === kind), (r) => r.at);
    counts.forEach((n, i) => (perWeek[i]!.counts[kind] = n));
  }

  const byArea = new Map<string, number>();
  for (const r of sent) {
    if (r.lat === null || r.lng === null) continue;
    const name = areaForIn(areas, r.lat, r.lng).name;
    byArea.set(name, (byArea.get(name) ?? 0) + 1);
  }
  const topAreas = [...byArea.entries()]
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => b.count - a.count || a.area.localeCompare(b.area, "el"))
    .slice(0, TOP_AREAS);

  return { perWeek, total: sent.length, drafts, contentReports, topAreas };
}

export async function welfarePatterns(range: Range, now: Date): Promise<WelfarePatterns> {
  const started = Date.now();
  const w = welfareReportsTable;
  const at = sql<Date>`coalesce(${w.submittedAt}, ${w.createdAt})`.mapWith(w.createdAt);
  const [rows, areas] = await Promise.all([
    db
      .select({ kind: w.kind, isDraft: w.isDraft, severity: w.severity, isLitter: w.isLitter, lat: w.lat, lng: w.lng, at })
      .from(w)
      .where(and(lte(w.createdAt, range.to), lte(at, range.to), range.from === null ? undefined : gte(at, range.from))),
    namedAreasAt(range.to),
  ]);
  const typed = rows.map((r) => ({ ...r, severity: r.severity === "urgent" ? ("urgent" as const) : ("attention" as const) }));
  return { ...patternsFrom(typed, areas.areas, range), areasVersion: areas.version, workedOutAt: now, ms: Date.now() - started };
}
