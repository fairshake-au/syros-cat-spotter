import { catsTable, db, duplicateDecisionsTable, newCatChecksTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { canonicalCatOf, liveCats } from "./catIdentity";

// The team's answers on the Possible duplicates list and "New cats to check"
// (which-cat-is-which.md §3.3, §9.6; SYC-59 PR 5.1). Both tables are
// add-only: a pair's state is its newest decision, and "Checked, it's new"
// is a row about one cat. A merge is not here: "Same cat, merge…" opens the
// merge screen, and `mergeCats` writes its own `merged` decision.

export const NOTE_MAX = 500;

export const DECIDE_WORDS = {
  notFound: "That cat doesn't exist.",
  merged: "Those two have already been joined into one cat.",
} as const;

export type DecideRefusal = { code: "NOT_FOUND" | "SAME_CAT"; message: string };

/** Both cats are real, standing cats and not already one cat: their canonical ids, low < high. */
async function standingPair(a: number, b: number): Promise<{ ok: true; low: number; high: number } | { ok: false; refused: DecideRefusal }> {
  const canon = await canonicalCatOf([a, b]);
  const ca = canon.get(a) ?? null;
  const cb = canon.get(b) ?? null;
  if (ca === null || cb === null) return { ok: false, refused: { code: "NOT_FOUND", message: DECIDE_WORDS.notFound } };
  if (ca === cb) return { ok: false, refused: { code: "SAME_CAT", message: DECIDE_WORDS.merged } };
  const found = await liveCats({ id: catsTable.id }, { where: inArray(catsTable.id, [ca, cb]) });
  if (found.length !== 2) return { ok: false, refused: { code: "NOT_FOUND", message: DECIDE_WORDS.notFound } };
  return { ok: true, low: Math.min(ca, cb), high: Math.max(ca, cb) };
}

/** "Different cats" or "Not sure yet" (with the note that says what would settle it). */
export async function decidePair(
  person: { id: string },
  input: { a: number; b: number; decision: "different" | "not_sure"; note?: string },
): Promise<{ ok: true; low: number; high: number } | { ok: false; refused: DecideRefusal }> {
  const pair = await standingPair(input.a, input.b);
  if (!pair.ok) return pair;
  const note = (input.note ?? "").trim();
  await db.insert(duplicateDecisionsTable).values({
    catLow: pair.low,
    catHigh: pair.high,
    decision: input.decision,
    note: note === "" ? null : note,
    byAccountId: person.id,
  });
  return pair;
}

/** "Checked, it's new": the cat comes off New cats to check. Writing it twice is harmless. */
export async function checkedItsNew(person: { id: string }, catId: number): Promise<{ ok: true } | { ok: false; refused: DecideRefusal }> {
  const found = await liveCats({ id: catsTable.id }, { where: inArray(catsTable.id, [catId]) });
  if (found.length !== 1) return { ok: false, refused: { code: "NOT_FOUND", message: DECIDE_WORDS.notFound } };
  await db.insert(newCatChecksTable).values({ catId, byAccountId: person.id });
  return { ok: true };
}
