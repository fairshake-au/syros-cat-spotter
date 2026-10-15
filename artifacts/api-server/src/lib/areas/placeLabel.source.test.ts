import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Spec §3.2 / risk 2: a feeding site's internal name usually holds a
// guardian's name ("Vaporia — Eleni's"), so it must never reach a place
// label. placeLabel's second argument is the site's PUBLIC label only. This
// reads every source file under lib/ and routes/ and goes red if a call to
// placeLabel( passes anything ending in `.name`.

const SRC = join(__dirname, "..", "..");
const isTestSupport = (rel: string) =>
  /\.test\.ts$/.test(rel) ||
  rel.split("/").some((p) => p === "__snapshots__" || p === "__fixtures__" || p === "test");

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

function sourceFiles(roots: string[]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    for (const path of walk(join(SRC, root))) {
      const rel = relative(SRC, path).split(sep).join("/");
      if (/\.(ts|tsx|js|mjs)$/.test(rel) && !isTestSupport(rel)) out.push(rel);
    }
  }
  return out;
}

describe("placeLabel never takes a site's internal name", () => {
  const files = sourceFiles(["lib", "routes"]);

  it("scans a real set of files (an empty walk would pass for the wrong reason)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("placeLabel exists where the guard expects it", () => {
    expect(readFileSync(join(SRC, "lib/areas/placeLabel.ts"), "utf8")).toContain(
      "export function placeLabel(",
    );
  });

  for (const file of files) {
    it(`${file} never builds a place label from a site's internal name`, () => {
      expect(readFileSync(join(SRC, file), "utf8")).not.toMatch(/placeLabel\([^)]*\.name\b/);
    });
  }
});
