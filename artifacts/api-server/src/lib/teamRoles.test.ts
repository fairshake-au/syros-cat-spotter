import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { TEAM_ROLE_NAMES, TEAM_ROLES, isTeamRole } from "./teamRoles";

// SYC-53 plan, PR 0.2 (roles spec §10.4): there is ONE list of the team's
// roles, used by the resolver, the Probably sterilised list and the
// correction routes. Before it there were three, and a copy that forgets a
// role silently de-authorises everyone holding it.

const SRC = join(__dirname, "..");
const HOME = join(__dirname, "teamRoles.ts");

/** The team's role words, including the retired `admin`, whose return in a
 * list of its own would be the same drift. */
const ROLE_WORDS = new Set(["staff", "management", "vet", "admin"]);

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

/**
 * Every array literal (and so every `new Set([...])`) that names two or more
 * of the team's role words. One role word on its own (`role === "staff"`,
 * `coat: ["vet"]`) is not a list of the team's roles.
 */
function roleLists(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/\[([^[\]]*)\]/g)) {
    const words = new Set(
      [...m[1]!.matchAll(/["'`]([a-z_]+)["'`]/g)].map((w) => w[1]!).filter((w) => ROLE_WORDS.has(w)),
    );
    if (words.size >= 2) found.push(m[0]!.replace(/\s+/g, " ").slice(0, 120));
  }
  return found;
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
    const offenders = sourceFiles(SRC)
      .filter((path) => path !== HOME)
      .flatMap((path) =>
        roleLists(readFileSync(path, "utf8")).map((list) => `${relative(SRC, path)}: ${list}`),
      );
    expect(offenders).toEqual([]);
  });

  it("the scan does find a list when one is written (so an empty result means something)", () => {
    expect(roleLists(`const R = new Set(["vet", "staff", "admin"]);`)).toHaveLength(1);
    expect(roleLists(`const R = new Set([\n  "staff",\n  'management',\n]);`)).toHaveLength(1);
    expect(roleLists(`if (role === "staff") {}; const k = { coat: ["vet"] };`)).toEqual([]);
    expect(readFileSync(HOME, "utf8")).toContain(`["staff", "management", "vet"]`);
  });
});
