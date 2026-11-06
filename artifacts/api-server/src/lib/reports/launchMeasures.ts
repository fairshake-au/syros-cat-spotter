import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, sightingMatchesTable, sightingMovesTable, sightingsTable } from "@workspace/db";
import { getAppSettings } from "../appSettings";
import { athensMidnight, weeksIn, type Range } from "./range";

// Launch measures (SYC-795; launch measures spec §3–§4.5). How the app is
// used since launch, week by week: the counting rules behind the team report.
//
// - Weeks are Athens weeks, and each sighting counts in the week it was
//   spotted (created_at), exactly as Coverage counts it (§4.1): the same
//   range rule as sightingsIn, and the same week rule as bucketWeeks. The
//   one exception is Launch days (Ruling 8): only sightings from launch
//   midnight count there, since the week's earlier days were testing.
// - The launch date is a team setting (§3). The baseline is the first full
//   week starting on or after it; the part-week before is "Launch days".
//   With no date, or one after now, every week is before launch. The
//   baseline's figures are returned whatever the range (Ruling 5), so every
//   week can be set against it.
// - Each sighting falls in exactly one §4.2 group, first rule wins. Accuracy
//   (§4.3) reads what was recorded when the spotter chose, never cat numbers
//   afterwards, so a merge can't make a right answer look wrong: a correction
//   is a sighting_moves row that no merge or undo made (reason not merged or
//   merge_undone, and source not merge or undo: undoing a merge moves the
//   ticked sightings with reason "other", source "undo").
// - The checked figure (§4.3, §4.6) is only what Samuel checked through
//   Matches to check: "looks right" there, or a Different cat move from it
//   (source match_check). A correction made anywhere else counts only in
//   "Corrected by the team". The later word wins: checked right, then moved
//   anywhere, is corrected, not right.
// - Waits (§4.4) count a sighting once it has a first successful match
//   (server_wait_ms set). A later failed resend can flip matcher_failed on
//   such a row, so "matcher down" is failed with no first wait (Ruling 4).
// - Follow-up (§4.5): the loader fetches from launch (or the range's start,
//   if earlier) to 7 days past the range or the baseline, whichever is later,
//   capped at now, so "came back", "returning" and the baseline can be
//   judged. Rows outside the range are never counted in its weeks.
//
// Spotters are counts, never a list: no device id, name or position leaves
// LaunchMeasures, only counts and the dates of weeks. The pure part never
// reads a clock; `now` is always passed in.
//
// Team-only: registered in guardianView.source.test.ts ISLAND_ONLY_MODULES
// with the page (Task 5).

const DAY = 86_400_000;
const ZONE = "Europe/Athens";

/** Below this many sightings a percentage is greyed, "Too few to compare" (§2); the page draws it. */
export const FEW = 20;
/** "Not finished" is only fair this long after a week ends (§4.2). */
export const STILL_OPEN_MS = 48 * 3_600_000;
/** A phone wait over 10 minutes means the app was put away (§4.4). The database refuses more; this guards old rows. */
export const MAX_PHONE_WAIT_MS = 600_000;
const FOLLOW_UP_MS = 7 * DAY;
export const MERGE_REASONS = ["merged", "merge_undone"] as const;
export const MERGE_SOURCES = ["merge", "undo"] as const;

export type WeekLabel = "before_launch" | "launch_days" | "baseline" | "after";

/** One sighting, built by the loader. */
export interface LaunchRow {
  at: Date;
  deviceId: string | null;
  resolved: boolean;
  match: null | {
    choice: "suggested" | "hand_pick" | "new_cat" | "unlabelled" | null;
    suggestedRank: number | null;
    missKind: "matcher_miss" | "distance_miss" | null;
    comparedCount: number;
    matcherFailed: boolean;
    noCatInAnyPhoto: boolean | null;
    teamAction: string | null;
    serverWaitMs: number | null;
    phoneWaitMs: number | null;
  };
  /** A sighting_moves row no merge or undo made: reason not merged or merge_undone, source not merge or undo. */
  correctedByMove: boolean;
  /** Such a row made from Matches to check (source match_check): Samuel checked it, and it was wrong. */
  checkedByMove: boolean;
}

