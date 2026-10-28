import { and, eq, inArray } from "drizzle-orm";
import {
  catsTable,
  db,
  duplicateDecisionsTable,
  duplicateReportsTable,
  type SuggestedMatch,
} from "@workspace/db";
import { canonicalCatOf, liveCats } from "./catIdentity";
import { isResolvedDeceased } from "./catHelpers";
import { isTeamDesk } from "./teamDesk";
import type { DbOrTx } from "./observations";

// "Are these the same cat?" (which-cat-is-which.md §3.1 item 1, D8, §9.6;
// SYC-59 PR 5.2). After the usual questions on the reward screen, a spotter
// who confirmed a suggested cat may be asked, once, about the look-alike the
// photo check suggested beside it. The answer is a `spotter_question`
// report; nothing about either cat changes.
//
// The question is not stored anywhere. It is worked out from the sighting's
// stored suggestions each time (at resolve to offer it, and again when the
// answer arrives to check the answer is about the pair that was offered), so
// it needs no table of its own and can never drift from the rule below.

/** Both cats must have scored at least this: the same 0.4 the phone shows a suggestion at. */
export const NEAR_TIE_MIN_SCORE = 0.4;

/** ... and within this of each other (in thousandths, so 0.55 against 0.40 is a tie, not 0.15000000000000002). */
export const NEAR_TIE_GAP_MILLI = 150;

export interface DuplicateQuestion {
  /** The cat the spotter confirmed (canonical). */
  catId: number;
  /** The look-alike the photo check suggested beside it (canonical). */
  otherCatId: number;
}

const milli = (score: number): number => Math.round(score * 1000);

/** Every pair the team has decided, newest decisions of any kind included, by canonical ids. */
async function decidedPairs(exec: DbOrTx): Promise<Set<string>> {
  const rows = await exec.select().from(duplicateDecisionsTable);
  if (rows.length === 0) return new Set();
  const canon = await canonicalCatOf([...new Set(rows.flatMap((r) => [r.catLow, r.catHigh]))]);
  const out = new Set<string>();
  for (const r of rows) {
    const a = canon.get(r.catLow) ?? null;
    const b = canon.get(r.catHigh) ?? null;
    if (a !== null && b !== null && a !== b) out.add(`${Math.min(a, b)}:${Math.max(a, b)}`);
  }
  return out;
}

/**
 * The question to offer for a sighting a spotter resolved, or null. The rule
 * (§9.6): the spotter confirmed one of the photo check's own suggestions;
 * that cat and another suggestion both scored at least 0.4 and within 0.15
 * of each other; neither cat is recorded as having died; and the team has
 * not decided the pair. With several look-alikes it is the closest score.
 */
export async function duplicateQuestionFor(
  match: { choice: string | null; chosenCatId: number | null; suggested: readonly SuggestedMatch[] | null | undefined },
  exec: DbOrTx = db,
): Promise<DuplicateQuestion | null> {
  if (match.choice !== "suggested" || match.chosenCatId === null) return null;
  const shown = (match.suggested ?? []).filter((s) => s.score >= NEAR_TIE_MIN_SCORE);
  if (shown.length < 2) return null;

  // A suggestion for a cat since merged away is about the cat it is part of now.
  const canon = await canonicalCatOf([match.chosenCatId, ...shown.map((s) => s.catId)]);
  const chosen = canon.get(match.chosenCatId) ?? null;
  if (chosen === null) return null;
  const best = new Map<number, number>();
  for (const s of shown) {
    const c = canon.get(s.catId) ?? null;
    if (c !== null) best.set(c, Math.max(best.get(c) ?? 0, s.score));
  }
  const chosenScore = best.get(chosen);
  if (chosenScore === undefined) return null;

  const close = [...best]
    .filter(([id, score]) => id !== chosen && Math.abs(milli(score) - milli(chosenScore)) <= NEAR_TIE_GAP_MILLI)
    .sort(([ia, sa], [ib, sb]) => Math.abs(milli(sa) - milli(chosenScore)) - Math.abs(milli(sb) - milli(chosenScore)) || sb - sa || ia - ib);
  if (close.length === 0) return null;

  const real = new Set((await liveCats({ id: catsTable.id }, { where: inArray(catsTable.id, [chosen, ...close.map(([id]) => id)]) })).map((c) => c.id));
  if (!real.has(chosen) || (await isResolvedDeceased(chosen, exec))) return null;
  const decided = await decidedPairs(exec);
  for (const [other] of close) {
    if (!real.has(other)) continue;
    if (decided.has(`${Math.min(chosen, other)}:${Math.max(chosen, other)}`)) continue;
    if (await isResolvedDeceased(other, exec)) continue;
    return { catId: chosen, otherCatId: other };
  }
  return null;
}

export type DuplicateAnswerRefusal = "TEAM_DESK" | "NO_QUESTION" | "ALREADY_ANSWERED";

/**
 * Record the spotter's answer as a `spotter_question` report, inside the
 * caller's transaction (which holds the lock that makes "once per sighting"
 * exact). Refused, writing nothing, when the sighting belongs to the team
 * desk, when no question was offered for this sighting (or the pair has been
 * decided since), or when it has been answered already.
 */
export async function recordDuplicateAnswer(
  tx: DbOrTx,
  input: {
    sightingId: number;
    deviceId: string;
    says: "same" | "different" | "not_sure";
    match: { choice: string | null; chosenCatId: number | null; suggested: readonly SuggestedMatch[] | null | undefined } | undefined;
  },
): Promise<{ ok: true; catLow: number; catHigh: number } | { ok: false; refused: DuplicateAnswerRefusal }> {
  // The team desk is nobody's phone: its answer is never a spotter's voice.
  if (isTeamDesk(input.deviceId)) return { ok: false, refused: "TEAM_DESK" };
  const [already] = await tx
    .select({ id: duplicateReportsTable.id })
    .from(duplicateReportsTable)
    .where(and(eq(duplicateReportsTable.sightingId, input.sightingId), eq(duplicateReportsTable.source, "spotter_question")))
    .limit(1);
  if (already) return { ok: false, refused: "ALREADY_ANSWERED" };
  const question = input.match ? await duplicateQuestionFor(input.match, tx) : null;
  if (!question) return { ok: false, refused: "NO_QUESTION" };
  const catLow = Math.min(question.catId, question.otherCatId);
  const catHigh = Math.max(question.catId, question.otherCatId);
  await tx.insert(duplicateReportsTable).values({
    catLow,
    catHigh,
    source: "spotter_question",
    says: input.says,
    deviceId: input.deviceId,
    sightingId: input.sightingId,
  });
  return { ok: true, catLow, catHigh };
}
