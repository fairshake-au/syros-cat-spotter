import { describe, expect, it } from "vitest";
import { REPO_ROOT, lineAt, sourceFiles, sqlStrings, withoutComments } from "../test/sourceScan";

/**
 * SYC-410 (which-cat-is-which.md §9.3): every read of statements by cat id
 * covers the cats merged into that cat.
 *
 * Everything recorded about Mimi counts for Agatha once Mimi is part of her,
 * so a query that picks statements by a cat id (`eq(observationsTable.catId,
 * x)`, `inArray(...)`, a raw `where cat_id = ...`) must ask `catsFeeding`
 * (lib/catIdentity.ts) which cats feed that cat, and build its condition with
 * `observationCatIn`. This test fails on any other source that compares a
 * statement's cat id, unless the comparison is listed below with its reason.
 *
 * Limits, said plainly (as welfareKindGuard.test.ts and catIdentityGuard.test.ts):
 *  - It reads source text with comments stripped. A table reached through a
 *    re-export under another name is not seen; an `alias(observationsTable)`
 *    bound in the same file is.
 *  - Closed after the review of PR 1.2: `gt/lt/between` and a call as the
 *    first argument (`eq(fn(x), table.catId)`), `getTableColumns(table).catId`,
 *    `db.query.<table>`, aliased imports, raw SQL in quoted strings, `USING
 *    (cat_id)`, `cat_id > x`, and a bare `cat_id = ${x}` fragment in a file that
 *    reads these tables. Still open: a cat id destructured from the table
 *    (`const { catId } = getTableColumns(...)`), a fragment built apart from the
 *    file that uses it, and SQL assembled from pieces.
 *  - It covers the tables spec 9.3 names (observations, cat_updates,
 *    vet_visit_photos, vet_batch_cats) and welfare_reports. For the last four a
 *    comparison passes when its second argument comes from catsFeeding (a name
 *    with "feed" in it). Welfare reports are PR 4.1's (rulings: "welfare_reports
 *    readers show under the survivor"), so their reads are listed below with
 *    that reason.
 *  - It cannot see a read keyed by something else (a colony, a kind, a role,
 *    the whole island) that then files rows under cats in TypeScript, because
 *    nothing in the source tells it from a read that never files rows under a
 *    cat. Those readers (currentColonyOf's callers, catsInColony, movedAway,
 *    teamColonies' history, vetCostsReport, ...) are covered by spec test 15
 *    (liveCats.readers.test.ts) instead. A new reader of that shape needs a
 *    case there.
 *  - Reasons are kept one per hit, in source order. A hit swapped for another
 *    in the same file keeps the count, so whoever touches a listed file checks
 *    that its reasons still match.
 *  - Test files, fixtures and migrations are not scanned. Selecting the
 *    `catId` column (`catId: observationsTable.catId`) is not a comparison and
 *    is not matched.
 */

/**
 * File (from the repo root, with "/") -> one reason per hit, in source order.
 * A file's hit count must equal its number of reasons.
 */
