import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SYC-410 (which-cat-is-which.md §9.3): one reader of merges.
 *
 * Five readers of `cat_identity` used to follow five different rules (one
 * folded in an undone merge, one mistreated an undo, only one followed
 * chains). Now every question about merges goes through lib/catIdentity.ts.
 * This test fails on any other source file that names the table, so a new
 * reader can't quietly bring back its own rule.
 *
 * Limits, said plainly (as welfareKindGuard.test.ts):
 *  - It reads source text with comments stripped, so `db.execute` strings and
 *    Drizzle imports are found, but a table reached through a re-export under
 *    another name is not. The names searched for are the table's two spellings.
 *  - Test files, test fixtures and migrations are not scanned (they seed rows
 *    or define the table on purpose).
 */

/** File (from the repo root, with "/") -> why it may name the table. */
const ALLOWLIST: Record<string, string> = {
  "artifacts/api-server/src/lib/catIdentity.ts": "the one reader of merges (canonicalCatOf, catsMergedAway, catsFeeding)",
  "lib/db/src/schema/observations.ts": "the table's definition (catIdentityTable)",
};

const TERMS = [/\bcat_identity\b/, /\bcatIdentityTable\b/];
const SCAN_ROOTS = ["artifacts", "lib", "scripts"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".expo", ".git", "coverage", "migrations", "__fixtures__"]);
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

/** Source with block and line comments removed (a `//` after `:` is a URL, kept). */
export function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every non-test source file that names the table in code, from the repo root. */
export function filesNamingCatIdentity(root: string = REPO_ROOT): string[] {
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
      if (/\.test\.[a-z]+$/.test(rel) || rel.includes("/test/")) continue;
      const text = withoutComments(readFileSync(file, "utf8"));
      if (TERMS.some((t) => t.test(text))) found.push(rel);
    }
  }
  return found.sort();
}

describe("SYC-410: only lib/catIdentity.ts reads cat_identity", () => {
  it("finds no other file naming the table", () => {
    const unlisted = filesNamingCatIdentity().filter((f) => !(f in ALLOWLIST));
    expect(
      unlisted,
      "These files name cat_identity / catIdentityTable. Read merges through lib/catIdentity.ts " +
        "(canonicalCatOf, catsMergedAway, catsFeeding) instead, so every screen follows the same rule.",
    ).toEqual([]);
  });

  it("lists no file that has stopped naming it (so the list stays honest)", () => {
    const found = new Set(filesNamingCatIdentity());
    expect(Object.keys(ALLOWLIST).filter((f) => !found.has(f))).toEqual([]);
  });

  it("ignores the table's name in a comment, but not in a query", () => {
    expect(withoutComments("// read cat_identity here\nconst x = 1;")).not.toMatch(TERMS[0]!);
    expect(withoutComments("/* catIdentityTable */ const y = 2;")).not.toMatch(TERMS[1]!);
    expect(withoutComments("sql`select 1 from cat_identity` // ok")).toMatch(TERMS[0]!);
    expect(withoutComments('const u = "https://example.org"; db.select().from(catIdentityTable)')).toMatch(TERMS[1]!);
  });
});
