import { describe, expect, it } from "vitest";
import { REPO_ROOT, lineAt, sourceFiles, sqlStrings, withoutComments } from "../test/sourceScan";

/**
 * SYC-410 (which-cat-is-which.md §9.3): one way to list or count cats.
 *
 * A cat merged into another is part of that cat, so no list, count, pool or
 * search may include it as a cat of its own. `liveCats` (lib/catIdentity.ts)
 * is the only way to list or count cats. This test fails on any source that
 * reads the `cats` table another way, unless that read is a single cat by id,
 * a lock, a name or credit lookup, and so on, which is listed below with its
 * reason. A reader that starts from another table and joins cats starts from
 * `liveCats(...)` instead, or filters with `notMergedAway(<its cat id>)`.
 *
 * Limits, said plainly (as welfareKindGuard.test.ts and catIdentityGuard.test.ts):
 *  - It reads source text with comments stripped. A table reached through a
 *    re-export under another name is not seen.
 *  - Reasons are kept one per hit, in source order. A hit swapped for another
 *    in the same file keeps the count, so whoever touches a listed file checks
 *    that its reasons still match.
 *  - Test files, fixtures and migrations are not scanned.
 *  - Closed after the review of PR 1.2: an aliased import (`catsTable as x`),
 *    a comma join in raw SQL, and raw SQL in a quoted string. Still open: a
 *    table reached through a re-export under another file's name, SQL built
 *    from pieces (`"from " + name`), and `db.execute` of a string read from
 *    elsewhere.
 *  - Writes (`update(catsTable)`, `insert(catsTable)`, raw `update cats`) are
 *    not reads and are not matched.
 */

/** The shapes of a read of the cats table, for the names this file gives `catsTable`. */
function catsShapes(names: string[]): RegExp[] {
  const t = `(?:${names.join("|")})`;
  return [
    new RegExp(`\\.(from|innerJoin|leftJoin|rightJoin|fullJoin|crossJoin)\\(\\s*${t}\\b`, "g"),
    new RegExp(`\\balias\\(\\s*${t}\\b`, "g"),
    new RegExp(`\\$\\{\\s*${t}\\s*\\}`, "g"),
    /\bquery\.cats\b/g,
    /\b(from|join)\s+cats\b/gi,
    // Rebinding the table hides every later read.
    new RegExp(`=\\s*${t}\\s*[;,)]`, "g"),
  ];
}

// A comma join in raw SQL: `from sightings s, cats c`.
const COMMA_JOIN = /,\s*cats\b(?=\s+(?:as\s+)?\w|\s*(?:where|on|,|$))/i;

/**
 * File (from the repo root, with "/") -> one reason per hit, in source order.
 * A file's hit count must equal its number of reasons: a new read in a listed
 * file turns this red as surely as a read in a new file.
 */
