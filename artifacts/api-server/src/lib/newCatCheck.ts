import { db, duplicateReportsTable, type SuggestedMatch } from "@workspace/db";
import { canonicalCatOf } from "./catIdentity";
import type { DbOrTx } from "./observations";

// The new-cat check (which-cat-is-which.md §3.1 item 2, §9.6; SYC-59 PR 5.1).
// A spotter may well be right that the cat is new, so nothing blocks them.
// But when the photo check had suggested existing cats and the spotter chose
// "New cat" over them, each cat passed over goes on the Possible duplicates
// list: one `new_cat_check` report per suggestion at or above the same 0.4
// the phone showed. No fingerprint is needed at this point; the score the
// photo check gave is kept on the report.
//
// The report says `not_sure`: it is the system's flag, not a person's "same
// cat", so it can put the pair on the list (as Possible) but never counts
// towards Likely. The team sees it as "X was added as a new cat though the
// photo check had suggested Y".

/** The phone shows a suggestion only at or above this score (routes/sightings.ts CONFIDENCE_THRESHOLD). */
export const NEW_CAT_CHECK_MIN_SCORE = 0.4;

/**
 * Write the reports for a sighting resolved as a new cat. Best effort for the
 * caller (the spotter's resolve has committed): returns how many were written.
 */
export async function writeNewCatChecks(
  input: { sightingId: number; deviceId: string | null; newCatId: number; suggested: readonly SuggestedMatch[] | null | undefined },
  exec: Pick<DbOrTx, "insert"> = db,
): Promise<number> {
  const passedOver = (input.suggested ?? []).filter((s) => s.score >= NEW_CAT_CHECK_MIN_SCORE && s.catId !== input.newCatId);
  if (passedOver.length === 0) return 0;
  // A suggestion for a cat since merged away is about the cat it now is.
  const canon = await canonicalCatOf([...passedOver.map((s) => s.catId), input.newCatId]);
  const newCat = canon.get(input.newCatId) ?? input.newCatId;
  const best = new Map<number, number>();
  for (const s of passedOver) {
    const other = canon.get(s.catId) ?? null;
    if (other === null || other === newCat) continue;
    best.set(other, Math.max(best.get(other) ?? 0, s.score));
  }
  if (best.size === 0) return 0;
  await exec.insert(duplicateReportsTable).values(
    [...best].map(([other, score]) => ({
      catLow: Math.min(other, newCat),
      catHigh: Math.max(other, newCat),
      source: "new_cat_check",
      says: "not_sure",
      deviceId: input.deviceId,
      sightingId: input.sightingId,
      score,
    })),
  );
  return best.size;
}