const ALLOWLIST: Record<string, readonly string[]> = {
  "artifacts/api-server/src/lib/claiming.ts": [
    "newestActiveOwnerHomed: the owner's 'has a home' on this cat; the staying record keeps its owner and the other never has one (spec 4.1, 4.2)",
  ],
  "artifacts/api-server/src/lib/observations.ts": [
    "checkVisitLink: the visit chain on the visit's own cat, which never crosses cats (the same-cat test compares canonical cats)",
    "writeObservation retraction: checks the target still stands on its own supersede chain, which never crosses cats",
  ],
  "artifacts/api-server/src/lib/dashboard/colonyFigures.ts": [
    "kittensNearSites: welfare reports joined to feeding sites by position, not by cat; welfare reports are PR 4.1",
  ],
  "artifacts/api-server/src/lib/issues/queue.ts": [
    "issueRows: join naming a report's own cat; welfare_reports readers show under the survivor in PR 4.1",
    "a cat's strip of reports, by the report's own cat id; welfare_reports readers are PR 4.1",
  ],
  "artifacts/api-server/src/lib/mail/outbox.ts": [
    "sendIssueDigestIfDue: the digest groups open reports by each report's own cat; welfare_reports readers are PR 4.1",
  ],
  "artifacts/api-server/src/lib/reports/welfarePatterns.ts": [
    "welfarePatterns: counts reports by area and reason, not by cat; welfare_reports readers are PR 4.1",
  ],
  "artifacts/api-server/src/lib/sightingRoundUp.ts": [
    "sendDailyRoundUp: followed cats' care updates by each update's own cat, only while its sighting is still filed there (PR 3.1); followers are PR 4.1",
  ],
  "artifacts/api-server/src/lib/welfareQueue.ts": [
    "reportsQuery: join naming the report's own cat; welfare_reports readers are PR 4.1",
  ],
  "artifacts/api-server/src/lib/colonyMembership.ts": [
    "colonyAfterMerge: the merge screen's preview asks for exactly two cats' own colony statements, to apply pickColonyRow as the merge will (SYC-59 PR 4.2)",
  ],
  "artifacts/api-server/src/lib/teamCatView.ts": [
    "crossCatLinks: join naming the replacing row's own cat; rows are chosen by supersedes_id, not by cat",
    "crossCatLinks: join naming the replaced row's own cat; rows are chosen by supersedes_id, not by cat",
  ],
  "artifacts/api-server/src/lib/teamCorrections.ts": [
    "lockActiveObservation: checks a write against its own supersede chain, which never crosses cats",
  ],
  "artifacts/api-server/src/lib/vetVisits.ts": [
    "undoVetVisit: rows linked to this visit by vetVisitId, written on the visit's own cat in its transaction",
  ],
  "artifacts/api-server/src/routes/issues.ts": [
    "POST /issues: duplicate-report check on the raw cat id the phone sent (one report's own cat)",
  ],
  "artifacts/api-server/src/routes/notifications.ts": [
    "GET /notifications: join naming the update's own cat; the survivor view is PR 4.1",
  ],
  "lib/db/src/photoRemoval/list.ts": [
    "listCatPhotos: deliberate raw read by one cat's id (the photo-removal tool)",
  ],
  "lib/db/src/photoRemoval/standIn.ts": [
    "standInFor: deliberate raw read by one cat's id (the photo-removal tool)",
  ],
};

