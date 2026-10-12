import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// SYC-43 part 2 plan, test P6-0. A list of "places that show a photo" written
// by hand misses places: the plan's first draft missed the notifications
// screen, and the build found two more. So the rule is structural: the public
// photo path is written in exactly two files, lib/photoVisibility.ts (the only
// builder of a public photo address, which returns null for a hidden photo)
// and routes/photos.ts (the route itself, which 404s a hidden photo). Any
// other file under src/ that spells it, even in a comment, turns this red, so
// a new reader can't build an address by hand and skip the check.

const SRC = join(__dirname, "..");
const PUBLIC_PATH = "/api/photos/";
const ALLOWED = new Set(["lib/photoVisibility.ts", "routes/photos.ts"]);

/** Test files and test support: they talk about the path, they don't serve it. */
const isTestSupport = (rel: string) =>
  /\.test\.ts$/.test(rel) ||
  rel.split("/").some((part) => part === "__snapshots__" || part === "__fixtures__" || part === "test");

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

describe("P6-0: only lib/photoVisibility.ts builds a public photo address", () => {
  it("no other source file under src/ contains the public photo path", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const path of files(SRC)) {
      const rel = relative(SRC, path).split(sep).join("/");
      if (!/\.(ts|tsx|js|mjs)$/.test(rel) || isTestSupport(rel) || ALLOWED.has(rel)) continue;
      scanned += 1;
      if (readFileSync(path, "utf8").includes(PUBLIC_PATH)) offenders.push(rel);
    }
    // An empty walk would pass for the wrong reason.
    expect(scanned).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });

  it("the two allowed files really are where the path lives", () => {
    expect(readFileSync(join(SRC, "lib/photoVisibility.ts"), "utf8")).toContain(PUBLIC_PATH);
    expect(readFileSync(join(SRC, "routes/photos.ts"), "utf8")).toContain("/photos/:id");
  });
});
