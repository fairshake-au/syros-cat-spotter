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

/**
 * Source with block and line comments removed, read the way the language
 * does: a `/*` or `//` inside a string or a template literal is text, not a
 * comment (review of #375, finding 5: a regex stripper let `"src/*.ts"`
 * swallow the code up to the next comment's end). Template `${…}` holes are
 * code again. A regex literal holding a quote or `//` could still confuse
 * it; none names the table, and the guard reads the rest as before.
 */
export function withoutComments(text: string): string {
  let out = "";
  // "template": inside a template literal's text; "brace": a `{` opened in
  // code inside a template hole (the hole's own `${` included).
  const stack: ("template" | "brace")[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i]!;
    const d = text[i + 1];
    if (stack[stack.length - 1] === "template") {
      if (c === "\\") {
        out += c + (d ?? "");
        i += 2;
      } else if (c === "`") {
        stack.pop();
        out += c;
        i += 1;
      } else if (c === "$" && d === "{") {
        stack.push("brace");
        out += "${";
        i += 2;
      } else {
        out += c;
        i += 1;
      }
      continue;
    }
    if (c === "/" && d === "/") {
      while (i < n && text[i] !== "\n") i += 1;
    } else if (c === "/" && d === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      out += " ";
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "`") {
      stack.push("template");
      out += c;
      i += 1;
    } else {
      if (c === "{" && stack.length > 0) stack.push("brace");
      else if (c === "}" && stack[stack.length - 1] === "brace") stack.pop();
      out += c;
      i += 1;
    }
  }
  return out;
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

  it("review 5: a `/*` inside a string doesn't hide a query up to the next comment", () => {
    const evasion = [
      'const glob = "src/*.ts";',
      "await db.execute(sql`select 1 from cat_identity`);",
      "/** a later doc comment */",
      "export const x = 1;",
    ].join("\n");
    expect(withoutComments(evasion)).toMatch(TERMS[0]!);
    // The same with single quotes, a template, and a template hole.
    expect(withoutComments("const a = 'x/*y'; db.select().from(catIdentityTable); /* z */")).toMatch(TERMS[1]!);
    expect(withoutComments("const b = `a/*b`; sql`from cat_identity`; /* c */")).toMatch(TERMS[0]!);
    expect(withoutComments("const t = `${'/*'}`; sql`from cat_identity`; /* c */")).toMatch(TERMS[0]!);
    // And a `//` inside a string is not a line comment.
    expect(withoutComments('const u = "a//b"; sql`from cat_identity`;')).toMatch(TERMS[0]!);
    // Comments are still removed, including inside a template hole.
    expect(withoutComments("const t = `${x /* cat_identity */}`; // catIdentityTable")).not.toMatch(/cat_identity|catIdentityTable/);
  });
});