/** The cat-keyed tables whose reads by cat id must cover merged-in cats (spec 9.3). */
const TABLES: { drizzle: string; raw: string; wholeCat: boolean }[] = [
  // wholeCat: any comparison is a hit. Otherwise (the other cat-keyed tables) a
  // comparison is fine when its second argument comes from catsFeeding (a name
  // with "feed" in it: `feeding.ids`, `feedingIds`).
  { drizzle: "observationsTable", raw: "observations", wholeCat: true },
  { drizzle: "catUpdatesTable", raw: "cat_updates", wholeCat: false },
  { drizzle: "vetVisitPhotosTable", raw: "vet_visit_photos", wholeCat: false },
  { drizzle: "vetBatchCatsTable", raw: "vet_batch_cats", wholeCat: false },
  { drizzle: "welfareReportsTable", raw: "welfare_reports", wholeCat: false },
];
const OPS = "eq|ne|gt|gte|lt|lte|inArray|notInArray|between|notBetween";
const RAW_TABLE = /\b(observations(?!Table)|cat_updates|vet_visit_photos|vet_batch_cats|welfare_reports)\b/;
// `cat_id = x`, `cat_id in (...)`, `cat_id > x`, `x = w.cat_id`, `using (cat_id)`: a comparison on the column.
const RAW_CAT_COMPARE =
  /\bcat_id\s*(=|<>|!=|>=|<=|>|<|\bin\b|\bbetween\b|\blike\b|\bnot\b)|(=|<>|!=|>=|<=|>|<)\s*(\w+\.)?cat_id\b|\busing\s*\(\s*cat_id\b/i;
const RAW_FRAGMENT_BLOCKERS = /\b(from|join|into|update)\s+\w/i;

/** The line of every comparison of a cat-keyed table's cat id in `code`, in source order. */
export function statementReads(code: string): number[] {
  const offsets = new Set<number>();
  for (const t of TABLES) {
    const names = [t.drizzle, ...[...code.matchAll(new RegExp(`\\b${t.drizzle}\\s+as\\s+(\\w+)`, "g"))].map((m) => m[1]!)];
    // `x = alias(observationsTable, …)` binds another name for the same table.
    for (const m of code.matchAll(new RegExp(`\\b(\\w+)\\s*=\\s*alias\\(\\s*(?:${names.join("|")})\\b`, "g"))) names.push(m[1]!);
    const col = `\\b(?:${names.join("|")})\\.catId\\b`;
    const notFed = t.wholeCat ? "" : "(?![\\s(]*[\\w.]*[Ff]eed)";
    const oneLevel = "(?:[^()]|\\([^()]*\\))*?";
    const shapes = [
      new RegExp(`\\b(?:${OPS})\\(\\s*${col}\\s*,${notFed}`, "g"), // eq(table.catId, x)
      new RegExp(`\\b(?:${OPS})\\(${oneLevel},\\s*${col}\\s*\\)`, "g"), // eq(x, table.catId), x may be a call
      new RegExp(`\\$\\{\\s*${col}\\s*\\}`, "g"), // sql`${table.catId} = ...`
      new RegExp(`=\\s*(?:${names.join("|")})\\s*[;,)]`, "g"), // const o = table: hides every later o.catId
      new RegExp(`\\bgetTableColumns\\(\\s*(?:${names.join("|")})\\s*\\)\\s*\\.catId\\b`, "g"), // getTableColumns(table).catId
      new RegExp(`\\bquery\\.${t.drizzle.replace(/Table$/, "")}\\w*\\b`, "g"), // db.query.observations…
    ];
    for (const rx of shapes) for (const m of code.matchAll(rx)) offsets.add(m.index!);
  }
  // Raw SQL naming a cat-keyed table and comparing a cat_id: one hit per string.
  const usesTable = /\bobservationsTable\b|\bcatUpdatesTable\b|\bvetVisitPhotosTable\b|\bvetBatchCatsTable\b|\bwelfareReportsTable\b/.test(code);
  for (const t of sqlStrings(code)) {
    if (!RAW_CAT_COMPARE.test(t.body)) continue;
    if (RAW_TABLE.test(t.body)) offsets.add(t.start);
    // A fragment (no from/join of its own) in a file that reads these tables:
    // `.from(observationsTable).where(sql\`cat_id = ${x}\`)`.
    else if (usesTable && !RAW_FRAGMENT_BLOCKERS.test(t.body) && t.body.length > 0 && t.body.includes("${")) offsets.add(t.start);
  }
  return [...offsets].sort((a, b) => a - b).map((o) => lineAt(code, o));
}

const HELP =
  "Read statements by cat through catsFeeding(...) from lib/catIdentity.ts and build the condition with " +
  "observationCatIn(...), then keep the rows its feeding.counts(row) accepts, so statements about a cat merged into " +
  "this one count for it. If the read checks a write against its own row's chain, or is a later PR's, add a one-line " +
  "reason for the hit to ALLOWLIST in statementsByCatGuard.test.ts, in source order.";

function found(): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const { rel, code } of sourceFiles(REPO_ROOT)) {
    const lines = statementReads(code);
    if (lines.length > 0) out.set(rel, lines);
  }
  return out;
}