export type MatchGroup = "not_finished" | "no_cat" | "suggested" | "hand_pick" | "new_cat" | "other";
export type AccuracyRow = "right_first" | "right_lower" | "corrected" | "missed_compared" | "missed_far" | "missed_nothing";

const GROUPS: readonly MatchGroup[] = ["not_finished", "no_cat", "suggested", "hand_pick", "new_cat", "other"];
const ACCURACY: readonly AccuracyRow[] = ["right_first", "right_lower", "corrected", "missed_compared", "missed_far", "missed_nothing"];

export interface LaunchWeek {
  at: Date;
  label: WeekLabel;
  stillOpen: { notFinished: boolean; followUp: boolean };
  sightings: number;
  spotters: number;
  /** Of the week's spotters, those with a sighting since launch in an earlier week. */
  returning: number;
  groups: Record<MatchGroup, number>;
  /** Hand picks and new cats made while the matcher was down: no suggestions to take. */
  matcherDownInHandOrNew: number;
  accuracy: Record<AccuracyRow, number>;
  /** Suggestions Samuel checked in Matches to check: "looks right" or moved from it; right is "looks right" and never moved since. */
  checked: { right: number; total: number };
  corrected: number;
  suggestionsTaken: number;
  /** Milliseconds; nearest rank. */
  wait: { phoneP50: number | null; phoneP90: number | null; serverP50: number | null; matcherDown: number; noPhoneWait: number; overTen: number };
  followUp: { eligible: number; cameBack: number };
}

export interface LaunchMeasures {
  weeks: LaunchWeek[];
  /** The baseline week, inside the range or not; null with no launch, a future one, or before it starts (Ruling 5). */
  baseline: LaunchWeek | null;
  sightings: number;
  spotters: number;
  /** Sightings whose spotter has since been deleted (no device). */
  withoutSpotter: number;
  launchDate: string | null;
  /**
   * The earliest sighting among the rows read that has a phone wait. It can
   * fall in the 7-day follow-up tail just after the range, and that is still a
   * true "recorded from" date.
   */
  phoneWaitFrom: Date | null;
  workedOutAt: Date;
  ms: number;
}

/** The Syros calendar date of an instant. */
function athensYmd(at: Date): [number, number, number] {
  const [y, m, d] = at.toLocaleDateString("en-CA", { timeZone: ZONE }).split("-").map(Number);
  return [y!, m!, d!];
}

/** Midnight on Syros a week after a week's start (a Monday midnight), whatever the clocks did. */
function weekEnd(start: Date): Date {
  const [y, m, d] = athensYmd(start);
  return athensMidnight(y, m, d + 7);
}

/** Syros midnight at the start of a YYYY-MM-DD date, or null. */
export function launchMidnight(launchDate: string | null): Date | null {
  const m = launchDate === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(launchDate);
  return m ? athensMidnight(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/** The baseline's start: the first Monday at or after launch midnight (§3). */
function baselineStart(launch: Date): Date {
  const [y, m, d] = athensYmd(launch);
  // getUTCDay of the calendar date: 1 is Monday.
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return athensMidnight(y, m, d + ((8 - dow) % 7));
}

/** Each week's place relative to launch (§3). The baseline is fixed by the date, not by the range. */
export function weekLabels(starts: readonly Date[], launchDate: string | null): { at: Date; label: WeekLabel }[] {
  const launch = launchMidnight(launchDate);
  if (launch === null) return starts.map((at) => ({ at, label: "before_launch" }));
  const baseline = baselineStart(launch).getTime();
  return starts.map((at) => {
    const t = at.getTime();
    const label: WeekLabel =
      weekEnd(at).getTime() <= launch.getTime() ? "before_launch"
      : t < launch.getTime() ? "launch_days"
      : t === baseline ? "baseline"
      : t > baseline ? "after"
      : "launch_days";
    return { at, label };
  });
}

/** §4.2's group, in the spec's order: the first rule that applies wins. */
export function matchGroup(r: LaunchRow): MatchGroup {
  if (!r.resolved) return "not_finished";
  if (r.match?.noCatInAnyPhoto === true) return "no_cat";
  const choice = r.match?.choice;
  if (choice === "suggested" || choice === "hand_pick" || choice === "new_cat") return choice;
  return "other";
}

/** §4.3's row, or null when the sighting isn't counted (matcher failed, or not a suggestion or hand pick). */
export function accuracyRow(r: LaunchRow): AccuracyRow | null {
  const m = r.match;
  if (m === null || m.matcherFailed) return null;
  if (m.choice === "suggested") {
    if (r.correctedByMove) return "corrected";
    return m.suggestedRank === 1 ? "right_first" : "right_lower";
  }
  if (m.choice !== "hand_pick") return null;
  if (m.missKind === "matcher_miss") return "missed_compared";
  if (m.missKind === "distance_miss" && m.comparedCount > 0) return "missed_far";
  return "missed_nothing";
}

/** Nearest rank on ascending values; null when there are none. */
function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.ceil((p / 100) * sorted.length) - 1]!;
}