const ALLOWLIST: Record<string, readonly string[]> = {
  "artifacts/api-server/src/lib/moveSightings.ts": [
    "moveSightingsIn: the two cats of a move, locked by id (§9.7 lock 4)",
    "moveSightingsIn: the cat the sightings leave, by id, under its lock",
    "moveSightingsIn: the right cat's name for MERGE_INSTEAD's words, by id",
    "canonicalOrRefuse: the cat a move goes to exists, by its canonical id",
  ],
  "artifacts/api-server/src/lib/badges/award.ts": [
    "isFirstCatInArea: this cat's own row; credit stays with who registered it, a merge changes none (spec 4.2)",
    "isFirstCatInArea: who was first in an area is history; a merge changes no credit (spec 4.2)",
    "isFirstCatInArea: other cats near the area, credit as above (spec 4.2)",
  ],
  "artifacts/api-server/src/lib/badges/backfill.ts": [
    "historyEventBadges: discoverer badges stay with both discoverers (spec 4.2)",
  ],
  "artifacts/api-server/src/lib/badges/stats.ts": [
    "computeBadgeStats: cats this device discovered; both discoverers keep the credit (spec 4.2)",
  ],
  "artifacts/api-server/src/lib/capabilityTargets.ts": [
    "catsOfPhoto: lookup by photo id; the ids go through canonicalCatOf in targetsOf",
  ],
  "artifacts/api-server/src/lib/catHelpers.ts": [
    "getProfileStats: cats this device discovered; credit (spec 4.2)",
    "profilePayload: cats this device owns; a merged-away cat never has an owner (spec 4.1)",
  ],
  "artifacts/api-server/src/lib/catIdentity.ts": [
    "liveCats: the one place cats are listed and counted",
    "alsoKnownAs: the names of the merged-away cats themselves, by id, for \"also known as\" (spec 4.2)",
  ],
  "artifacts/api-server/src/lib/mergeCats.ts": [
    "mergeCatsIn: the two cats of a merge, locked by id (§9.7 lock 4)",
    "mergeCatsIn: the two cats, by id, under their locks (owners, names)",
    "refuseUnlessStandingAlone: the two cats exist, by id",
    "undoMergeIn: the cats of an undo, locked by id (§9.7 lock 4)",
    "undoMergeIn: the names for UNDO_LATER_MERGE_FIRST's words, by id",
  ],
  "artifacts/api-server/src/lib/catNames.ts": [
    "catNamed: name taken; a merged-away cat's name stays taken (spec 4.2)",
    "nameHolder: the survivor of a merged-away name holder, by id (spec 9.3)",
  ],
  "artifacts/api-server/src/lib/claiming.ts": [
    "claimEligibility: one cat by id; a merged-away cat is already refused through canonicalCatOf",
    "hasMetCat: the canonical cat's name_pending, one cat by id (D3's naming exception)",
  ],
  "artifacts/api-server/src/lib/colonyCats.ts": ["placeCats: lock by id before a write"],
  "artifacts/api-server/src/lib/commitStatement.ts": ["commitStatement: lock by id before a write"],
  "artifacts/api-server/src/lib/guardianChanges.ts": [
    "listGuardianChanges: a log; each entry names the cat its own row is on",
  ],
  "artifacts/api-server/src/lib/guardianStatements.ts": [
    "guardian authority check: lock by id before a write, already on the canonical cat",
  ],
  "artifacts/api-server/src/lib/issues/queue.ts": [
    "issueRows: the cat a content report names, by id; showing the survivor is PR 4.1",
  ],
  "artifacts/api-server/src/lib/mail/outbox.ts": [
    "sendIssueDigestIfDue: each report names its own cat by id (an email digest)",
    "issue alert payload: the one cat a report names, by id",
  ],
  "artifacts/api-server/src/lib/observations.ts": [
    "loadCatRecords: created_at of every feeder, merged-away ones on purpose (they fold into the survivor's)",
  ],
  "artifacts/api-server/src/lib/publicCat.ts": ["publicCatView: one cat by id (callers pass the survivor)"],
  "artifacts/api-server/src/lib/recentGuardianChanges.ts": [
    "recentGuardianChanges: a log; each entry names the cat its own row is on",
  ],
  "artifacts/api-server/src/lib/sightingRoundUp.ts": [
    "sendDailyRoundUp: followed cats' updates, only while the sighting is still filed under the cat (PR 3.1); followers are PR 4.1",
  ],
  "artifacts/api-server/src/lib/teamCatList.ts": ["catTrail: one cat by id; the merged-away team page is PR 4.2"],
  "artifacts/api-server/src/lib/teamCatView.ts": [
    "crossCatLinks: the cat a replacing statement is on, by the row's own cat id",
    "crossCatLinks: the cat a replaced statement is on, by the row's own cat id",
    "sightingMovesOf: the name of the cat on the other side of a move, by the move row's own cat id",
    "teamCatView: one cat by id; the merged-away team page is PR 4.2",
  ],
  "artifacts/api-server/src/lib/teamCorrections.ts": [
    "recordTeamStatement: the cat exists, checked before a write",
    "removeOwnerAndSay: lock by id before a write",
    "removeOwnerAndSay: the locked cat's owner and name; owner never moves (spec 4.2)",
    "catOwnerState: one cat's name and owner by id; owner never moves (spec 4.2)",
    "supersedeStatement: lock by id before a write",
    "lockCat: lock by id before a write",
    "renameCat: one cat's name by id before a write; a merged-away rename is refused in PR 4.1",
    "addTeamNote: the cat exists, checked before a write",
  ],
  "artifacts/api-server/src/lib/teamOnlyPhotos.ts": [
    "teamOnlyPhotoIds: lookup by photo id; a merge un-publishes no photo",
  ],
  "artifacts/api-server/src/lib/vetBatchRoutes.ts": [
    "pageFor: each batch line names its own cat by id; dropping one would blank the line",
  ],
  "artifacts/api-server/src/lib/vetVisits.ts": [
    "lockCat: lock by id before a write",
    "saveBatch: names for the cats a batch names, each line by its own cat id (an error message)",
    "saveBatch: a cat holding a new cat's name; a merged-away name stays taken (spec 4.2)",
  ],
  "artifacts/api-server/src/lib/weekBoard.ts": ["uniqueCatsSql: cats this spotter discovered; credit (spec 4.2)"],
  "artifacts/api-server/src/lib/welfareQueue.ts": [
    "suggestedCat: the cat a reporter sent a report from, by id; the survivor view is PR 4.1",
    "reportsQuery: the cat a welfare report is tied to, by id; the survivor view is PR 4.1",
  ],
  "artifacts/api-server/src/lib/welfareTie.ts": ["tieReportToCat: the cat exists, checked before a write"],
  "artifacts/api-server/src/routes/cats.ts": [
    "name-suggestions: every name in use, merged-away ones included (spec 4.2)",
    "claim: one cat by id, after the MERGED refusal",
    "claim: lock by id before a write",
    "claim: the cat again after the claim, for the response",
    "let-go: the survivor's owner, locked by lockSurvivor",
    "let-go: the cat again, for the response",
    "follow: the survivor's owner, locked by lockSurvivor",
    "name: lock by id before a write",
    "name: a cat holding the folded name; a merged-away name stays taken (spec 4.2)",
    "PATCH /cats/:catId: the survivor by id before a write",
  ],
  "artifacts/api-server/src/routes/issues.ts": ["POST /issues: the reported cat by id, checked before a write"],
  "artifacts/api-server/src/routes/notifications.ts": [
    "POST /cats/:catId/updates: one cat by id before a write",
    "GET /notifications: each notification names its own cat by id; the survivor view is PR 4.1",
  ],
  "artifacts/api-server/src/routes/reports.ts": ["knownCatId: the cat exists, checked before a write"],
  "artifacts/api-server/src/routes/sightings.ts": [
    "resolve: the chosen cat by id before a write",
    "resolve: the survivor by id, once lockSurvivor found the chosen cat merged away",
    "resolve: lock by id before a write (the auto-follow)",
  ],
  "artifacts/api-server/src/lib/survivor.ts": [
    "survivorOf: the cat asked about and its survivor, by id",
    "lockSurvivor: lock by id before a write (update)",
    "lockSurvivor: lock by id before a resolve files a sighting (share)",
    "survivorsOf: the survivors' names and photos, by id, for the bell",
  ],
  "artifacts/api-server/src/routes/teamNews.ts": [
    "news-changes: a log; each change names its own cat by id",
  ],
  "artifacts/api-server/src/routes/teamVetBatches.ts": [
    "confirm a batch line: the typed cat id exists, checked before a write",
  ],
  "lib/db/src/photoRemoval/list.ts": [
    "listCatPhotos: deliberate raw read, one cat's main photo by id (the photo-removal tool)",
    "listCatPhotos: deliberate raw read, whether a photo is that cat's main photo",
  ],
  "lib/db/src/photoRemoval/remove.ts": [
    "dry run: deliberate raw read by photo id; removal must repoint every cat showing it, merged-away ones too",
  ],
  "lib/db/src/photoRemoval/search.ts": [
    "removal check: deliberate raw read by photo id, as remove.ts",
  ],
  "lib/db/src/photoRemoval/standIn.ts": [
    "standInFor: deliberate raw read by photo id, as remove.ts",
  ],
};

