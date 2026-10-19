import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { WIDE_CSP_FILES } from "../../test/wideCsp";

// SYC-396 PR 1.3.4: only the files named in test/wideCsp.ts WIDE_CSP_FILES
// may ask setTeamHeaders for the wider security header, and nothing but
// refuse.ts may spell out a script rule. A text check over every source file
// (tests left out), so a new page can't quietly turn scripts on.

const SRC = join(__dirname, "../..");
const ROOT = join(SRC, "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    // src/test/ is the tests' own kit (wideCsp.ts spells the strings out on purpose).
    if (e.isDirectory()) {
      if (relative(SRC, p) !== "test") sourceFiles(p, out);
    }
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The code with comments taken out, so a comment can't pass or fail it. */
const code = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Every setTeamHeaders(…) call's argument text, to its closing bracket. */
function calls(src: string): string[] {
  const out: string[] = [];
  const re = /\bsetTeamHeaders\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    out.push(src.slice(m.index + m[0].length, i - 1));
  }
  return out;
}

const files = sourceFiles(SRC);
const rel = (f: string) => relative(ROOT, f).split("\\").join("/");

describe("only the named pages turn scripts on", () => {
  it("finds the source files, and the calls", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.flatMap((f) => calls(code(f))).length).toBeGreaterThan(40);
  });

  it("no file outside WIDE_CSP_FILES passes anything but res to setTeamHeaders", () => {
    for (const f of files) {
      if (rel(f) === "src/lib/teamAuth/refuse.ts") continue; // the definition, and its own refusals
      for (const args of calls(code(f))) {
        if (WIDE_CSP_FILES.has(rel(f))) continue;
        expect(args.trim(), `${rel(f)}: setTeamHeaders(${args})`).toBe("res");
      }
    }
  });

  it("refuse.ts itself only ever calls it with res", () => {
    const src = code(join(SRC, "lib/teamAuth/refuse.ts"));
    const own = calls(src).filter((a) => !/^res: Response/.test(a.trim()));
    expect(own.length).toBeGreaterThan(0);
    for (const a of own) expect(a.trim()).toBe("res");
  });

  it("every file in WIDE_CSP_FILES exists and does ask for scripts", () => {
    for (const f of WIDE_CSP_FILES) {
      expect(files.map(rel), f).toContain(f);
      expect(calls(code(join(ROOT, f))).some((a) => /\bscripts\s*:/.test(a)), f).toBe(true);
    }
  });

  it("no file but refuse.ts spells out a script rule or the wider header's name", () => {
    for (const f of files) {
      if (rel(f) === "src/lib/teamAuth/refuse.ts") continue;
      const src = code(f);
      expect(src, rel(f)).not.toMatch(/script-src|connect-src|unsafe-eval/);
      expect(src, rel(f)).not.toContain("TEAM_CSP_WITH_SCRIPTS");
      // Nor the one that allows data: pictures (SYC-396 PR 2.5; SYC-491).
      expect(src, rel(f)).not.toContain("TEAM_CSP_WITH_UPLOADED_PHOTO");
      expect(src, rel(f)).not.toMatch(/img-src[^;"'`]*data:/);
    }
  });
});
