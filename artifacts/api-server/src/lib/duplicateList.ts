import {
  catsTable,
  db,
  duplicateDecisionsTable,
  duplicateReportsTable,
  photosTable,
  profilesTable,
  sightingMatchesTable,
} from "@workspace/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { canonicalCatOf, liveCats } from "./catIdentity";
import { countingPhones } from "./countingPhone";

// The Possible duplicates list (which-cat-is-which.md §3.2, §3.3, §9.6;
// SYC-59 PR 5.1). Team-only: no public route reads these tables. A pair's
// state, its ladder step and whether it is on the list are all worked out
// here, on read, from the add-only reports and decisions; nothing is stored.
//
// The ladder and the points share one rule for "who counts as a person"
// (lib/countingPhone.ts), so the list and the merge's 10 points can never
// disagree.

/** Rows nobody decides fade from view after this many days; they are kept (§3.3). */
export const FADE_DAYS = 60;

/** A "different" pair reopens on this many new people saying "same cat" (§9.6). */
export const REOPEN_VOICES = 2;

export type Level = "likely" | "possible";

export interface ListedReport {
  id: number;
  source: string;
  says: string;
  /** Null for a team or game report, and once a deleted spotter's is cleared. */
  deviceId: string | null;
  /** The device was cleared because the spotter was deleted (§9.6, §8). */
  redacted: boolean;
  sightingId: number | null;
  score: number | null;
  createdAt: Date;
}

export interface PairDecision {
  id: number;
  decision: string;
  note: string | null;
  createdAt: Date;
}

/** Reports from a phone: the two sources a spotter's own words come through. */
const PHONE_SOURCES = new Set(["spotter_question", "new_cat_check"]);

/** Syros calendar day (Europe/Athens), "2026-10-28". */
export const syrosDay = (d: Date): string => d.toLocaleDateString("en-CA", { timeZone: "Europe/Athens" });

/**
 * One person's voice. A deleted spotter's reports are cleared of their
 * device, and all of one person's cleared reports count as one voice
 * (§9.6); we cannot tell the cleared people apart, so all of a pair's
 * cleared reports are one voice.
 */
const voiceOf = (r: ListedReport): string | null => (r.deviceId !== null ? r.deviceId : r.redacted ? "cleared" : null);

/**
 * Does this report put the pair on the list at all? A spotter's "different"
 * or "not sure" never does by itself (it is shown on a row that is there for
 * another reason); every other source's report does, unless it says
 * "different".
 */
export const listable = (r: ListedReport): boolean => r.says !== "different" && (r.says === "same" || r.source !== "spotter_question");

/** "Same cat" answers from a person who counts (§3.2): the only ones the ladder and the reopen rule use. */
export function countingSayings(reports: readonly ListedReport[], counting: ReadonlySet<string>): ListedReport[] {
  return reports.filter(
    (r) =>
      r.says === "same" &&
      PHONE_SOURCES.has(r.source) &&
      voiceOf(r) !== null &&
      // A cleared voice still counts as evidence (§9.6).
      (r.deviceId === null || counting.has(r.deviceId)),
  );
}

/**
 * The ladder (§3.2, §9.6), worked out from the pair's reports:
 *
 * - Likely: two "same" reports from different counting phones on different
 *   Syros days; or one such "same" plus a sweep report; or a game report.
 * - Possible: anything else.
 *
 * A near-tie in the photo check is never a report, so can never be evidence.
 * New phones' reports never reach Likely, however many (§3.2).
 */
export function ladder(reports: readonly ListedReport[], counting: ReadonlySet<string>): Level {
  if (reports.some((r) => r.source === "game" && r.says !== "different")) return "likely";
  const said = countingSayings(reports, counting);
  if (said.length > 0 && reports.some((r) => r.source === "sweep" && r.says !== "different")) return "likely";
  for (let i = 0; i < said.length; i++) {
    for (let j = i + 1; j < said.length; j++) {
      if (voiceOf(said[i]!) !== voiceOf(said[j]!) && syrosDay(said[i]!.createdAt) !== syrosDay(said[j]!.createdAt)) return "likely";
    }
  }
  return "possible";
}