/** The week index of a moment: the last start at or before it (as bucketWeeks), or -1. */
function weekOf(starts: readonly Date[], t: number): number {
  let i = starts.length - 1;
  while (i >= 0 && starts[i]!.getTime() > t) i--;
  return i;
}

function waitOf(rows: readonly LaunchRow[]): LaunchWeek["wait"] {
  const phone: number[] = [];
  const server: number[] = [];
  let matcherDown = 0;
  let noPhoneWait = 0;
  let overTen = 0;
  for (const { match: m } of rows) {
    if (m === null) continue;
    // Ruling 4: timed once a first match worked, whatever a later resend did.
    if (m.serverWaitMs === null) {
      if (m.matcherFailed) matcherDown++;
      continue;
    }
    server.push(m.serverWaitMs);
    if (m.phoneWaitMs === null) noPhoneWait++;
    else if (m.phoneWaitMs > MAX_PHONE_WAIT_MS) overTen++;
    else phone.push(m.phoneWaitMs);
  }
  phone.sort((a, b) => a - b);
  server.sort((a, b) => a - b);
  return { phoneP50: percentile(phone, 50), phoneP90: percentile(phone, 90), serverP50: percentile(server, 50), matcherDown, noPhoneWait, overTen };
}

/** What every week is worked out against: each device's sightings, and its first since launch. */
interface Context {
  /** Each device's sighting times, ascending. */
  byDevice: Map<string, number[]>;
  firstSinceLaunch: Map<string, number>;
  /** Launch midnight, when launch has happened. */
  launch: number | null;
  now: number;
}

function contextOf(rows: readonly LaunchRow[], launch: number | null, now: number): Context {
  const byDevice = new Map<string, number[]>();
  const firstSinceLaunch = new Map<string, number>();
  for (const r of rows) {
    if (r.deviceId === null) continue;
    const t = r.at.getTime();
    const list = byDevice.get(r.deviceId) ?? [];
    list.push(t);
    byDevice.set(r.deviceId, list);
    if (launch !== null && t >= launch && t < (firstSinceLaunch.get(r.deviceId) ?? Infinity)) firstSinceLaunch.set(r.deviceId, t);
  }
  for (const list of byDevice.values()) list.sort((a, b) => a - b);
  return { byDevice, firstSinceLaunch, launch, now };
}

