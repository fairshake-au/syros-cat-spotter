import { db, welfareReportsTable } from "@workspace/db";
import { and, gte, lte, or, sql } from "drizzle-orm";
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
// A report counts on the day it was sent (submitted_at). A draft counts on the
// day it was started, and a report started in the range but sent after it
// ends counts as a draft there, as things stood then ("as of" is entered by
// then, Decision 10; review of PR 3.3b).
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

/** One row of the read: what kind it is, when it was started and sent, and where (positions stay here). */
export interface WelfareRow {
  kind: string;
  severity: "urgent" | "attention";
  isLitter: boolean;
  lat: number | null;
  lng: number | null;
  createdAt: Date;
  /** When it was sent (submitted_at, else created_at); null while it is still a draft. */
  sentAt: Date | null;
}

/** The report from its rows. Pure. */
export function patternsFrom(rows: readonly WelfareRow[], areas: readonly NamedArea[], range: Range): Omit<WelfarePatterns, "areasVersion" | "workedOutAt" | "ms"> {
  const from = range.from?.getTime() ?? -Infinity;
  const to = range.to.getTime();
  const inRange = (d: Date) => d.getTime() >= from && d.getTime() <= to;
  // Sent by the end of the range ("as of" is entered by then, Decision 10).
  const sentBy = (r: WelfareRow) => r.sentAt !== null && r.sentAt.getTime() <= to;
  const sent = rows.filter((r) => r.kind === "welfare" && r.sentAt !== null && inRange(r.sentAt)).map((r) => ({ ...r, at: r.sentAt! }));
  // Started in the range and not sent by its end, even if it was sent later: a draft as things stood then.
  const drafts = rows.filter((r) => r.kind === "welfare" && inRange(r.createdAt) && !sentBy(r)).length;
  const contentReports = rows.filter((r) => r.kind === "content" && r.sentAt !== null && inRange(r.sentAt)).length;

  // From the start of the range, so quiet weeks before the first report are drawn as zero (ship review).
  const first = range.from ?? sent.reduce<Date>((m, r) => (r.at < m ? r.at : m), range.to);
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
  const sentAt = sql<Date | null>`case when ${w.isDraft} then null else coalesce(${w.submittedAt}, ${w.createdAt}) end`.mapWith(w.createdAt);
  const [rows, areas] = await Promise.all([
    db
      .select({ kind: w.kind, severity: w.severity, isLitter: w.isLitter, lat: w.lat, lng: w.lng, createdAt: w.createdAt, sentAt })
      .from(w)
      .where(
        and(
          lte(w.createdAt, range.to),
          range.from === null ? undefined : or(gte(w.createdAt, range.from), gte(w.submittedAt, range.from)),
        ),
      ),
    namedAreasAt(range.to),
  ]);
  const typed = rows.map((r) => ({ ...r, severity: r.severity === "urgent" ? ("urgent" as const) : ("attention" as const) }));
  return { ...patternsFrom(typed, areas.areas, range), areasVersion: areas.version, workedOutAt: now, ms: Date.now() - started };
}
