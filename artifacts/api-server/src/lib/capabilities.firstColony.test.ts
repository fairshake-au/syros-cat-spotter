import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  CATALOGUE,
  can,
  canSomewhere,
  capabilitiesOf,
  doorFor,
  holdsIslandRow,
  holdsStartRow,
  mayEnter,
  maySignIn,
  mayUseWorkspace,
} from "./capabilities";
import { opensColoniesList } from "../middlewares/requireSeeing";

// SYC-439 (roles-and-invites-first-colony.md §4): a cat guardian with no
// colony yet. A "start" row grants `create_colony` and nothing else, opens
// the door as `starting` (never `in`), and counts only when its reach SAYS
// start.

const starter = { scopes: [{ role: "guardian", colonyId: null, reach: "start" }] };
const guardian = { scopes: [{ role: "guardian", colonyId: 3, reach: "colony" }] };
const staff = { scopes: [{ role: "staff", colonyId: null, reach: "island" }] };
const vet = { scopes: [{ role: "vet", colonyId: null, reach: "island" }] };
const ended = { scopes: [] }; // every placement ended: the reader drops ended rows

describe("a 'no colony yet' row (SYC-439)", () => {
  it("grants create_colony, and no other capability, here or anywhere", () => {
    expect(can(starter, "create_colony")).toBe(true);
    for (const c of CAPABILITIES) {
      if (c === "create_colony") continue;
      expect(can(starter, c), c).toBe(false);
      expect(can(starter, c, { colonyId: 3 }), c).toBe(false);
      expect(canSomewhere(starter, c), c).toBe(false);
    }
    // It shares a kind's branch with nothing: create_colony is the only own-scope capability.
    expect(CAPABILITIES.filter((c) => CATALOGUE[c].kind === "own_scope")).toEqual(["create_colony"]);
    expect(can(starter, "match_cat_anywhere")).toBe(false);
  });

  it("is ignored by canSomewhere, mayEnter and capabilitiesOf on purpose (they'd open every door-only page)", () => {
    expect(canSomewhere(starter, "create_colony")).toBe(false);
    expect(mayEnter(starter)).toBe(false);
    expect(capabilitiesOf(starter)).toEqual([]);
    expect(holdsIslandRow(starter)).toBe(false);
    expect(mayUseWorkspace(starter)).toBe(false);
  });

  it("opens the door as `starting`, and only that", () => {
    expect(holdsStartRow(starter)).toBe(true);
    expect(doorFor(starter)).toBe("starting");
    expect(maySignIn(starter)).toBe(true);
  });

  it("counts only when its reach says start: no reach, another reach or another role is nothing", () => {
    for (const person of [
      { scopes: [{ role: "guardian", colonyId: null }] },
      { scopes: [{ role: "guardian", colonyId: null, reach: "island" }] },
      { scopes: [{ role: "guardian", colonyId: null, reach: "colony" }] },
      { scopes: [{ role: "staff", colonyId: null, reach: "start" }] },
      { scopes: [{ role: "vet", colonyId: null, reach: "start" }] },
      { scopes: [{ role: "guardian", colonyId: 3, reach: "start" }] },
    ]) {
      const where = JSON.stringify(person);
      expect(holdsStartRow(person), where).toBe(false);
      expect(doorFor(person), where).toBe("out");
      expect(can(person, "create_colony"), where).toBe(false);
    }
  });

  it("leaves the other answers as they were: ended and a vet are out, a guardian and the team are in", () => {
    expect(doorFor(ended)).toBe("out");
    expect(doorFor(vet)).toBe("out");
    expect(maySignIn(ended)).toBe(false);
    expect(maySignIn(vet)).toBe(false);
    expect(doorFor(guardian)).toBe("in");
    expect(doorFor(staff)).toBe("in");
  });
});

describe("the Colonies list's own door (requireColoniesList)", () => {
  it("opens for someone who sees a colony or has no colony yet, and for nobody else", () => {
    expect(opensColoniesList(starter)).toBe(true);
    expect(opensColoniesList(guardian)).toBe(true);
    expect(opensColoniesList(staff)).toBe(true);
    expect(opensColoniesList(vet)).toBe(false);
    expect(opensColoniesList(ended)).toBe(false);
    expect(opensColoniesList({ scopes: [{ role: "guardian", colonyId: null }] })).toBe(false);
  });
});

describe("only GET and POST /team/colonies are open to her (source scan, SYC-439)", () => {
  it("the `starting` route option appears exactly twice, both in routes/teamColonies.ts", () => {
    const src = join(__dirname, "..");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return walk(p);
        return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
      });
    const files = walk(src);
    expect(files.length).toBeGreaterThan(50);
    const uses: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/starting:\s*true\s*}/g)) uses.push(`${f}@${m.index}`);
    }
    const inColonies = uses.filter((u) => u.includes(join("routes", "teamColonies.ts")));
    const inSeeing = uses.filter((u) => u.includes(join("middlewares", "requireSeeing.ts")));
    // POST /team/colonies names it directly; GET /team/colonies through requireColoniesList.
    expect(inColonies, uses.join("\n")).toHaveLength(1);
    expect(inSeeing, uses.join("\n")).toHaveLength(1);
    expect(uses, uses.join("\n")).toHaveLength(2);
    const seeing = readFileSync(join(src, "middlewares", "requireSeeing.ts"), "utf8");
    const routes = walk(join(src, "routes")).map((f) => readFileSync(f, "utf8"));
    const listUses = routes.join("\n").match(/requireColoniesList\(\)/g) ?? [];
    expect(listUses).toHaveLength(1);
    expect(seeing).toContain("export const requireColoniesList");
  });
});