/** The first index in ascending `times` holding a value after `t`, or times.length. */
function firstAfter(times: readonly number[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid]! > t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** The device sent another sighting after `t` and within 7 days of it (§4.5). */
function cameBack(times: readonly number[], t: number): boolean {
  const i = firstAfter(times, t);
  return i < times.length && times[i]! <= t + FOLLOW_UP_MS;
}

/** One week's figures from the sightings spotted in it. The same for every week, the baseline included. */
function weekFrom(at: Date, label: WeekLabel, rows: readonly LaunchRow[], c: Context): LaunchWeek {
  // Ruling 8 (§3): Launch days are the days from launch to the next Monday; the week's earlier days are testing.
  const ws = label === "launch_days" && c.launch !== null ? rows.filter((r) => r.at.getTime() >= c.launch!) : rows;
  const end = weekEnd(at).getTime();
  const devices = new Set(ws.flatMap((r) => (r.deviceId === null ? [] : [r.deviceId])));
  const sinceLaunch = label === "baseline" || label === "after";
  const groups = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<MatchGroup, number>;
  const accuracy = Object.fromEntries(ACCURACY.map((a) => [a, 0])) as Record<AccuracyRow, number>;
  let matcherDownInHandOrNew = 0;
  const checked = { right: 0, total: 0 };
  let corrected = 0;
  let suggestionsTaken = 0;
  const followUp = { eligible: 0, cameBack: 0 };
  for (const r of ws) {
    const g = matchGroup(r);
    groups[g]++;
    if ((g === "hand_pick" || g === "new_cat") && r.match?.matcherFailed) matcherDownInHandOrNew++;
    const a = accuracyRow(r);
    if (a !== null) accuracy[a]++;
    if (r.match?.choice === "suggested") {
      suggestionsTaken++;
      if (r.correctedByMove) corrected++;
      // §4.3: checked only through Matches to check; the later word wins.
      const looksRight = r.match.teamAction === "looks_right";
      if (looksRight || r.checkedByMove) checked.total++;
      if (looksRight && !r.correctedByMove) checked.right++;
    }
    if (r.resolved && r.deviceId !== null) {
      followUp.eligible++;
      const t = r.at.getTime();
      if (cameBack(c.byDevice.get(r.deviceId)!, t)) followUp.cameBack++;
    }
  }
  return {
    at,
    label,
    stillOpen: { notFinished: end + STILL_OPEN_MS > c.now, followUp: end > c.now - FOLLOW_UP_MS },
    sightings: ws.length,
    spotters: devices.size,
    returning: sinceLaunch ? [...devices].filter((d) => (c.firstSinceLaunch.get(d) ?? Infinity) < at.getTime()).length : 0,
    groups,
    matcherDownInHandOrNew,
    accuracy,
    checked,
    corrected,
    suggestionsTaken,
    wait: waitOf(ws),
    followUp,
  };
}

/**
 * The report from its rows. Pure. `rows` may hold sightings since launch
 * before the range (returning spotters, a baseline before it), the baseline
 * week after it, and up to 7 days past either (the follow-up): only those
 * inside the range are counted in `weeks`.
 */
export function launchMeasuresFrom(rows: readonly LaunchRow[], range: Range, launchDate: string | null, now: Date): LaunchMeasures {
  const from = range.from?.getTime() ?? -Infinity;
  const to = range.to.getTime();
  const counted = rows.filter((r) => r.at.getTime() >= from && r.at.getTime() <= to);
  const first = counted.reduce<Date | null>((a, r) => (a === null || r.at < a ? r.at : a), null);
  const starts = weeksIn(range, range.from ?? first ?? range.to);

  // A launch after now hasn't happened: no baseline yet.
  const launchAt = launchMidnight(launchDate);
  const launch = launchAt !== null && launchAt.getTime() <= now.getTime() ? launchAt : null;
  const labels = weekLabels(starts, launch !== null ? launchDate : null);
  const c = contextOf(rows, launch?.getTime() ?? null, now.getTime());

  // Each sighting in its week, as Coverage's bucketWeeks puts it (§4.1).
  const perWeek = starts.map((): LaunchRow[] => []);
  for (const r of counted) {
    const i = weekOf(starts, r.at.getTime());
    if (i >= 0) perWeek[i]!.push(r);
  }
  const weeks = starts.map((at, i) => weekFrom(at, labels[i]!.label, perWeek[i]!, c));

  // Ruling 5: the baseline's figures whatever the range, so every week can be set against it.
  let baseline: LaunchWeek | null = null;
  const b = launch === null ? null : baselineStart(launch);
  if (b !== null && b.getTime() <= now.getTime()) {
    const bEnd = weekEnd(b).getTime();
    const i = starts.findIndex((s) => s.getTime() === b.getTime());
    // The range's entry only when it holds the whole week so far; otherwise the week from all the rows.
    const whole = i >= 0 && b.getTime() >= from && Math.min(bEnd - 1, now.getTime()) <= to;
    baseline = whole ? weeks[i]! : weekFrom(b, "baseline", rows.filter((r) => r.at.getTime() >= b.getTime() && r.at.getTime() < bEnd), c);
  }

  const phoneWaitFrom = rows.reduce<Date | null>((a, r) => (r.match?.phoneWaitMs != null && (a === null || r.at < a) ? r.at : a), null);
  return {
    weeks,
    baseline,
    sightings: counted.length,
    spotters: new Set(counted.flatMap((r) => (r.deviceId === null ? [] : [r.deviceId]))).size,
    withoutSpotter: counted.filter((r) => r.deviceId === null).length,
    launchDate,
    phoneWaitFrom,
    workedOutAt: now,
    ms: 0,
  };
}

/** One row per sighting spotted in [from, to], with its match record, whether the team corrected it, and whether Samuel checked it. */
async function launchRowsIn(from: Date | null, to: Date): Promise<LaunchRow[]> {
  const s = sightingsTable;
  const m = sightingMatchesTable;
  const mv = sightingMovesTable;
  const list = (xs: readonly string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);
  const notByMerge = sql`${mv.reason} not in (${list(MERGE_REASONS)}) and ${mv.source} not in (${list(MERGE_SOURCES)})`;
  const rows = await db
    .select({
      at: s.createdAt,
      deviceId: s.deviceId,
      status: s.status,
      hasMatch: sql<boolean>`${m.sightingId} is not null`,
      choice: m.choice,
      suggestedRank: m.suggestedRank,
      missKind: m.missKind,
      comparedCount: sql<number>`coalesce(cardinality(${m.comparedCatIds}), 0)::int`,
      matcherFailed: m.matcherFailed,
      noCatInAnyPhoto: m.noCatInAnyPhoto,
      teamAction: m.teamAction,
      serverWaitMs: m.serverWaitMs,
      phoneWaitMs: m.phoneWaitMs,
      // A merge (or its undo, ticked sightings included) moves sightings between records: not a correction (§4.3).
      correctedByMove: sql<boolean>`exists (select 1 from ${mv} where ${mv.sightingId} = ${s.id} and ${notByMerge})`,
      // A Different cat move from Matches to check: Samuel checked it (§4.6).
      checkedByMove: sql<boolean>`exists (select 1 from ${mv} where ${mv.sightingId} = ${s.id} and ${mv.source} = 'match_check' and ${notByMerge})`,
    })
    .from(s)
    .leftJoin(m, eq(m.sightingId, s.id))
    // sightingsIn's range rule, so Coverage and this report count the same sightings.
    .where(and(lte(s.createdAt, to), from === null ? undefined : gte(s.createdAt, from)))
    .orderBy(s.createdAt, s.id);
  return rows.map((r) => ({
    at: r.at,
    deviceId: r.deviceId,
    resolved: r.status === "resolved",
    match: r.hasMatch
      ? {
          choice: r.choice as NonNullable<LaunchRow["match"]>["choice"],
          suggestedRank: r.suggestedRank,
          missKind: r.missKind as NonNullable<LaunchRow["match"]>["missKind"],
          comparedCount: Number(r.comparedCount),
          matcherFailed: r.matcherFailed === true,
          noCatInAnyPhoto: r.noCatInAnyPhoto,
          teamAction: r.teamAction,
          serverWaitMs: r.serverWaitMs,
          phoneWaitMs: r.phoneWaitMs,
        }
      : null,
    correctedByMove: r.correctedByMove === true,
    checkedByMove: r.checkedByMove === true,
  }));
}

export async function launchMeasuresReport(range: Range, now: Date): Promise<LaunchMeasures> {
  const started = Date.now();
  const { launchDate } = await getAppSettings();
  const launch = launchMidnight(launchDate);
  // Up to 7 days past what is counted, for "came back", never past now.
  const tail = (end: number) => Math.min(end + FOLLOW_UP_MS, now.getTime());
  let from = range.from;
  let to = tail(range.to.getTime());
  if (launch !== null && launch.getTime() <= now.getTime()) {
    // From launch: returning spotters' earlier sightings, and a baseline before the range.
    if (from !== null && launch.getTime() < from.getTime()) from = launch;
    // A baseline after the range, with its own follow-up tail.
    const b = baselineStart(launch);
    if (b.getTime() <= now.getTime()) to = Math.max(to, tail(weekEnd(b).getTime()));
  }
  const rows = await launchRowsIn(from, new Date(to));
  return { ...launchMeasuresFrom(rows, range, launchDate, now), ms: Date.now() - started };
}
