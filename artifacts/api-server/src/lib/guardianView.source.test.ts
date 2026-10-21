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
  "feedingSiteOldCodesTable",
];
/** The same tables as SQL names them, for raw SQL (review F1). */
const SQL_TABLES = [
  "feeding_sites",
  "colonies",
  "colony_name_history",
  "mapping_events",
  "site_page_reads",
  "feeding_site_old_codes",
];
const SQL_TABLE_RE = new RegExp(
  `\\b(from|join|into|update|table)\\s+"?(${SQL_TABLES.join("|")})\\b`,
  "i",
);

/** Source with comments removed (a URL's "//" in a string is kept). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, (_m, pre: string) => pre);
}

const touchesTables = (text: string) => {
  const code = stripComments(text);
  return TABLES.some((t) => new RegExp(`\\b${t}\\b`).test(code)) || SQL_TABLE_RE.test(code);
};

/** The lib modules the Colonies and Feeding sites routes read sites and colonies through. */
const FILTERED_MODULES = [
  "lib/teamSites.ts",
  "lib/teamColonies.ts",
  "lib/colonyCats.ts",
  "lib/teamSiteWrites.ts",
  // The Colonies list's figures and flags (SYC-396 PR 2.2).
  "lib/dashboard/colonyFigures.ts",
];

/**
 * Modules a route may call that read a site or colony WITHOUT a Visible,
 * because what they read decides a can() check and is never shown: the
 * record's own colony, as a CapabilityTarget (SYC-209 PR 4.2). Each says why,
 * and the test below holds it to reading the colony column only.
 */
const TARGET_MODULES: Record<string, string> = {
  "lib/capabilityTargets.ts":
    "siteTarget reads a site's colony id to decide a can() check; it returns a CapabilityTarget, never a row",
};

/**
 * Team-only readers a route may call without a Visible, because the route
 * calls them only behind an island-only capability, so a cat guardian never
 * reaches them. Each says why, and the test below holds every call to one of
 * its capabilities (a module several pages call names each page's, e.g. the
 * reports' view_reports beside edit_named_areas once they call namedAreasAt).
 */
const ISLAND_ONLY_MODULES: Record<string, { why: string; fns: string[]; capabilities: string[] }> = {
  "lib/recentGuardianChanges.ts": {
    why: "the team's \"Recent changes by cat guardians\" (SYC-209 PR 4.3), the whole island's by design",
    fns: ["recentGuardianChanges"],
    capabilities: ["view_guardian_changes"],
  },
  "lib/areas/areaHistory.ts": {
    why: "the named areas' own history (SYC-396 PR 2.4): area centres and who changed them, never a site or a colony",
    fns: ["namedAreasAt", "areaChanges"],
    capabilities: ["edit_named_areas"],
  },
  "lib/reports/progress.ts": {
    why: "Sterilisation progress (SYC-396 PR 3.3a): the whole island's colonies, team-only until the guardian variant (SYC-472, 16 Nov)",
    fns: ["progressReport"],
    capabilities: ["view_reports", "export_report"],
  },
  "lib/reports/colonyHealth.ts": {
    why: "Colony health (SYC-396 PR 3.3a): every colony's row, team-only until the guardian variant (SYC-472, 16 Nov)",
    fns: ["colonyHealthReport"],
    capabilities: ["view_reports", "export_report"],
  },
  "lib/reports/coverage.ts": {
    why: "Coverage and spotting (SYC-396 PR 3.3b): the whole island's sightings as 250 m squares and named areas, team-only until the guardian variant (SYC-472, 16 Nov)",
    fns: ["coverageReport"],
    capabilities: ["view_reports", "export_report"],
  },
  "lib/reports/welfarePatterns.ts": {
    why: "Welfare patterns (SYC-396 PR 3.3b): the whole island's welfare reports by kind, week and area, team-only until the guardian variant (SYC-472, 16 Nov)",
    fns: ["welfarePatterns"],
    capabilities: ["view_reports", "export_report"],
  },
  "lib/areas/areaWrites.ts": {
    why: "the only writer of named_areas and its history rows (SYC-396 PR 2.4); the team's list, island-wide by design",
    fns: ["changeArea"],
    capabilities: ["edit_named_areas"],
  },
  "lib/vetSettings.ts": {
    why: "the standard sterilisation price and its own history rows (SYC-396 PR 3.1b): a price and who changed it, never a site or a colony",
    fns: ["setStandardPrice", "priceChanges"],
    capabilities: ["edit_vet_settings"],
  },
};

