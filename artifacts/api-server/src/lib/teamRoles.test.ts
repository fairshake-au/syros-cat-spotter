import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { TEAM_ROLE_NAMES, TEAM_ROLES, isTeamRole } from "./teamRoles";

// SYC-53 plan, PR 0.2 (roles spec §10.4): there is ONE list of the team's
// roles, used by the resolver, the Probably sterilised list and the
// correction routes. Before it there were three, and a copy that forgets a
// role silently de-authorises everyone holding it.

const API_SRC = join(__dirname, "..");
const DB_SRC = join(__dirname, "../../../../lib/db/src");
const HOME = join(__dirname, "teamRoles.ts");

/** The team's role words, including the retired `admin`, whose return in a
 * list of its own would be the same drift. */
const ROLE_WORDS = new Set(["staff", "management", "vet", "admin"]);

/**
 * The one list allowed outside teamRoles.ts, by its exact text:
 * `PERSON_ROLES` in lib/db/src/schema/people.ts. It is a different list on
 * purpose: which roles a person_scopes row may hold (who may be on the list
 * at all, guardians included), not which roles count as the team's. PR 0.3's
 * roles migration changed it, and added ISLAND_ROLES beside it. Any other list in lib/db fails, as in the
 * api-server.
 */
const ALLOWED = new Set([
  `schema/people.ts: export const PERSON_ROLES = ["staff", "management", "guardian", "vet"]`,
  // PR 0.3: the roles that are always island-wide, for person_scopes'
  // database check and set-roles' "no island role" refusal. Not the team's
  // roles either (it has no vet).
  `schema/people.ts: export const ISLAND_ROLES = ["staff", "management"]`,
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "node_modules" || name === "__fixtures__" || name === "test"
        ? []
        : sourceFiles(path);
    }
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

const roleWordsIn = (text: string) =>
  new Set(
    [...text.matchAll(/["'`]([a-z_]+)["'`]/g)].map((w) => w[1]!).filter((w) => ROLE_WORDS.has(w)),
  );

const tidy = (s: string) => s.replace(/\s+/g, " ").slice(0, 140);

/**
 * Every way of writing a list of the team's roles this test knows:
 *
 * - an array literal (and so every `new Set([...])`) naming two or more
 *   role words;
 * - a SQL `in (...)` list naming two or more;
 * - a role word passed to `.add(...)`: a set built up one call at a time
 *   is a list too, and even a single `.add("management")` onto some other
 *   set is a second place a team role is granted.
 *
 * One role word on its own elsewhere (`role === "staff"`, `coat: ["vet"]`)
 * is not a list of the team's roles.
 */
function roleLists(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/(?:export\s+)?(?:const\s+\w+\s*(?::[^=]*)?=\s*)?\[([^[\]]*)\]/g)) {
    if (roleWordsIn(m[1]!).size >= 2) found.push(tidy(m[0]!));
  }
  for (const m of source.matchAll(/\bin\s*\(([^()]*)\)/gi)) {
    if (roleWordsIn(m[1]!).size >= 2) found.push(tidy(m[0]!));
  }
  for (const m of source.matchAll(/\.add\(\s*(["'`][a-z_]+["'`])\s*\)/g)) {
    if (roleWordsIn(m[1]!).size >= 1) found.push(tidy(m[0]!));
  }
  return found;
}

function offendersUnder(root: string): string[] {
  return sourceFiles(root)
    .filter((path) => path !== HOME)
    .flatMap((path) =>
      roleLists(readFileSync(path, "utf8")).map((list) => `${relative(root, path)}: ${list}`),
    )
    .filter((entry) => !ALLOWED.has(entry));
}

describe("the one list of team roles (SYC-53 PR 0.2)", () => {
  it("is staff, management and vet: no guardian (review M1), no admin, no volunteer", () => {
    expect([...TEAM_ROLE_NAMES]).toEqual(["staff", "management", "vet"]);
    expect([...TEAM_ROLES]).toEqual(["staff", "management", "vet"]);
    for (const role of ["guardian", "admin", "volunteer", "public", "system"]) {
      expect(isTeamRole(role)).toBe(false);
    }
  });

  it("is written nowhere else in the api-server: a second list of team roles fails this test", () => {
    expect(offendersUnder(API_SRC)).toEqual([]);
  });

  it("is written nowhere else in lib/db either, apart from PERSON_ROLES (a different list, on purpose)", () => {
    expect(offendersUnder(DB_SRC)).toEqual([]);
    // The allowance is exact: PERSON_ROLES is still found, and still matches.
    const people = readFileSync(join(DB_SRC, "schema/people.ts"), "utf8");
    expect(roleLists(people).map((l) => `schema/people.ts: ${l}`)).toEqual([...ALLOWED]);
  });

  it("the scan finds a list in every form it knows (so an empty result means something)", () => {
    expect(roleLists(`const R = new Set(["vet", "staff", "admin"]);`)).toHaveLength(1);
    expect(roleLists(`const R = new Set([\n  "staff",\n  'management',\n]);`)).toHaveLength(1);
    expect(roleLists("sql`where role_at_time in ('staff', 'management')`")).toHaveLength(1);
    expect(roleLists(`where o.role_at_time IN ( 'vet','admin' )`)).toHaveLength(1);
    expect(roleLists(`const s = new Set<string>(); s.add("staff"); s.add('management');`)).toHaveLength(2);
    expect(roleLists(`AUTHORITATIVE.add("management")`)).toHaveLength(1);
    expect(roleLists(`if (role === "staff") {}; const k = { coat: ["vet"] }; ids.add(3)`)).toEqual([]);
    expect(readFileSync(HOME, "utf8")).toContain(`["staff", "management", "vet"]`);
  });
});