/**
 * Does a "different" pair come back (§9.6)? Only with two new people saying
 * "same cat" (counting phones, reports dated after the decision), or a
 * sweep report made after one of the two cats' main photo changed after
 * the decision. `afterDecision` holds only reports dated after it.
 */
export function reopens(afterDecision: readonly ListedReport[], counting: ReadonlySet<string>, mainPhotoChanged: boolean): boolean {
  const voices = new Set(countingSayings(afterDecision, counting).map(voiceOf));
  if (voices.size >= REOPEN_VOICES) return true;
  return mainPhotoChanged && afterDecision.some((r) => r.source === "sweep" && r.says !== "different");
}

export interface DuplicatePair {
  /** Canonical ids now, low < high. */
  low: number;
  high: number;
  level: Level;
  /** The reports the row stands on (after a "different" or an undone merge, only those dated after it). */
  reports: ListedReport[];
  /** The team's "not sure yet" note, with the decision standing. */
  notSure: { note: string | null; at: Date } | null;
  /** The pair was decided "different" and has come back on new evidence. */
  reopened: boolean;
  /** Newest report (or the decision, for "not sure yet"). */
  newest: Date;
  /** Reports whose phone does not count yet, by device. */
  newPhones: ReadonlySet<string>;
}

/** The newest decision of each canonical pair, and the pair's reports. */
const pairKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;

/** Cats whose current main photo is newer than `since`, among these. */
async function mainPhotoNewerThan(catIds: readonly number[], since: Date): Promise<boolean> {
  if (catIds.length === 0) return false;
  const rows = await liveCats({ at: photosTable.createdAt }, { where: inArray(catsTable.id, [...catIds]) }).innerJoin(
    photosTable,
    eq(photosTable.id, catsTable.primaryPhotoId),
  );
  return rows.some((r) => r.at.getTime() > since.getTime());
}

/**
 * Every pair on the list now, Likely first and then newest. A pair is on the
 * list when it has a report that puts it there and its newest decision has
 * not taken it off (§9.6):
 *
 * - merged: off. (A merge undone starts it again, from reports made after the undo.)
 * - different: off, until the reopen rule fires. It then stands on the
 *   reports dated after the decision.
 * - not sure yet: stays, with the team's note, and never fades.
 *
 * Rows nobody has decided fade from view when their newest report is more
 * than {@link FADE_DAYS} days old; they are kept.
 */