/**
 * Functions in those modules that touch the tables WITHOUT a Visible, each
 * with the reason. Every one is a write, or a step inside one, behind a
 * route that asks can() against the colony read from the record (PR 4.2),
 * or the "who looked" record. Adding a name here is a review
 * question: "why may this read ignore whose colony it is?"
 */
const UNFILTERED: Record<string, string> = {
  // lib/teamSites.ts
  recordSitePageRead: "writes the 'who looked' row for a site the route already found through siteView(visible)",
  sinceJoined: "an SQL fragment used inside filtered readers; takes the Visible itself",
  sitesForPerson: "builds its own Visible from the person (visibleColonyIds) and filters with it",
  // lib/teamColonies.ts
  colonyNamed: "after a name clash on create or rename (island-only routes); the route names the holder only if covers(visible)",
  createColony: "write; the team's original create, kept for its tests (the route uses createColonyAs)",
  createColonyAs: "write; the route checks create_colony, and roles' createColonyWithPlacement re-reads her roles",
  updateColony: "write; the route checks edit_colony against that colony (PR 4.2); renaming stays island-only",
  // lib/colonyCats.ts
  placeCats: "write; checks can() against the colony a cat goes into, or leaves, read under its lock (PR 4.2)",
  // lib/teamSiteWrites.ts
  lockFresh: "a step inside a site write, behind a route checked against the site's own colony (PR 4.2)",
  colonyExists: "a step inside a site write; a guardian's colony is checked by the route first (PR 4.2)",
  makePrivateIfPublic: "a step inside a site write, behind a route checked against the site's own colony (PR 4.2)",
  addSite: "write; the route checks add_feeding_site against the colony it goes into (PR 4.2)",
  editSite: "write; the route checks edit_feeding_site against the site's own colony (PR 4.2)",
  moveSite: "write; the route checks edit_feeding_site against the site's own colony (PR 4.2)",
  changeSiteColony: "write; reassign_feeding_site is island-only by kind",
  retireSite: "write; the route checks edit_feeding_site against the site's own colony (PR 4.2)",
  restoreSite: "write; the route checks edit_feeding_site against the site's own colony (PR 4.2)",
};

interface Fn {
  name: string;
  params: string;
  text: string;
  start: number;
  end: number;
}

/**
 * Every top-level declaration that is a function: `function f(…)`,
 * `const f = (…) =>`, `const f = async (…) =>`, `const f = x =>` and
 * `const f = function (…)` (review F1: an arrow reader once slipped past).
 * Each runs from its first line to the line where its brackets close and the
 * line ends with `}` or `;`.
 */
