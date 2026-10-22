import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// SYC-462 (spec §3.1, T13): the only files that may read a photo's picture
// (`photosTable.data`, or a whole photos row). Each one copes with a photo
// removed for good (data null) and has a test for it. A new reader must be
// added here on purpose, with that guard and that test.

const ALLOWED = new Set([
  "routes/photos.ts", // R1: 404 for a removed photo
  "routes/teamReports.ts", // R2/R3: 410
  "routes/sightings.ts", // R4/R5: never sent to the matcher
  "lib/photoVariants.ts", // R3: no version made
  "lib/mail/outbox.ts", // R6: no attachment
  "lib/coatReading/sweep.ts", // R7: skipped
  "lib/spotPhotos.ts", // R8: the one writer
  "scripts/smokeCheck.ts", // SYC-527 T4: read-only accuracy check; selects only photos with removed_at null and data not null (test: smokeCheck.test.ts); variantFor would write photo_variants, so it reads the bytes itself
]);

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "test" || name === "__fixtures__" ? [] : sourceFiles(full);
    return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
  });
}

/** A whole-row select from photos, even split over lines: select() … .from(photosTable). */
const WHOLE_ROW = /\.select\(\s*\)\s*\.from\(\s*photosTable\s*\)/m;
const DATA = /photosTable\.data\b/;

describe("T13: who reads a photo's picture", () => {
  const files = sourceFiles(SRC).map((f) => path.relative(SRC, f).split(path.sep).join("/"));

  it("finds the source files", () => {
    expect(files.length).toBeGreaterThan(100);
    for (const f of ALLOWED) expect(files, f).toContain(f);
  });

  it.each(files.filter((f) => !ALLOWED.has(f)))("%s doesn't read a photo's picture", (rel) => {
    const text = readFileSync(path.join(SRC, rel), "utf8");
    expect(WHOLE_ROW.test(text), `${rel} selects whole photo rows`).toBe(false);
    expect(DATA.test(text), `${rel} reads photosTable.data`).toBe(false);
  });

  it("catches a whole-row select split over lines (as at sightings.ts:577-578)", () => {
    expect(WHOLE_ROW.test("await db\n        .select()\n        .from(photosTable)")).toBe(true);
    expect(DATA.test("select({ data: photosTable.data })")).toBe(true);
  });
});