/** The `file:line` of every read of the cats table in `code`, in source order. */
export function catsReads(code: string): number[] {
  // `import { catsTable as theCats }` hides every read under a new name.
  const names = ["catsTable", ...[...code.matchAll(/\bcatsTable\s+as\s+(\w+)/g)].map((m) => m[1]!)];
  const offsets = new Set<number>();
  for (const rx of catsShapes(names)) for (const m of code.matchAll(rx)) offsets.add(m.index!);
  // Raw SQL, in a template or a quoted string: `from a, cats c`.
  for (const t of sqlStrings(code)) {
    if (/\bselect\b/i.test(t.body) && /\bfrom\b/i.test(t.body) && COMMA_JOIN.test(t.body)) offsets.add(t.start);
  }
  return [...offsets].sort((a, b) => a - b).map((o) => lineAt(code, o));
}

const HELP =
  "Read cats through liveCats(...) from lib/catIdentity.ts (or filter with notMergedAway(<cat id column>)), so a cat " +
  "merged into another is not listed or counted as a cat of its own. If this is a single cat loaded by id, a lock, " +
  "or a credit/name lookup, add a one-line reason for the hit to ALLOWLIST in liveCatsGuard.test.ts, in source order.";

function found(): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const { rel, code } of sourceFiles(REPO_ROOT)) {
    const lines = catsReads(code);
    if (lines.length > 0) out.set(rel, lines);
  }
  return out;
}

