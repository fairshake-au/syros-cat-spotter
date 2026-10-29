import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * T4-0 (SYC-44 PR 4.1; plan "Every place the guards must hold", invariant 1):
 * "A 'Report an issue' row is never treated as a welfare report."
 *
 * `welfare_reports` now holds two kinds of row (`kind = 'welfare'` and
 * `kind = 'content'`). Every file that reads or writes the table, or handles a
 * row of it, must have decided what it does with the other kind. This test
 * lists those files; a file that names the table and is NOT in ALLOWLIST turns
 * it red until someone decides its rule and writes it down here.
 *
 * Limits, said plainly (review finding 6):
 *  - It works file by file. A NEW query added to a file already on the list is
 *    invisible to it. Each query in a listed file is covered by a route test
 *    that seeds a content row (team.kind.test.ts, reports.kind.test.ts,
 *    internalMail.test.ts, me.delete.test.ts), and the reviewer of any PR that
 *    touches a listed file must check its `kind` rule.
 *  - It reads source text, so `db.execute` strings and Drizzle imports are
 *    found, but a table reached through a re-export under another name is not.
 *    The names searched for are the table's three spellings.
 *  - Test files are not scanned (they seed rows on purpose).
 */

/** File (from the repo root, with "/") -> its rule for the other kind. */
const ALLOWLIST: Record<string, string> = {
  "lib/db/src/schema/welfare.ts":
    "the definition: kind check, content-row checks and the (device, kind, clientRef) key live here",
  "artifacts/api-server/src/lib/welfareQueue.ts":
    "the needs-help queue: every list, count and draft read carries kind = 'welfare'; mailHealth counts failed welfare_alert and issue_alert",
  "artifacts/api-server/src/lib/dashboard/home.ts":
    "Home: the needs-help list comes from listWelfareQueue (welfare only); countOpenIssues is the one query here and counts kind = 'content' only",
  "artifacts/api-server/src/lib/dashboard/colonyFigures.ts":
    "Colonies list's Kittens reported flag (SYC-396 PR 2.2): both its queries carry kind = 'welfare' and is_litter (countedLitter), so a content row never flags a colony",
  "artifacts/api-server/src/lib/reports/welfarePatterns.ts":
    "Welfare patterns (SYC-396 PR 3.3b): kind = 'welfare' rows feed the chart, the drafts count and the areas table; kind = 'content' rows are only counted, as \"Problems reported with photos or names\" (patternsFrom; welfarePatterns.test.ts seeds a content row)",
  "artifacts/api-server/src/lib/welfareActions.ts":
    "both kinds can move state and take a team note; a welfare_outcome is written only for kind = 'welfare'",
  "artifacts/api-server/src/lib/welfareTie.ts":
    "welfare only: a content row is refused with not_welfare (a tie writes evidence of life)",
  "artifacts/api-server/src/lib/mail/outbox.ts":
    "a welfare_alert for a non-welfare report is failed wrong_kind, and an issue_alert for a non-content report likewise; the unchecked-waiting count is kind = 'welfare'; the daily issues digest counts kind = 'content' only",
  "artifacts/api-server/src/lib/issues/alertEmail.ts":
    "builds the issue_alert emails for kind = 'content' rows only, from a few picked fields (no device, no contact); the outbox refuses any other kind before calling it",
  "artifacts/api-server/src/lib/welfare/alertEmail.ts":
    "builds the welfare alert only: throws for a row with no position (the outbox checks the kind before calling it)",
  "artifacts/api-server/src/routes/reports.ts":
    "welfare only: both upserts target (reporter_device, kind, client_ref) and write kind = 'welfare'; sentReport and the photo PUT filter kind = 'welfare'",
  "artifacts/api-server/src/routes/issues.ts":
    "content only (SYC-44 PR 5.1): inserts kind = 'content' on the (device, kind, clientRef) key; the duplicate, courtesy and upgrade reads all filter kind = 'content'",
  "artifacts/api-server/src/lib/issues/hide.ts":
    "content only: writes hidden_by_report / hide_skipped on the one report row it was handed, inside that report's own insert transaction",
  // SYC-44 PR 7.1: the team's Issues section.
  "artifacts/api-server/src/lib/issues/queue.ts":
    "content only: every read (the section, one report, the cat page's strip, the others count) carries kind = 'content'; no reporter column is selected",
  "artifacts/api-server/src/lib/moveSightings.ts":
    "moving a sighting (SYC-150 PR 3.2): \"nothing left\" counts kind = 'welfare' rows only; closing the report locks a kind = 'content', reason = 'wrong_cat', is_draft = false row, or refuses",
  "artifacts/api-server/src/lib/issues/teamActions.ts":
    "content only: Keep hidden, Restore and Hide lock a report with kind = 'content' and is_draft = false, or do nothing",
  // SYC-44 PR 8.1: the one-year clean-up.
  "artifacts/api-server/src/lib/issues/retention.ts":
    "content only: the one update carries kind = 'content'; a welfare row is never cleared (its three-year rule is SYC-302's)",
  "artifacts/api-server/src/routes/teamReports.ts":
    "content only: the reported-photo route finds the photo through a kind = 'content' report; every other read here goes through welfareQueue.ts or lib/issues",
  "artifacts/api-server/src/lib/welfare/reporterEmail.ts":
    "welfare only (SYC-42 Slice 3): every read of the table carries kind = 'welfare', so a content row never takes an address, an acknowledgement or an outcome",
  "artifacts/api-server/src/lib/severPerson.ts":
    "deliberately no kind filter: deletion clears the device from both kinds",
  "artifacts/api-server/src/lib/teamAuth/__fixtures__/queueKit.ts":
    "test fixture: seeds both kinds",
  // SYC-303: the matcher skips a photo hidden for privacy. Read only.
  "artifacts/api-server/src/lib/photoVisibility.ts":
    "content only: the one read carries kind = 'content' and reason photo_private, for a photo hidden for privacy",
  // SYC-462: removing a photo by hand. Read only; nothing here writes the table.
  "lib/db/src/photoRemoval/eligibility.ts":
    "content only: a kind = 'content' report with reason photo_private makes a photo hidden for privacy (Decision 3)",
  "lib/db/src/photoRemoval/list.ts":
    "content only: the same kind = 'content' photo_private read, for the list's 'hidden for privacy'",
  "lib/db/src/photoRemoval/remove.ts":
    "both kinds, on purpose: the dry run counts every report that names the photo (they all stay, linked to it)",
  "lib/db/src/photoRemoval/__fixtures__/seed.ts":
    "test fixture: seeds a kind = 'content' report",
};

