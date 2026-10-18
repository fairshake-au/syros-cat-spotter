import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// SYC-443 PR 1, Task 1.4 (coat-colours-and-pattern.md §15.5): the public
// never gets a team word. teamCoatWords.ts says a coat as the team does
// ("Ginger tabby"), so only team code may import it: the team's pages, the
// team's view of a cat, and the team routes. The public routes, catHelpers
// and everything that builds what the public sees keep §2's words. This
// reads every source file under src/, so a new importer fails here first.
// Modelled on position.guard.source.test.ts.

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELF = join("lib", "teamPages", "teamCoatWords.ts");

const allowed = (rel: string) =>
  rel.startsWith(join("lib", "teamPages") + sep) ||
  rel === join("lib", "teamCatView.ts") ||
  (rel.startsWith(join("routes", "team")) && !rel.includes(sep, "routes".length + 1) && rel.endsWith(".ts"));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

const files = sources(SRC)
  .map((path) => ({ rel: relative(SRC, path), text: readFileSync(path, "utf8") }))
  .filter((f) => f.rel !== SELF);

/** `from "…/teamCoatWords"` (import or export), `import "…"`, `import("…")` and `require("…")`, with or without .js. */
const IMPORTS = /(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["'][^"']*\/teamCoatWords(?:\.js)?["']/;

describe("only team code uses teamCoatWords.ts", () => {
  it("no source file imports it unless it is team code", () => {
    const importers = files.filter((f) => IMPORTS.test(f.text)).map((f) => f.rel);
    expect(importers.filter((rel) => !allowed(rel))).toEqual([]);
    // It is really used: the team pages and the history import it.
    expect(importers).toEqual(
      expect.arrayContaining([join("lib", "teamPages", "appearancePage.ts"), join("lib", "teamCatView.ts")]),
    );
  });

  it("the pattern matches every way of importing it", () => {
    for (const line of [
      'import { teamCoatPhrase } from "./teamCoatWords";',
      'import { teamCoatPhrase } from "../teamPages/teamCoatWords.js";',
      'export { coatWordsFor } from "./teamPages/teamCoatWords";',
      'import "./teamCoatWords";',
      'const m = await import("../lib/teamPages/teamCoatWords");',
      "const m = require('./teamCoatWords.js');",
    ]) {
      expect(IMPORTS.test(line), line).toBe(true);
    }
    expect(IMPORTS.test('import { x } from "./teamCoatWordsOld";')).toBe(false);
  });

  it("the allowlist is team code only", () => {
    expect(allowed(join("lib", "teamPages", "catPages.ts"))).toBe(true);
    expect(allowed(join("lib", "teamCatView.ts"))).toBe(true);
    expect(allowed(join("routes", "teamMy.ts"))).toBe(true);
    expect(allowed(join("routes", "team.ts"))).toBe(true);
    expect(allowed(join("lib", "catHelpers.ts"))).toBe(false);
    expect(allowed(join("routes", "cats.ts"))).toBe(false);
    expect(allowed(join("routes", "sightings.ts"))).toBe(false);
    expect(allowed(join("lib", "teamCatList.ts"))).toBe(false);
  });

  it("the scan really reads the sources (it isn't passing on an empty list)", () => {
    expect(files.some((f) => f.rel === join("lib", "catHelpers.ts"))).toBe(true);
    expect(files.some((f) => f.rel === join("routes", "cats.ts"))).toBe(true);
    expect(files.length).toBeGreaterThan(50);
  });
});
