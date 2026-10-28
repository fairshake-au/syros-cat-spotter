import { describe, expect, it } from "vitest";
import { REPO_ROOT, sourceFiles, withoutComments } from "../test/sourceScan";

/**
 * SYC-150 (which-cat-is-which.md §9.5): `writeMovedObservation` is the only
 * writer of `observations.sighting_move_id`.
 *
 * A row carrying a move's id replaces a row of the moved sighting: a copy of
 * the spotter's answer on the new cat, or a withdrawal of someone else's on
 * the old one. Written anywhere else, it could make a spotter's guess a team
 * statement, or quietly take a statement away from a cat. The database lets
 * such a row in only with the move recorded in the same transaction; this
 * test keeps every other writer out of the code.
 *
 * Writing and reading look alike in source, so the test bans *naming* the
 * column, and each file allowed to name it says why. A reader joins the list
 * with "reads only" as its reason.
 *
 * Limits, as catIdentityGuard.test.ts: comments are stripped; tests,
 * fixtures and migrations are not scanned; a column reached through a
 * spread of a whole row (`...row`) is not seen, so the copy in
 * movedStatements.ts names every column it writes.
 */

/** File (from the repo root, with "/") -> why it may name the column. */
const ALLOWLIST: Record<string, string> = {
  "artifacts/api-server/src/lib/movedStatements.ts": "the one writer (writeMovedObservation)",
  "artifacts/api-server/src/lib/observations.ts": "reads only: loadCatRecords lists a moved statement as `elsewhere`",
  "artifacts/api-server/src/lib/moveSightings.ts":
    "the move route's lib (PR 3.2): sets the transaction-local app.sighting_move_id the triggers check, then calls writeMovedObservation; writes no statement column itself",
  "lib/db/src/schema/observations.ts": "the column's definition",
  "artifacts/api-server/src/lib/mergeCats.ts":
    "the merge and undo lib (PR 4.1): an undo sets the transaction-local app.sighting_move_id for each move back, then calls writeMovedObservation for the late answers; writes no statement column itself",
};

const TERMS = [/\bsighting_move_id\b/, /\bsightingMoveId\b/];

export function filesNamingSightingMoveId(root: string = REPO_ROOT): string[] {
  return sourceFiles(root)
    .filter(({ code }) => TERMS.some((t) => t.test(code)))
    .map(({ rel }) => rel);
}

describe("SYC-150: only writeMovedObservation writes observations.sighting_move_id", () => {
  it("finds no other file naming the column", () => {
    const unlisted = filesNamingSightingMoveId().filter((f) => !(f in ALLOWLIST));
    expect(
      unlisted,
      "These files name sighting_move_id / sightingMoveId. Only lib/movedStatements.ts writes a moved statement; " +
        "a reader that needs the column joins the allowlist with its reason.",
    ).toEqual([]);
  });

  it("lists no file that has stopped naming it (so the list stays honest)", () => {
    const found = new Set(filesNamingSightingMoveId());
    expect(Object.keys(ALLOWLIST).filter((f) => !found.has(f))).toEqual([]);
  });

  it("sees the column in code, in either spelling, and not in a comment", () => {
    expect(withoutComments("db.insert(observationsTable).values({ sightingMoveId: 1 })")).toMatch(TERMS[1]!);
    expect(withoutComments("sql`insert into observations (sighting_move_id) values (1)`")).toMatch(TERMS[0]!);
    expect(withoutComments("// sighting_move_id\n/* sightingMoveId */ const x = 1;")).not.toMatch(/sighting_move_id|sightingMoveId/);
  });
});
