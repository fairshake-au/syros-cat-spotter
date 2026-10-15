import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// SYC-209 PR 4.1 (spec §7.3; plan PR 4.1): every read of feeding sites or
// colonies behind the Colonies and Feeding sites routes is filtered by
// `visibleColonyIds`, through `Visible`. This test reads the source, so a
// forgotten filter FAILS CLOSED: a new function that touches the sites or
// colonies tables without taking a `Visible` turns this red, and so does a
// new lib module the routes call that touches them, until someone has
// either filtered it or written down here why it needn't be.
//
// What it can't see (a function that takes a Visible but forgets to use it in
// one of its queries) is what the behaviour tests in
// team.guardianView.test.ts and their mutation probes are for.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/** The tables a cat guardian's filter is about, as Drizzle names them. */
const TABLES = [
  "feedingSitesTable",
  "coloniesTable",
  "colonyNameHistoryTable",
  "mappingEventsTable",
  "sitePageReadsTable",
];
const touchesTables = (text: string) => TABLES.some((t) => new RegExp(`\\b${t}\\b`).test(text));

/** The lib modules the Colonies and Feeding sites routes read sites and colonies through. */
const FILTERED_MODULES = [
  "lib/teamSites.ts",
  "lib/teamColonies.ts",
  "lib/colonyCats.ts",
  "lib/teamSiteWrites.ts",
];

/**
 * Functions in those modules that touch the tables WITHOUT a Visible, each
 * with the reason. Every one is a write, or a step inside one, behind a
 * route that is still island-only (its capability asked with no target)
 * until PR 4.2, or the "who looked" record. Adding a name here is a review
 * question: "why may this read ignore whose colony it is?"
 */
const UNFILTERED: Record<string, string> = {
  // lib/teamSites.ts
  recordSitePageRead: "writes the 'who looked' row for a site the route already found through siteView(visible)",
  sinceJoined: "an SQL fragment used inside filtered readers; takes the Visible itself",
  sitesForPerson: "builds its own Visible from the person (visibleColonyIds) and filters with it",
  // lib/teamColonies.ts
  colonyNamed: "after a name clash on create or rename (island-only routes); the route names the holder only if covers(visible)",
  createColony: "write; POST /team/colonies is island-only until PR 4.2",
  updateColony: "write; POST /team/colonies/:id is island-only (no target) until PR 4.2",
  // lib/colonyCats.ts
  placeCats: "write; asks can() with no target itself, island-only until PR 4.2",
  // lib/teamSiteWrites.ts
  lockFresh: "a step inside a site write (island-only routes until PR 4.2)",
  colonyExists: "a step inside a site write (island-only routes until PR 4.2)",
  makePrivateIfPublic: "a step inside a site write (island-only routes until PR 4.2)",
  addSite: "write; POST /team/sites is island-only until PR 4.2",
  editSite: "write; island-only until PR 4.2",
  moveSite: "write; island-only until PR 4.2",
  changeSiteColony: "write; reassign_feeding_site is island-only by kind",
  retireSite: "write; island-only until PR 4.2",
  restoreSite: "write; island-only until PR 4.2",
};

interface Fn {
  name: string;
  params: string;
  text: string;
}