const TERMS = [/\bwelfare_reports\b/, /\bwelfareReportsTable\b/, /\bWelfareReport\b/];
const SCAN_ROOTS = ["artifacts", "lib", "scripts"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".expo", ".git", "coverage"]);
const EXTENSIONS = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (EXTENSIONS.test(name)) yield full;
  }
}

/** Every non-test source file that names the table, from the repo root. */
export function filesTouchingWelfareReports(root: string = REPO_ROOT): string[] {
  const found: string[] = [];
  for (const top of SCAN_ROOTS) {
    let dir: string;
    try {
      dir = join(root, top);
      statSync(dir);
    } catch {
      continue;
    }
    for (const file of walk(dir)) {
      const rel = relative(root, file).split(sep).join("/");
      if (/\.test\.[a-z]+$/.test(rel) || rel.endsWith("welfareKindGuard.test.ts")) continue;
      const text = readFileSync(file, "utf8");
      if (TERMS.some((t) => t.test(text))) found.push(rel);
    }
  }
  return found.sort();
}

describe("T4-0: every file that touches welfare_reports has a written kind rule", () => {
  it("finds no file outside the allowlist", () => {
    const unlisted = filesTouchingWelfareReports().filter((f) => !(f in ALLOWLIST));
    expect(
      unlisted,
      `These files name welfare_reports but are not in ALLOWLIST (welfareKindGuard.test.ts). ` +
        `Decide what each does with a kind = 'content' row, make it so, and add it with its rule.`,
    ).toEqual([]);
  });

  it("lists no file that has stopped touching the table (so the list stays honest)", () => {
    const found = new Set(filesTouchingWelfareReports());
    expect(Object.keys(ALLOWLIST).filter((f) => !found.has(f))).toEqual([]);
  });

  it("gives every entry a rule", () => {
    for (const [file, rule] of Object.entries(ALLOWLIST)) {
      expect(rule.trim().length, file).toBeGreaterThan(10);
    }
  });
});