function functionsOf(source: string): Fn[] {
  const out: Fn[] = [];
  const re =
    /^(?:export\s+)?(?:(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\(|(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b[^(]*\(|\(|(\w+)\s*=>))/gm;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const name = (m[1] ?? m[2])!;
    const single = m[3];
    let params = single ?? "";
    let after = m.index + m[0].length;
    if (!single) {
      // m[0] ends just after "(": read the parameter list.
      let depth = 1;
      let j = after;
      for (; j < source.length && depth > 0; j++) {
        if (source[j] === "(") depth++;
        else if (source[j] === ")") depth--;
      }
      params = source.slice(after, j - 1);
      after = j;
    }
    // A const that isn't a function (`const x = (a + b)`) has no "=>" or body:
    // it is still scanned, as a function with no Visible, which fails closed.
    const end = declarationEnd(source, m.index);
    out.push({ name, params, text: source.slice(m.index, end), start: m.index, end });
  }
  return out;
}

/**
 * Where a top-level declaration starting at `from` ends: the first line, with
 * its brackets balanced, that is a closing "}" at the start of a line, or
 * ends with ";", or is a one-line declaration ending in "}", and is followed
 * by a blank line, the end, or another top-level line.
 */
function declarationEnd(source: string, from: number): number {
  let depth = 0;
  let i = from;
  let first = true;
  while (i < source.length) {
    const nl = source.indexOf("\n", i);
    const lineEnd = nl === -1 ? source.length : nl;
    const line = stripComments(source.slice(i, lineEnd));
    for (const ch of line) {
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth--;
    }
    const trimmed = line.trimEnd();
    const next = nl === -1 ? "" : source.slice(nl + 1, source.indexOf("\n", nl + 1) === -1 ? source.length : source.indexOf("\n", nl + 1));
    const nextTopLevel = next.trim() === "" || /^[A-Za-z_/@]/.test(next);
    const closes = /^[}\]]/.test(trimmed) || trimmed.endsWith(";") || (first && trimmed.endsWith("}"));
    if (depth <= 0 && closes && nextTopLevel) return lineEnd;
    if (nl === -1) return source.length;
    i = nl + 1;
    first = false;
  }
  return source.length;
}

/**
 * What is wrong with one filtered module: a function that reads the tables
 * without taking and using a Visible, or a table read outside any function
 * (an object of readers, say). Empty when all is well.
 */
function moduleProblems(file: string, source: string): string[] {
  const problems: string[] = [];
  const fns = functionsOf(source);
  if (fns.length === 0) problems.push(`${file}: found no functions; is the scanner broken?`);
  for (const fn of fns) {
    if (!touchesTables(fn.text)) continue;
    if (Object.hasOwn(UNFILTERED, fn.name)) continue;
    const param = visibleParam(fn.params);
    if (param === null) {
      problems.push(`${file}: ${fn.name}() reads sites or colonies but takes no Visible`);
      continue;
    }
    // The parameter must be used, not just declared.
    const body = stripComments(fn.text.slice(fn.text.indexOf(fn.params) + fn.params.length));
    if (!new RegExp(`\\b${param}\\b`).test(body)) {
      problems.push(`${file}: ${fn.name}() takes ${param} but never uses it`);
    }
  }
  // Everything outside the functions, imports removed, must not touch the tables.
  let outside = "";
  let at = 0;
  for (const fn of [...fns].sort((a, b) => a.start - b.start)) {
    if (fn.start < at) continue;
    outside += source.slice(at, fn.start);
    at = fn.end;
  }
  outside += source.slice(at);
  outside = outside.replace(/^import[\s\S]*?from\s+"[^"]+";/gm, "");
  if (touchesTables(outside)) problems.push(`${file}: reads sites or colonies outside any function`);
  return problems;
}

/** Casts that could forge a Visible or smuggle one past the type (review F5). */
function castProblems(file: string, source: string): string[] {
  const code = stripComments(source);
  return /\bas\s+(never|any)\b/.test(code) ? [`${file}: uses "as never" or "as any"`] : [];
}

/**
 * Who a Visible is built for (review F5): outside lib/guardianView.ts and the
 * tests, visibleColonyIds and isIslandWide take a person, never an object
 * written on the spot (which could claim to be the team).
 */
function forgeProblems(file: string, source: string): string[] {
  const code = stripComments(source);
  const out: string[] = [];
  for (const m of code.matchAll(/\b(visibleColonyIds|isIslandWide)\s*\(/g)) {
    // The argument, up to its matching ")".
    let depth = 1;
    let j = m.index! + m[0].length;
    const from = j;
    for (; j < code.length && depth > 0; j++) {
      if (code[j] === "(") depth++;
      else if (code[j] === ")") depth--;
    }
    const arg = code.slice(from, j - 1);
    if (/[{[]|\bas\b|\.\.\./.test(arg)) out.push(`${file}: ${m[1]}(${arg.trim().slice(0, 40)}) is given a made-up person`);
  }
  return out;
}

/** The name of the parameter typed `Visible`, if there is one. */
const visibleParam = (params: string) => /(\w+)\s*:\s*Visible\b/.exec(params)?.[1] ?? null;

describe("every sites and colonies read takes a Visible and uses it", () => {
  for (const file of FILTERED_MODULES) {
    it(file, () => {
      expect(moduleProblems(file, read(file))).toEqual([]);
    });
  }

  it("the allow-list names only functions that exist (no stale excuses)", () => {
    const all = new Set(FILTERED_MODULES.flatMap((f) => functionsOf(read(f)).map((fn) => fn.name)));
    for (const name of Object.keys(UNFILTERED)) expect(all, name).toContain(name);
  });

  it("every write on the allow-list says how its route is checked", () => {
    // A cheap tripwire: anything added here must say why it may skip the Visible.
    for (const name of Object.keys(UNFILTERED)) {
      expect(UNFILTERED[name]!.length, name).toBeGreaterThan(10);
    }
  });
});

describe("a target module reads only a record's colony", () => {
  // Review of PR 4.2 (M1): the first version of this test let a whole-row
  // read through. Every read of feeding_sites here must name exactly its
  // colony column, and no other table this file guards may appear at all.
  const src = stripComments(read("lib/capabilityTargets.ts"));

  it("every read of feeding_sites in capabilityTargets.ts selects its colony id and nothing else", () => {
    const froms = src.match(/\.from\(\s*feedingSitesTable\s*\)/g) ?? [];
    const narrow = src.match(/\.select\(\s*\{\s*colonyId:\s*feedingSitesTable\.colonyId\s*\}\s*\)\s*\.from\(\s*feedingSitesTable\s*\)/g) ?? [];
    expect(froms.length).toBeGreaterThan(0);
    expect(narrow.length).toBe(froms.length);
    const columns = [...src.matchAll(/feedingSitesTable\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(columns)).toEqual(new Set(["colonyId", "id"]));
  });

  it("capabilityTargets.ts touches no other guarded table, by name or in SQL", () => {
    for (const table of TABLES.filter((t) => t !== "feedingSitesTable")) {
      expect(src, table).not.toMatch(new RegExp(`\\b${table}\\b`));
    }
    expect(src).not.toMatch(SQL_TABLE_RE);
  });

  it("a planted whole-row read, or a colonies read, turns it red", () => {
    const wide = src + "\nexport const x = () => db.select().from(feedingSitesTable);";
    const froms = wide.match(/\.from\(\s*feedingSitesTable\s*\)/g) ?? [];
    const narrow = wide.match(/\.select\(\s*\{\s*colonyId:\s*feedingSitesTable\.colonyId\s*\}\s*\)\s*\.from\(\s*feedingSitesTable\s*\)/g) ?? [];
    expect(narrow.length).not.toBe(froms.length);
    expect("db.select().from(coloniesTable)").toMatch(/\bcoloniesTable\b/);
  });
});

/**
 * Is this call of an island-only reader guarded (review of PR #224)? Only two
 * shapes count, both checked on the source with comments removed:
 * - inline: `can(person, "<capability>") ? await <fn>(` and nothing else
 *   between the check and the call;
 * - the route's own door: `requireTeam("<capability>")`, or a form's
 *   `formRoute("<capability>")` (which wraps it), among the middleware of the
 *   same `router.<method>(` statement, before its handler starts.
 */
function guardedCall(src: string, index: number, capability: string): boolean {
  const before = src.slice(0, index);
  const inline = new RegExp(`can\\(person, "${capability}"\\)\\s*\\?\\s*await\\s*$`);
  if (inline.test(before)) return true;
  const start = before.lastIndexOf("router.");
  if (start < 0) return false;
  const handler = before.indexOf("async (", start);
  const middleware = before.slice(start, handler < 0 ? index : handler);
  return middleware.includes(`requireTeam("${capability}")`) || middleware.includes(`formRoute("${capability}")`);
}

describe("island-only readers are called only behind their capability", () => {
  const routeFiles = readdirSync(join(SRC, "routes")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("every call in every route file is guarded", () => {
    let seen = 0;
    for (const file of routeFiles) {
      const src = stripComments(read(join("routes", file)));
      for (const { fns, capabilities } of Object.values(ISLAND_ONLY_MODULES)) {
        for (const fn of fns) {
          for (const call of src.matchAll(new RegExp(`\\b${fn}\\(`, "g"))) {
            seen++;
            const ok = capabilities.some((cap) => guardedCall(src, call.index, cap));
            expect(ok, `${file}: ${fn}() at offset ${call.index} without ${capabilities.join(" or ")}`).toBe(true);
          }
        }
      }
    }
    // The Colonies page and its own route both call it.
    expect(seen).toBeGreaterThanOrEqual(2);
  });

  it("planted unguarded calls turn it red", () => {
    const cap = "view_guardian_changes";
    const guarded = [
      `router.get("/a", requireTeam("${cap}"), async (req, res) => { res.json(await recentGuardianChanges()); });`,
      `router.get("/a", ...requireSeeing(), async (req, res) => { const x = can(person, "${cap}") ? await recentGuardianChanges() : undefined; });`,
      `router.post("/a", ...formRoute("${cap}"), async (req, res) => { await recentGuardianChanges(); });`,
    ];
    const planted = [
      // a check whose answer is never used
      `router.get("/a", ...requireSeeing(), async (req, res) => { const ok = can(person, "${cap}"); await recentGuardianChanges(); });`,
      // the guard sits in the handler, not the door
      `router.get("/a", ...requireSeeing(), async (req, res) => { requireTeam("${cap}"); await recentGuardianChanges(); });`,
      // another route's door, then an open route
      `router.get("/a", requireTeam("${cap}"), async () => {}); router.get("/b", ...requireSeeing(), async () => { await recentGuardianChanges(); });`,
      // a helper outside any route
      `const helper = async () => recentGuardianChanges();`,
      // a form route for another capability
      `router.post("/a", ...formRoute("view_exact_location"), async (req, res) => { await recentGuardianChanges(); });`,
    ];
    const at = (src: string) => src.indexOf("recentGuardianChanges(");
    for (const src of guarded) expect(guardedCall(src, at(src), cap), src).toBe(true);
    for (const src of planted) expect(guardedCall(src, at(src), cap), src).toBe(false);
    // A guard only inside a comment doesn't count once comments are removed.
    const commented = `router.get("/a", ...requireSeeing(), async () => { // can(person, "${cap}") ? await\n await recentGuardianChanges(); });`;
    const stripped = stripComments(commented);
    expect(guardedCall(stripped, at(stripped), cap)).toBe(false);
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
          FILTERED_MODULES.includes(lib) ||
            lib === "lib/guardianView.ts" ||
            lib in TARGET_MODULES ||
            lib in ISLAND_ONLY_MODULES,
          `${file} calls ${lib}, which touches sites or colonies but isn't checked here`,
        ).toBe(true);
      }
    });

    it(`${file} never calls canSomewhere (the sign-in door's alone)`, () => {
      expect(read(join("routes", file))).not.toMatch(/\bcanSomewhere\b/);
    });
  }
});

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

describe("a Visible is made in one place only", () => {
  it("nothing but lib/guardianView.ts casts to Visible or builds { ids }", () => {
    for (const file of sources(SRC)) {
      if (file === join("lib", "guardianView.ts")) continue;
      const src = read(file);
      expect(src, `${file} casts to Visible`).not.toMatch(/as\s+(unknown\s+as\s+)?Visible\b/);
      expect(src, `${file} declares its own Visible`).not.toMatch(/^\s*(export\s+)?(interface|type)\s+Visible\b\s*(=|\{|<)/m);
    }
  });
});

describe("nothing forges a Visible (review F5)", () => {
  const ROUTE_FILES = [
    "routes/teamSites.ts",
    "routes/teamColonies.ts",
    "routes/teamMap.ts",
    "routes/teamCats.ts",
    "routes/teamPeople.ts",
    "middlewares/requireSeeing.ts",
  ];

  it("no 'as never' or 'as any' in the filtered modules, guardianView.ts or the team route files", () => {
    for (const file of [...FILTERED_MODULES, "lib/guardianView.ts", ...ROUTE_FILES]) {
      expect(castProblems(file, read(file))).toEqual([]);
    }
  });

  it("outside guardianView.ts and the tests, visibleColonyIds and isIslandWide are only ever given a person", () => {
    const all = sources(SRC).filter((f) => f !== join("lib", "guardianView.ts"));
    expect(all.length).toBeGreaterThan(50);
    for (const file of all) expect(forgeProblems(file, read(file))).toEqual([]);
  });
});

describe("the scanner itself: planted readers turn it red (review F1, F5)", () => {
  const real = read("lib/teamSites.ts");
  const plant = (extra: string) => `${real}\n${extra}\n`;

  it("the real module is clean", () => {
    expect(moduleProblems("lib/teamSites.ts", real)).toEqual([]);
  });

  it.each([
    ["an arrow reader", "export const everySite = async () => db.select().from(feedingSitesTable);"],
    ["an arrow reader over several lines", "export const everySite = async () =>\n  db\n    .select()\n    .from(feedingSitesTable);"],
    ["a const function", "export const everySite = async function () {\n  return db.select().from(feedingSitesTable);\n};"],
    ["a one-parameter arrow", "export const siteNamed = (n) => db.select().from(feedingSitesTable).where(eq(feedingSitesTable.name, n));"],
    ["raw SQL in a function", "export async function rawSites() {\n  return db.execute(sql`select * from feeding_sites`);\n}"],
    ["raw SQL in an arrow", "export const rawColonies = () => db.execute(sql`SELECT name FROM colonies`);"],
    ["raw SQL joining the history", "export async function rawHistory() {\n  return pool.query(\"select * from x join mapping_events on true\");\n}"],
    ["a reader in an object", "export const readers = {\n  all: () => db.select().from(feedingSitesTable),\n};"],
    ["a Visible taken but not used", "export async function sloppy(visible: Visible) {\n  return db.select().from(coloniesTable);\n}"],
  ])("%s", (_label, code) => {
    expect(moduleProblems("lib/teamSites.ts", plant(code)).length).toBeGreaterThan(0);
  });

  it("a comment naming a table is not a read", () => {
    expect(moduleProblems("lib/teamSites.ts", plant("// select * from feeding_sites, via feedingSitesTable"))).toEqual([]);
  });

  it.each([
    ["as never", "const v = { ids: null } as never;"],
    ["as any", "const v = { ids: null } as any;"],
  ])("a forged cast (%s) is caught", (_label, code) => {
    expect(castProblems("lib/teamSites.ts", plant(code)).length).toBeGreaterThan(0);
  });

  it.each([
    ["an island row written on the spot", 'visibleColonyIds({ scopes: [{ role: "staff", colonyId: null }] })'],
    ["a spread person", "visibleColonyIds({ ...person, scopes: [] })"],
    ["a cast person", "isIslandWide(person as Person)"],
  ])("%s is caught", (_label, code) => {
    expect(forgeProblems("routes/teamSites.ts", `const x = ${code};`).length).toBeGreaterThan(0);
  });

  it("a real person is fine", () => {
    expect(forgeProblems("routes/teamSites.ts", "visibleColonyIds(teamPerson(res)); isIslandWide(person);")).toEqual([]);
  });
});
