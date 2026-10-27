import { describe, expect, it } from "vitest";
import { REPO_ROOT, lineAt, sourceFiles, templates, withoutComments } from "../test/sourceScan";

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
    "checkVisitLink: checks a write against the visit chain on the row's own cat (the same-cat test is PR 3.1)",
    "writeObservation retraction: checks the target still stands on its own supersede chain, which never crosses cats",
  ],
  "artifacts/api-server/src/lib/teamCatView.ts": [
    "crossCatLinks: join naming the replacing row's own cat; rows are chosen by supersedes_id, not by cat",
    "crossCatLinks: join naming the replaced row's own cat; rows are chosen by supersedes_id, not by cat",
  ],
  "artifacts/api-server/src/lib/teamCorrections.ts": [
    "lockActiveObservation: checks a write against its own supersede chain, which never crosses cats",
    "agreeWithClip: the spotter's cat's ear_tip and sterilised rows; refusing a moved row is PR 3.1",
  ],
  "artifacts/api-server/src/lib/vetVisits.ts": [
    "undoVetVisit: rows linked to this visit by vetVisitId, written on the visit's own cat in its transaction",
  ],
  "artifacts/api-server/src/routes/sightings.ts": [
    "earTipStateFor: this phone's ear_tip answer on this cat; moved rows are PR 3.1",
    "earTipStateFor: any sterilised statement on this cat; moved rows are PR 3.1",
    "hasAnsweredEarTip: this phone's ear_tip answer on this cat; moved rows are PR 3.1",
  ],
};

const RAW_OBSERVATIONS = /\bobservations\b(?!Table)/;
// `cat_id = x`, `cat_id in (...)`, `x = w.cat_id`: a comparison on the column.
const RAW_CAT_COMPARE = /\bcat_id\s*(=|<>|!=|\bin\b)|(=|<>|!=)\s*(\w+\.)?cat_id\b/;

/** The line of every comparison of a statement's cat id in `code`, in source order. */
export function statementReads(code: string): number[] {
  const names = ["observationsTable", ...[...code.matchAll(/\b(\w+)\s*=\s*alias\(\s*observationsTable\b/g)].map((m) => m[1]!)];
  const col = `\\b(?:${names.join("|")})\\.catId\\b`;
  const shapes = [
    new RegExp(`\\b(?:eq|ne|inArray|notInArray)\\(\\s*${col}`, "g"), // eq(observationsTable.catId, x)
    new RegExp(`\\b(?:eq|ne)\\([^()]*?,\\s*${col}\\s*\\)`, "g"), // eq(x, observationsTable.catId)
    new RegExp(`\\$\\{\\s*${col}\\s*\\}`, "g"), // sql`${observationsTable.catId} = ...`
    /=\s*observationsTable\s*[;,)]/g, // const o = observationsTable: hides every later o.catId
  ];
  const offsets = new Set<number>();
  for (const rx of shapes) for (const m of code.matchAll(rx)) offsets.add(m.index!);
  // Raw SQL naming observations and comparing a cat_id: one hit per template.
  for (const t of templates(code)) {
    if (RAW_OBSERVATIONS.test(t.body) && RAW_CAT_COMPARE.test(t.body)) offsets.add(t.start);
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