/** Every top-level `function` (exported or not) with its parameter list and its whole text. */
function functionsOf(source: string): Fn[] {
  const out: Fn[] = [];
  const re = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\(/gm;
  const starts: { name: string; at: number; open: number }[] = [];
  for (let m = re.exec(source); m; m = re.exec(source)) {
    starts.push({ name: m[1]!, at: m.index, open: m.index + m[0].length - 1 });
  }
  starts.forEach((s, i) => {
    let depth = 0;
    let close = s.open;
    for (let j = s.open; j < source.length; j++) {
      if (source[j] === "(") depth++;
      else if (source[j] === ")") {
        depth--;
        if (depth === 0) {
          close = j;
          break;
        }
      }
    }
    const end = i + 1 < starts.length ? starts[i + 1]!.at : source.length;
    out.push({ name: s.name, params: source.slice(s.open + 1, close), text: source.slice(s.at, end) });
  });
  return out;
}

/** The name of the parameter typed `Visible`, if there is one. */
const visibleParam = (params: string) => /(\w+)\s*:\s*Visible\b/.exec(params)?.[1] ?? null;

describe("every sites and colonies read takes a Visible and uses it", () => {
  for (const file of FILTERED_MODULES) {
    it(file, () => {
      const fns = functionsOf(read(file));
      expect(fns.length, `${file}: found no functions; is the scanner broken?`).toBeGreaterThan(0);
      for (const fn of fns) {
        if (!touchesTables(fn.text)) continue;
        if (Object.hasOwn(UNFILTERED, fn.name)) continue;
        const param = visibleParam(fn.params);
        expect(param, `${file}: ${fn.name}() reads sites or colonies but takes no Visible`).not.toBeNull();
        // The parameter must be used, not just declared: passed to the filter,
        // to covers(), or on to another reader.
        const body = fn.text.slice(fn.text.indexOf(fn.params) + fn.params.length);
        const uses = body.match(new RegExp(`\\b${param}\\b`, "g")) ?? [];
        expect(uses.length, `${file}: ${fn.name}() takes ${param} but never uses it`).toBeGreaterThan(0);
      }
    });
  }

  it("the allow-list names only functions that exist (no stale excuses)", () => {
    const all = new Set(FILTERED_MODULES.flatMap((f) => functionsOf(read(f)).map((fn) => fn.name)));
    for (const name of Object.keys(UNFILTERED)) expect(all, name).toContain(name);
  });

  it("every write on the allow-list sits behind an island-only route: the module says so", () => {
    // A cheap tripwire: PR 4.2 opens these to guardians and must revisit each.
    for (const name of Object.keys(UNFILTERED)) {
      expect(UNFILTERED[name]!.length, name).toBeGreaterThan(10);
    }
  });
});

describe("the routes read sites and colonies only through those modules", () => {
  const routeFiles = readdirSync(join(SRC, "routes")).filter(
    (f) => /^team(Sites|Colonies|Map)\w*\.ts$/.test(f) && !f.endsWith(".test.ts"),
  );

  it("finds the route files", () => {
    expect(routeFiles).toEqual(expect.arrayContaining(["teamSites.ts", "teamColonies.ts", "teamMap.ts"]));
  });

  for (const file of routeFiles) {
    it(`${file} touches no table and no db handle itself`, () => {
      const src = read(join("routes", file));
      for (const t of TABLES) expect(src, `${file} names ${t}`).not.toMatch(new RegExp(`\\b${t}\\b`));
      expect(src, `${file} queries the database directly`).not.toMatch(/\bdb\s*\.\s*(select|insert|update|delete|execute|transaction)\b/);
      expect(src, `${file} imports the database pool`).not.toMatch(/import\s*\{[^}]*\b(db|pool)\b[^}]*\}\s*from\s*"@workspace\/db"/);
    });

    it(`${file}: every lib module it calls that touches sites or colonies is a filtered one`, () => {
      const src = read(join("routes", file));
      const libs = [...src.matchAll(/from\s+"\.\.\/(lib\/[\w/]+)"/g)].map((m) => `${m[1]}.ts`);
      for (const lib of libs) {
        let text: string;
        try {
          text = read(lib);
        } catch {
          continue; // a directory index or a non-.ts module
        }
        if (!touchesTables(text)) continue;
        expect(
          FILTERED_MODULES.includes(lib) || lib === "lib/guardianView.ts",
          `${file} calls ${lib}, which touches sites or colonies but isn't checked here`,
        ).toBe(true);
      }
    });

    it(`${file} never calls canSomewhere (the sign-in door's alone)`, () => {
      expect(read(join("routes", file))).not.toMatch(/\bcanSomewhere\b/);
    });
  }
});

describe("a Visible is made in one place only", () => {
  /** Every .ts file under src, tests excluded. */
  function sources(dir: string, rel = ""): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = join(rel, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "__fixtures__") continue;
        out.push(...sources(dir, r));
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        out.push(r);
      }
    }
    return out;
  }

  it("nothing but lib/guardianView.ts casts to Visible or builds { ids }", () => {
    for (const file of sources(SRC)) {
      if (file === join("lib", "guardianView.ts")) continue;
      const src = read(file);
      expect(src, `${file} casts to Visible`).not.toMatch(/as\s+(unknown\s+as\s+)?Visible\b/);
      expect(src, `${file} declares its own Visible`).not.toMatch(/^\s*(export\s+)?(interface|type)\s+Visible\b\s*(=|\{|<)/m);
    }
  });
});