export async function listDuplicates(now: Date = new Date()): Promise<DuplicatePair[]> {
  const reports = await db.select().from(duplicateReportsTable);
  const decisions = await db.select().from(duplicateDecisionsTable);
  if (reports.length === 0) return [];

  const ids = [...new Set([...reports, ...decisions].flatMap((r) => [r.catLow, r.catHigh]))];
  const canon = await canonicalCatOf(ids);
  // A cat that no longer exists, or is part of another, leaves the list.
  const standing = [...new Set([...canon.values()].filter((c): c is number => c !== null))];
  const real = new Set(
    standing.length === 0 ? [] : (await liveCats({ id: catsTable.id }, { where: inArray(catsTable.id, standing) })).map((c) => c.id),
  );
  const pairOf = (low: number, high: number): [number, number] | null => {
    const a = canon.get(low) ?? null;
    const b = canon.get(high) ?? null;
    if (a === null || b === null || a === b || !real.has(a) || !real.has(b)) return null;
    return a < b ? [a, b] : [b, a];
  };

  const byPair = new Map<string, { pair: [number, number]; reports: ListedReport[]; decisions: PairDecision[] }>();
  const slot = (pair: [number, number]) => {
    const key = pairKey(pair[0], pair[1]);
    let s = byPair.get(key);
    if (!s) byPair.set(key, (s = { pair, reports: [], decisions: [] }));
    return s;
  };
  for (const r of reports) {
    const pair = pairOf(r.catLow, r.catHigh);
    if (pair) {
      slot(pair).reports.push({
        id: r.id,
        source: r.source,
        says: r.says,
        deviceId: r.deviceId,
        redacted: r.redactedAt !== null,
        sightingId: r.sightingId,
        score: r.score,
        createdAt: r.createdAt,
      });
    }
  }
  for (const d of decisions) {
    const pair = pairOf(d.catLow, d.catHigh);
    if (pair && byPair.has(pairKey(pair[0], pair[1]))) {
      slot(pair).decisions.push({ id: d.id, decision: d.decision, note: d.note, createdAt: d.createdAt });
    }
  }

  const counting = await countingPhones(reports.map((r) => r.deviceId));
  const out: DuplicatePair[] = [];
  for (const { pair, reports: all, decisions: ds } of byPair.values()) {
    ds.sort((x, y) => x.id - y.id);
    const newest = ds[ds.length - 1] ?? null;
    let standing = all;
    let reopened = false;
    let notSure: DuplicatePair["notSure"] = null;
    if (newest?.decision === "merged") continue;
    if (newest?.decision === "different") {
      const after = all.filter((r) => r.createdAt.getTime() > newest.createdAt.getTime());
      const changed = await mainPhotoNewerThan(pair, newest.createdAt);
      if (!reopens(after, counting, changed)) continue;
      standing = after;
      reopened = true;
    } else if (newest?.decision === "merge_undone") {
      standing = all.filter((r) => r.createdAt.getTime() > newest.createdAt.getTime());
    } else if (newest?.decision === "not_sure") {
      notSure = { note: newest.note, at: newest.createdAt };
    }
    if (!standing.some(listable)) continue;
    const latest = standing.reduce((t, r) => Math.max(t, r.createdAt.getTime()), 0);
    const last = notSure ? Math.max(latest, notSure.at.getTime()) : latest;
    // Undecided rows fade; one the team marked "not sure yet" stays.
    if (!notSure && now.getTime() - latest > FADE_DAYS * 86_400_000) continue;
    out.push({
      low: pair[0],
      high: pair[1],
      level: ladder(standing, counting),
      reports: standing,
      notSure,
      reopened,
      newest: new Date(last),
      newPhones: new Set(standing.flatMap((r) => (r.deviceId !== null && !counting.has(r.deviceId) ? [r.deviceId] : []))),
    });
  }
  return out.sort(
    (a, b) => (a.level === b.level ? 0 : a.level === "likely" ? -1 : 1) || b.newest.getTime() - a.newest.getTime() || a.low - b.low || a.high - b.high,
  );
}

/** Who sent each report, for the row: a nickname, or "a spotter". Never a device id. */
export async function reporterLabels(deviceIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(deviceIds)];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ deviceId: profilesTable.deviceId, nickname: profilesTable.nickname, username: profilesTable.username })
    .from(profilesTable)
    .where(inArray(profilesTable.deviceId, ids));
  for (const r of rows) {
    const label = (r.nickname ?? "").trim() || (r.username ?? "").trim();
    if (label) out.set(r.deviceId, label);
  }
  return out;
}

/** The cat the spotter made, for each "new cat check" report's sighting. */
export async function newCatOfSightings(sightingIds: readonly number[]): Promise<Map<number, number>> {
  const ids = [...new Set(sightingIds)];
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ sightingId: sightingMatchesTable.sightingId, catId: sightingMatchesTable.chosenCatId })
    .from(sightingMatchesTable)
    .where(and(inArray(sightingMatchesTable.sightingId, ids), isNotNull(sightingMatchesTable.chosenCatId)));
  for (const r of rows) if (r.catId !== null) out.set(r.sightingId, r.catId);
  return out;
}

/** Cats a spotter named as a new cat while the photo check was down (any time). */
export async function addedWhileCheckDown(catIds: readonly number[]): Promise<Set<number>> {
  if (catIds.length === 0) return new Set();
  const rows = await db
    .select({ catId: sightingMatchesTable.chosenCatId })
    .from(sightingMatchesTable)
    .where(and(eq(sightingMatchesTable.matcherFailed, true), eq(sightingMatchesTable.choice, "new_cat"), inArray(sightingMatchesTable.chosenCatId, [...catIds])));
  return new Set(rows.flatMap((r) => (r.catId === null ? [] : [r.catId])));
}
