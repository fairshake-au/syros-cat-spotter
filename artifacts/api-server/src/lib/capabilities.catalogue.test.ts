import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITIES, CATALOGUE, type Capability, type CapabilityKind } from "./capabilities";

// T24 (roles-and-invites.md §15.3 test 24; SYC-53 PR 0.5, review minor 13):
// the catalogue in code is compared with the §6.2 tables PARSED FROM THE SPEC
// ITSELF, so the document and the code can't drift. The table's shape is
// pinned (header text and column count), so a later spec edit fails with a
// message naming the row or column that changed, not a parser error. The
// sibling specs that cite the catalogue (SYC-209's feeding sites and
// colonies, SYC-2's coat and health) are parsed too: every name they cite
// must exist here.

const SPECS = join(__dirname, "../../../../docs/specs");
const read = (name: string) => readFileSync(join(SPECS, name), "utf8");

const HEADER = "| Capability | What it lets you do | Kind | Team | Management | Guardian |";
const KINDS: Record<string, CapabilityKind> = {
  Placed: "placed",
  "Island-only": "island",
  "Role-wide": "role_wide",
  "Creates its own scope": "own_scope",
};

/**
 * Names in code that §6.2 doesn't list yet, each with the spec that adds it.
 * Keep this short: team-access §7.3 says the roles catalogue takes
 * `remove_owner` in; when §6.2 does, this test fails and says to move it.
 */
const CITED_ELSEWHERE: Partial<Record<Capability, string>> = {
  remove_owner: "claiming-a-cat.md",
};

interface SpecRow {
  names: string[];
  kind: CapabilityKind;
  roles: string[];
  line: string;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/** Who holds it, from one row's Team, Management and Guardian cells. */
function rolesOf(team: string, mgmt: string, guardian: string, line: string): string[] {
  const holds = (cell: string, column: string, yes: string[]) => {
    if (yes.includes(cell)) return true;
    if (cell === "—") return false;
    throw new Error(`§6.2: the ${column} column says "${cell}" in: ${line}`);
  };
  const roles: string[] = [];
  if (holds(team, "Team", ["All", "✓"])) roles.push("staff");
  if (holds(mgmt, "Management", ["All", "✓"])) roles.push("management");
  if (holds(guardian, "Guardian", ["Own", "✓"])) roles.push("guardian");
  return roles;
}

/** The §6.2 tables, row by row. */
function parseCatalogue(spec: string): SpecRow[] {
  const start = spec.indexOf("### 6.2 The catalogue");
  const end = spec.indexOf("### 6.3", start);
  if (start === -1 || end === -1) throw new Error("roles-and-invites.md: no §6.2 / §6.3 heading");
  const lines = spec.slice(start, end).split("\n");
  const rows: SpecRow[] = [];
  let tables = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("|")) continue;
    if (!line.startsWith("| Capability")) continue;
    tables++;
    if (line.trim() !== HEADER) {
      throw new Error(`§6.2: a table header changed. Expected:\n${HEADER}\nGot:\n${line.trim()}`);
    }
    i++; // the |---| line
    for (i++; i < lines.length && lines[i]!.startsWith("|"); i++) {
      const row = lines[i]!;
      const c = cells(row);
      if (c.length !== 6) throw new Error(`§6.2: a row has ${c.length} columns, not 6: ${row}`);
      const names = [...c[0]!.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!);
      if (names.length === 0) throw new Error(`§6.2: a row names no capability: ${row}`);
      const kind = KINDS[c[2]!];
      if (!kind) throw new Error(`§6.2: unknown kind "${c[2]}" in: ${row}`);
      rows.push({ names, kind, roles: rolesOf(c[3]!, c[4]!, c[5]!, row), line: row });
    }
  }
  if (tables !== 4) throw new Error(`§6.2: expected 4 tables, found ${tables}`);
  return rows;
}

/** Names a sibling spec cites in its own capability tables. */
function citedIn(spec: string): { name: string; kind: string; line: string }[] {
  const out: { name: string; kind: string; line: string }[] = [];
  const lines = spec.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i]!;
    if (!/^\| Capability\b/.test(header)) continue;
    const kindCol = cells(header).findIndex((h) => h === "Kind");
    for (i += 2; i < lines.length && lines[i]!.startsWith("|"); i++) {
      const c = cells(lines[i]!);
      for (const m of c[0]!.matchAll(/`([a-z_]+)`/g)) {
        out.push({ name: m[1]!, kind: kindCol >= 0 ? c[kindCol]! : "", line: lines[i]! });
      }
    }
  }
  return out;
}

const ROLES = read("roles-and-invites.md");
const rows = parseCatalogue(ROLES);
const specNames = rows.flatMap((r) => r.names);

describe("T24: the catalogue in code equals roles-and-invites.md §6.2", () => {
  it("reads four tables of the pinned shape, with every name once", () => {
    expect(rows.length).toBeGreaterThan(25);
    expect(new Set(specNames).size).toBe(specNames.length);
  });

  it("every name in §6.2 is in code, and every name in code is in §6.2 or cited from a named spec", () => {
    const code = new Set<string>(CAPABILITIES);
    for (const name of specNames) {
      expect(code.has(name), `§6.2 names ${name}, which code doesn't have`).toBe(true);
    }
    for (const name of CAPABILITIES) {
      if (specNames.includes(name)) continue;
      expect(CITED_ELSEWHERE[name], `code has ${name}, which §6.2 doesn't list`).toBeDefined();
    }
  });

  it("each name has the spec's kind and is held by exactly the spec's roles", () => {
    for (const row of rows) {
      for (const name of row.names) {
        const entry = CATALOGUE[name as Capability];
        expect(entry.kind, `${name}'s kind, from: ${row.line}`).toBe(row.kind);
        expect([...entry.roles].sort(), `${name}'s roles, from: ${row.line}`).toEqual([...row.roles].sort());
      }
    }
  });

  it("a name cited from elsewhere is still cited there, and not yet in §6.2 (move it here when it is)", () => {
    for (const [name, spec] of Object.entries(CITED_ELSEWHERE)) {
      expect(read(spec!), `${spec} no longer names ${name}`).toContain(`\`${name}\``);
      expect(specNames, `§6.2 now lists ${name}: drop it from CITED_ELSEWHERE`).not.toContain(name);
    }
  });
});

describe("T24: the sibling specs cite only names in the catalogue", () => {
  for (const spec of ["feeding-sites-and-colonies.md", "coat-markings-and-health.md"]) {
    it(`${spec}: every capability it cites exists, with the same kind where it states one`, () => {
      const cited = citedIn(read(spec));
      expect(cited.length, `${spec}: found no capability table`).toBeGreaterThan(2);
      for (const { name, kind, line } of cited) {
        expect(CAPABILITIES as readonly string[], `${spec} cites ${name}: ${line}`).toContain(name);
        const stated = KINDS[kind];
        if (stated) expect(CATALOGUE[name as Capability].kind, `${spec}: ${line}`).toBe(stated);
      }
    });
  }
});
