import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The file walk and comment stripper the source-reading guards share
 * (catIdentityGuard, liveCatsGuard, statementsByCatGuard; SYC-410). Lives
 * under `src/test/`, which the guards themselves skip.
 *
 * Scans the roots `artifacts`, `lib` and `scripts`, skipping dependency and
 * build directories, migrations and fixtures, test files and anything under
 * `/test/`. Source is read with comments removed.
 */

const SCAN_ROOTS = ["artifacts", "lib", "scripts"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".expo", ".git", "coverage", "migrations", "__fixtures__"]);
const EXTENSIONS = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

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
 * it; none names what the guards look for, and they read the rest as before.
 * A block comment keeps its line breaks, so a hit's line number is true.
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
      const stop = end < 0 ? n : end + 2;
      out += " " + "\n".repeat(text.slice(i, stop).split("\n").length - 1);
      i = stop;
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

export interface SourceFile {
  /** From the repo root, with "/". */
  rel: string;
  /** The file with comments removed. */
  code: string;
}

/** Every non-test source file under the scan roots, comments removed, sorted by path. */
export function sourceFiles(root: string = REPO_ROOT): SourceFile[] {
  const found: SourceFile[] = [];
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
      found.push({ rel, code: withoutComments(readFileSync(file, "utf8")) });
    }
  }
  return found.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** The 1-based line of an offset in `code`. */
export const lineAt = (code: string, offset: number): number => code.slice(0, offset).split("\n").length;

/**
 * The text of every backtick template literal in `code`, outermost only, with
 * its start offset (nested `${…}` included in the body). For guards that read
 * raw SQL.
 */
export function templates(code: string): { start: number; body: string }[] {
  const out: { start: number; body: string }[] = [];
  const n = code.length;
  let i = 0;
  while (i < n) {
    if (code[i] !== "`") {
      i += 1;
      continue;
    }
    let j = i + 1;
    let depth = 0;
    while (j < n) {
      const c = code[j]!;
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "$" && code[j + 1] === "{") {
        depth += 1;
        j += 2;
        continue;
      }
      if (c === "}" && depth > 0) {
        depth -= 1;
        j += 1;
        continue;
      }
      if (c === "`" && depth === 0) break;
      j += 1;
    }
    out.push({ start: i, body: code.slice(i + 1, j) });
    i = j + 1;
  }
  return out;
}

/** Every quoted string literal ('…' or "…") in `code`, with its start offset. */
export function quotedStrings(code: string): { start: number; body: string }[] {
  const out: { start: number; body: string }[] = [];
  for (const m of code.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g)) {
    out.push({ start: m.index!, body: m[0].slice(1, -1) });
  }
  return out;
}

/** Every template literal and quoted string: the places raw SQL can sit. */
export const sqlStrings = (code: string): { start: number; body: string }[] => [...templates(code), ...quotedStrings(code)];