describe("SYC-410: statements by cat id go through catsFeeding", () => {
  const hits = found();

  it("every comparison of a statement's cat id is listed, one reason per hit", () => {
    const wrong: string[] = [];
    for (const [file, lines] of hits) {
      const reasons = ALLOWLIST[file]?.length ?? 0;
      if (lines.length > reasons) {
        wrong.push(`${file} compares a statement's cat id ${lines.length} times (lines ${lines.join(", ")}) but lists ${reasons} reasons`);
      }
    }
    expect(wrong, HELP).toEqual([]);
  });

  it("the list stays honest: no file has fewer hits than reasons", () => {
    const wrong: string[] = [];
    for (const [file, reasons] of Object.entries(ALLOWLIST)) {
      const n = hits.get(file)?.length ?? 0;
      if (n < reasons.length) wrong.push(`${file} has ${n} hits but ${reasons.length} listed reasons; remove the one that went`);
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
    const n = (src: string) => statementReads(withoutComments(src)).length;
    expect(n("eq(observationsTable.catId, 1)")).toBe(1);
    expect(n("inArray(observationsTable.catId, ids)")).toBe(1);
    expect(n("notInArray(observationsTable.catId, ids)")).toBe(1);
    expect(n("eq(catsTable.id, observationsTable.catId)")).toBe(1);
    expect(n('const replacer = alias(observationsTable, "r");\neq(replacer.catId, 1)')).toBe(1);
    expect(n("const o = observationsTable;")).toBe(1);
    // Review of PR 1.2: shapes the first version missed.
    expect(n("gt(observationsTable.catId, 5)")).toBe(1);
    expect(n("between(observationsTable.catId, 1, 9)")).toBe(1);
    expect(n("lte(observationsTable.catId, 5)")).toBe(1);
    expect(n("eq(sql`lower(${x})`, observationsTable.catId)")).toBe(1);
    expect(n("eq(coalesce(a, b), observationsTable.catId)")).toBe(1);
    expect(n("const { catId } = getTableColumns(observationsTable).catId;")).toBe(1);
    expect(n("db.query.observations.findMany()")).toBe(1);
    expect(n('import { observationsTable as obs } from "x";\ninArray(obs.catId, ids)')).toBe(1);
    expect(n('pool.query("select 1 from observations where cat_id = $1")')).toBe(1);
    expect(n("sql`select 1 from observations a join observations b using (cat_id)`")).toBe(1);
    expect(n("sql`select 1 from observations where cat_id > ${x}`")).toBe(1);
    expect(n("db.select().from(observationsTable).where(sql`cat_id = ${x}`)")).toBe(1);
    expect(n("sql`select 1 from sightings where cat_id > ${x}`")).toBe(0);
    // The other cat-keyed tables: fine when fed by catsFeeding, a hit otherwise.
    expect(n("eq(catUpdatesTable.catId, catId)")).toBe(1);
    expect(n("inArray(catUpdatesTable.catId, feeding.ids)")).toBe(0);
    expect(n("inArray(vetVisitPhotosTable.catId, feedingIds)")).toBe(0);
    expect(n("eq(vetVisitPhotosTable.catId, catId)")).toBe(1);
    expect(n("eq(welfareReportsTable.catId, body.catId)")).toBe(1);
    expect(n("eq(vetBatchCatsTable.catId, catId)")).toBe(1);
    expect(n("sql`select 1 from vet_visit_photos where cat_id = ${x}`")).toBe(1);
    expect(n("sql`${observationsTable.catId} = 1`")).toBe(1);
    expect(n("sql`select 1 from observations where cat_id = ${x}`")).toBe(1);
    expect(n("sql`select 1 from observations w where w.cat_id = ${x}`")).toBe(1);
    expect(n("sql`select 1 from observations w join observations h on h.id = w.supersedes_id where w.cat_id = ${x} and h.cat_id = ${x}`")).toBe(1);
    // Not comparisons: selecting the column, other columns, other tables, the helper.
    expect(n("select({ catId: observationsTable.catId })")).toBe(0);
    expect(n("eq(observationsTable.id, x)")).toBe(0);
    expect(n("sql`select 1 from sightings where cat_id = ${x}`")).toBe(0);
    expect(n('sql`select 1 from observations where ${observationCatIn([f], sql.raw("cat_id"))}`')).toBe(0);
    expect(n("// eq(observationsTable.catId, 1)\nconst x = 1;")).toBe(0);
  });
});
