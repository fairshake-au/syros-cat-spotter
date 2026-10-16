import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Spec §3.2 / risk 2: a feeding site's internal name usually holds a
// guardian's name ("Vaporia — Eleni's"), so it must never reach a place
// label. The compiler is the main guard (placeLabel's second argument is a
// branded PublicLabel). This text check is the backstop: it reads every source
// file under src/ and goes red if a call to placeLabel( passes anything ending
// in `.name`.

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

function sourceFiles(): string[] {
  const out: string[] = [];
  for (const path of walk(SRC)) {
    const rel = relative(SRC, path).split(sep).join("/");
    if (/\.(ts|tsx|js|mjs)$/.test(rel) && !isTestSupport(rel)) out.push(rel);
  }
  return out;
}

describe("placeLabel never takes a site's internal name", () => {
  const files = sourceFiles();

  it("scans a real set of files (an empty walk would pass for the wrong reason)", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.startsWith("middlewares/"))).toBe(true); // wider than lib/ and routes/
  });

  it("placeLabel exists where the guard expects it", () => {
    expect(readFileSync(join(SRC, "lib/areas/placeLabel.ts"), "utf8")).toContain(
      "export function placeLabel(",
    );
  });

  it("no source file under src/ builds a place label from a site's internal name", () => {
    const offenders = files.filter((f) =>
      /placeLabel\([^)]*\.name\b/.test(readFileSync(join(SRC, f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