describe("SYC-410: only liveCats lists or counts cats", () => {
  const hits = found();

  it("every read of the cats table is listed, one reason per hit", () => {
    const wrong: string[] = [];
    for (const [file, lines] of hits) {
      const reasons = ALLOWLIST[file]?.length ?? 0;
      if (lines.length > reasons) {
        wrong.push(`${file} has ${lines.length} reads of cats (lines ${lines.join(", ")}) but ${reasons} listed reasons`);
      }
    }
    expect(wrong, HELP).toEqual([]);
  });

  it("the list stays honest: no file has fewer reads than reasons", () => {
    const wrong: string[] = [];
    for (const [file, reasons] of Object.entries(ALLOWLIST)) {
      const n = hits.get(file)?.length ?? 0;
      if (n < reasons.length) wrong.push(`${file} has ${n} reads of cats but ${reasons.length} listed reasons; remove the one that went`);
    }
    expect(wrong).toEqual([]);
  });

  it("every reason is a reason", () => {
    const short = Object.entries(ALLOWLIST).flatMap(([file, reasons]) =>
      reasons.filter((r) => r.length <= 10).map((r) => `${file}: "${r}"`),
    );
    expect(short).toEqual([]);
  });

  it("the patterns find the reads they should, and leave the rest", () => {
    const n = (src: string) => catsReads(withoutComments(src)).length;
    expect(n("db.select().from(catsTable)")).toBe(1);
    expect(n("db.select().from(x).leftJoin(catsTable, eq(a, b))")).toBe(1);
    expect(n("db.select().from(x).innerJoin(catsTable, eq(a, b))")).toBe(1);
    expect(n("db.select().from(x).innerJoin(\n  catsTable,\n  eq(a, b))")).toBe(1);
    expect(n('const c = alias(catsTable, "x");')).toBe(1);
    expect(n("sql`select 1 from cats`")).toBe(1);
    expect(n("sql`select 1 from x join cats c on c.id = x.cat_id`")).toBe(1);
    expect(n("sql`select id from ${catsTable}`")).toBe(1);
    expect(n("const c = catsTable;")).toBe(1);
    // An aliased import hides the name; the alias is followed.
    expect(n('import { catsTable as theCats } from "@workspace/db";\ndb.select().from(theCats)')).toBe(1);
    expect(n('import { catsTable as theCats } from "@workspace/db";\ndb.select().from(otherTable)')).toBe(0);
    // A comma join in raw SQL, in a template or a quoted string.
    expect(n("sql`select 1 from sightings s, cats c where s.cat_id = c.id`")).toBe(1);
    expect(n('pool.query("select 1 from sightings s, cats as c where s.cat_id = c.id")')).toBe(1);
    expect(n("sql`select name, cats_count from x`")).toBe(0);
    expect(n("db.query.cats.findMany()")).toBe(1);
    expect(n("db.select().from(rightTable).rightJoin(catsTable, x).fullJoin(catsTable, y)")).toBe(2);
    // Not reads: columns of the table, writes, the word in a string, a comment.
    expect(n("eq(catsTable.id, 1)")).toBe(0);
    expect(n("select({ name: catsTable.name })")).toBe(0);
    expect(n("db.update(catsTable).set({})")).toBe(0);
    expect(n("db.insert(catsTable).values({})")).toBe(0);
    expect(n('const t = "cats";')).toBe(0);
    expect(n("// select from cats\nconst x = 1;")).toBe(0);
    expect(n("/* join cats */ const y = 2;")).toBe(0);
  });
});
