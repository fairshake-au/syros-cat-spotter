import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// SYC-362 (adversarial review, 15 Oct 2026). position.ts can build a map
// company link, so noMapLinks.source.test.ts exempts it. Until step 5 adds
// the island-wide gate and the guardian-view tests, NOTHING may use it to
// print a link. This reads every source file under src/, so a page cannot
// import it without this test failing.
//
// Step 5 adds each file it converts to ALLOWED, with the gate in place.

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALLOWED = new Set<string>([]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

const files = sources(SRC)
  .map((path) => ({ rel: relative(SRC, path), text: readFileSync(path, "utf8") }))
  .filter((f) => f.rel !== join("lib", "teamPages", "position.ts"));

describe("nothing prints a map link through position.ts yet", () => {
  it("no source file imports position.ts unless it is allowed", () => {
    const importers = files
      // `from "…/position"` (import or export), `import "…/position"`,
      // `import("…/position")` and `require("…/position")`.
      .filter((f) =>
        /(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["'][^"']*\/position(?:\.js)?["']/.test(f.text),
      )
      .map((f) => f.rel)
      .filter((rel) => !ALLOWED.has(rel));
    expect(importers).toEqual([]);
  });

  it("mapUrl is named nowhere else", () => {
    expect(files.filter((f) => /\bmapUrl\b/.test(f.text)).map((f) => f.rel)).toEqual([]);
  });

  it("the scan really reads the pages (it isn't passing on an empty list)", () => {
    expect(files.some((f) => f.rel === join("lib", "teamPages", "catPages.ts"))).toBe(true);
    expect(files.length).toBeGreaterThan(50);
  });
});
