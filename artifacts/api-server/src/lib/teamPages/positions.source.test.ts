import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// SYC-395 PR 0.2 (team dashboard redesign D9; replaces noMapLinks.source.test.ts).
//
// Every position a team page prints goes through position.ts: 5 decimal
// places, and an "Open map" link only where the caller passes the viewer's
// island-wide gate. So no other file under lib/teamPages or routes may name a
// map company's address, or print a position itself. This reads the source of
// every non-test file in both, so a new page cannot slip one in.
//
// The gate itself (who gets the link) is tested on the rendered pages in
// routes/team.guardianView.test.ts; which files may import position.ts is
// position.guard.source.test.ts.

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const MAP_COMPANIES = [
  "google.com/maps",
  "maps.apple.com",
  "maps.google.",
  "goo.gl/maps",
  "geo:",
  "waze.com",
  "openstreetmap.org/?mlat",
];

/** Ways a file prints a position by itself. */
const RAW_PRINT = [/\.toFixed\(/, /\$\{[^}]*\blat\}\s*,\s*\$\{[^}]*\blng\}/, /\bfmtPos\(/];

/**
 * Files that may use toFixed for something other than printing a position.
 * Each is named exactly, with why.
 */
const ALLOWED_RAW = new Set([
  // The one printer.
  "lib/teamPages/position.ts",
  // Rounds an owner's home pin to 5 places before it is stored (claiming a
  // cat, D5). Never printed here; this is the public app's write route.
  "routes/cats.ts",
]);

function sourceFiles(dirs: string[]): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return walk(path);
      return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
    });
  return dirs.flatMap((d) => walk(join(SRC, d))).map((p) => relative(SRC, p).split("\\").join("/"));
}

const files = sourceFiles(["lib/teamPages", "routes"]);
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("positions print only through position.ts (D9)", () => {
  it("the scan really reads the pages and the routes", () => {
    for (const f of [
      "lib/teamPages/catPages.ts",
      "lib/teamPages/colonyPages.ts",
      "lib/teamPages/sitePages.ts",
      "lib/teamPages/siteFormPages.ts",
      "lib/teamPages/queuePage.ts",
      "lib/teamPages/guardianPages.ts",
      "routes/teamMap.ts",
      "routes/team.ts",
    ])
      expect(files).toContain(f);
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(files)("%s prints positions only through position()", (file) => {
    const src = read(file);
    if (file !== "lib/teamPages/position.ts")
      for (const m of MAP_COMPANIES) expect(src, `${file} names ${m}`).not.toContain(m);
    if (!ALLOWED_RAW.has(file))
      for (const re of RAW_PRINT) expect(re.test(src), `${file} prints a raw position (${re})`).toBe(false);
  });

  it("position.ts names exactly one map company, once", () => {
    const src = read("lib/teamPages/position.ts");
    expect(src.split("google.com/maps")).toHaveLength(2);
    for (const m of MAP_COMPANIES.filter((c) => c !== "google.com/maps")) expect(src).not.toContain(m);
  });

  // A cat guardian's own pages never carry a link, whoever reads them.
  it("guardianPages.ts only ever asks position() for no link", () => {
    const src = read("lib/teamPages/guardianPages.ts");
    // Every call to position(), and what it passes as `link`.
    const calls = [...src.matchAll(/\bposition\(([^;]*?)\)/g)].map((m) => m[1]!);
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(args, `position(${args})`).toMatch(/,\s*\{\s*link:\s*false\s*\}\s*$/);
  });

  // SYC-396 PR 1.5: the dashboard's own scripts (assets/dashboard-*.js) draw
  // the island map's card and markers in the browser. They hand positions to
  // the map library only, and never print one: no map company's address, no
  // toFixed, and no lat or lng written as text into the page or put together
  // into a string.
  it("the dashboard's scripts never print a position or name a map company", () => {
    const dir = join(SRC, "..", "assets");
    const scripts = readdirSync(dir).filter((n) => /^dashboard-[\w-]+\.js$/.test(n));
    expect(scripts).toContain("dashboard-map.js");
    const SCRIPT_PRINT = [
      ...RAW_PRINT,
      // "c.lat + ", " + c.lng", and the like.
      /\.lat\b[^;\n]*\+[^;\n]*\.lng\b|\.lng\b[^;\n]*\+[^;\n]*\.lat\b/,
      // A lat or lng written into the page as text or an attribute.
      /(?:textContent|innerText|innerHTML|outerHTML|insertAdjacentHTML|createTextNode|nodeValue|setAttribute|\.title\s*=|\.alt\s*=|\.href\s*=|\.src\s*=)[^;\n]*\b(?:lat|lng)\b/,
      // A position as text: String(lat), lat.toString(), [lat, lng].join.
      /String\(\s*[\w.]*\b(?:lat|lng)\b|\b(?:lat|lng)\.toString\(|\[[^\]]*\blat\b[^\]]*\blng\b[^\]]*\]\.join/,
    ];
    for (const name of scripts) {
      const src = readFileSync(join(dir, name), "utf8");
      for (const m of MAP_COMPANIES) expect(src, `${name} names ${m}`).not.toContain(m);
      for (const re of SCRIPT_PRINT) expect(re.test(src), `${name} prints a raw position (${re})`).toBe(false);
    }
  });

  // The owner's home position never gets a link (D5).
  it("the cat page's home pin is printed with link: false, literally", () => {
    const src = read("lib/teamPages/catPages.ts");
    expect(src).toMatch(/position\(\s*v\.owner\.homePin\.lat,\s*v\.owner\.homePin\.lng,\s*\{\s*link:\s*false\s*\}\s*\)/);
  });
});
