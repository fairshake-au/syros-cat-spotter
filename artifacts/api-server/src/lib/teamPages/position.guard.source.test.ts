import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// SYC-362 (adversarial review, 15 Oct 2026), SYC-395 PR 0.2. position.ts
// builds the team's "Open map" link (D9), so only the files named in ALLOWED
// may import it. This reads every source file under src/, so a new page
// cannot start using it without this test failing and someone checking its
// gate. positions.source.test.ts makes every position print through it.

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Each file here passes the viewer's isIslandWide() gate (or a literal
// false) as `link`. routes/team.guardianView.test.ts checks the rendered
// pages.
const ALLOWED = new Set<string>([
  join("lib", "teamPages", "catPages.ts"),
  // The cat page's facts panel: "First recorded in …" passes the viewer's island gate as `link`.
  join("lib", "teamPages", "catFacts.ts"),
  // The cat page's History (SYC-602 PR 2): a sighting's "Open map" only when `island`.
  join("lib", "teamPages", "catHistory.ts"),
  join("lib", "teamPages", "colonyPages.ts"),
  join("lib", "teamPages", "siteFormPages.ts"),
  join("lib", "teamPages", "sitePages.ts"),
  join("lib", "teamPages", "queuePage.ts"),
  join("lib", "teamPages", "areasPage.ts"),
  join("lib", "teamPages", "centrePages.ts"),
  // A cat guardian's own pages: always link: false (positions.source.test.ts).
  join("lib", "teamPages", "guardianPages.ts"),
]);

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

describe("only the allowed, gated files use position.ts", () => {
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
