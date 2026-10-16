import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// SYC-53 PR 2.2, B1: commitStatement is the ONLY way anything writes a
// `sterilised` statement (or marks one wrong), so the one-time news can't be
// skipped by a route that writes around it. This reads every shipping source
// file and checks every place `writeObservation` is named:
//
// - a call must name its `kind` as a string literal that is not
//   "sterilised", unless the file is lib/commitStatement.ts (the path) or
//   the one named exemption below;
// - a call whose kind is an expression is allowed only where listed in
//   DYNAMIC, with the reason it can never be "sterilised";
// - naming writeObservation without calling it (passing it around) is
//   allowed only in lib/commitStatement.ts.
//
// Mutation probe: a route that calls writeObservation for "sterilised"
// directly → red.

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The one named exemption (plan PR 2.2: "the owner-key route … is not the path"). */
const EXEMPT: Record<string, string> = {
  "routes/notifications.ts":
    "the owner-key care-update route, which SYC-185 retires; it writes its own desexed update and is NOT the commitStatement path",
};

/** Calls whose kind is an expression, and why it can't be "sterilised". */
const DYNAMIC: Record<string, { expr: string; why: string }> = {
  "routes/sightings.ts": {
    expr: "a.kind",
    why: "a spotter's answers, typed ear_tip | food_and_water | note (pinned below)",
  },
};

function shippingFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "__fixtures__" || name === "node_modules") continue;
      shippingFiles(p, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

/** The source with comments blanked out (strings and templates kept). */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The text inside the parentheses that start at `open`. */
function callArgs(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

interface Use {
  file: string;
  kind: string | null;
  call: boolean;
}

export function writeObservationUses(file: string, source: string): Use[] {
  const src = stripComments(source);
  const uses: Use[] = [];
  const re = /\bwriteObservation\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 200), m.index);
    // The import line and the definition itself are not uses, unless the
    // import renames it: `writeObservation as w` would hide every call
    // (review m2), so a renamed import counts as naming it without a call.
    if (/import\s*(type\s*)?\{[^}]*$/.test(before)) {
      if (/^\s+as\s+\w/.test(src.slice(m.index + m[0].length))) uses.push({ file, kind: null, call: false });
      continue;
    }
    if (/export\s+async\s+function\s+$/.test(before)) continue;
    const after = src.slice(m.index + m[0].length);
    const open = after.search(/\S/);
    if (after[open] === "(") {
      const args = callArgs(after, open);
      const kind = /\bkind\s*:\s*([^,\n}]+)/.exec(args)?.[1]?.trim() ?? null;
      uses.push({ file, kind, call: true });
    } else {
      uses.push({ file, kind: null, call: false });
    }
  }
  return uses;
}

const files = shippingFiles(SRC);
const uses = files.flatMap((p) =>
  writeObservationUses(relative(SRC, p).split("\\").join("/"), readFileSync(p, "utf8")),
);

describe("commitStatement is the only path for a 'sterilised' statement (B1 source test)", () => {
  it("finds the writers it expects (so an empty scan can't pass)", () => {
    const writers = new Set(uses.filter((u) => u.call).map((u) => u.file));
    for (const f of ["lib/teamCorrections.ts", "routes/sightings.ts", "routes/notifications.ts", "lib/colonyCats.ts"]) {
      expect(writers, f).toContain(f);
    }
    expect(uses.filter((u) => u.file === "lib/commitStatement.ts").length).toBeGreaterThan(0);
  });

  it("no other file writes 'sterilised' through writeObservation, or with a kind it can't see", () => {
    const bad: string[] = [];
    for (const u of uses) {
      // observations.ts defines it (and names it in its own refusal messages).
      if (u.file === "lib/commitStatement.ts" || u.file === "lib/observations.ts" || u.file in EXEMPT) continue;
      if (!u.call) {
        bad.push(`${u.file}: names writeObservation without calling it`);
        continue;
      }
      if (u.kind === null) {
        bad.push(`${u.file}: a writeObservation call with no kind it can read`);
        continue;
      }
      const literal = /^["'`]([a-z_]+)["'`]$/.exec(u.kind);
      if (literal) {
        if (literal[1] === "sterilised") bad.push(`${u.file}: writes "sterilised" directly; use commitStatement`);
        continue;
      }
      if (DYNAMIC[u.file]?.expr !== u.kind) bad.push(`${u.file}: kind ${u.kind} could be "sterilised"`);
    }
    expect(bad).toEqual([]);
  });

  it("the dynamic writer's kinds are pinned: a spotter's answers are never 'sterilised'", () => {
    const src = readFileSync(join(SRC, "routes/sightings.ts"), "utf8");
    expect(src).toMatch(/kind: "ear_tip" \| "food_and_water" \| "note";/);
  });

  it("the exemption is still where it says it is", () => {
    const src = readFileSync(join(SRC, "routes/notifications.ts"), "utf8");
    expect(src).toContain('kind: "sterilised"');
    expect(src).toContain('updateType === "desexed"');
  });

  it("the scan itself: a renamed import is seen, and so is a call through a namespace (review m2)", () => {
    expect(
      writeObservationUses("routes/x.ts", `import { writeObservation as recordIt } from "../lib/observations";\nawait recordIt(tx, { kind: "sterilised" });`),
    ).toEqual([{ file: "routes/x.ts", kind: null, call: false }]);
    expect(
      writeObservationUses("routes/x.ts", `import * as obs from "../lib/observations";\nawait obs.writeObservation(tx, { kind: "sterilised" });`),
    ).toEqual([{ file: "routes/x.ts", kind: '"sterilised"', call: true }]);
    expect(
      writeObservationUses("routes/x.ts", `const { writeObservation: w } = obs;`),
    ).toEqual([{ file: "routes/x.ts", kind: null, call: false }]);
  });

  it("the scan itself: a direct 'sterilised' call is seen, a comment is not", () => {
    const seen = writeObservationUses(
      "routes/x.ts",
      `// writeObservation(tx, { kind: "sterilised" })\nawait writeObservation(tx, {\n  catId,\n  kind: "sterilised",\n});`,
    );
    expect(seen).toEqual([{ file: "routes/x.ts", kind: '"sterilised"', call: true }]);
  });
});
