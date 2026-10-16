import { describe, expect, it } from "vitest";
import type { Observation } from "@workspace/db/schema";
import {
  appearanceAuthorityLevel,
  authorityLevel,
  highestAuthority,
  outranks,
  resolveSterilised,
} from "./resolve";

// Decision G (Samuel, 12 and 13 October 2026; roles spec §7.2, §10.4; data
// spine §4.6, §10.2): vet (4) > owner (3) > cat guardian with a colony:<id>
// scope (2) > team, management and imports (1); anything else 0. The newest
// wins only within a level, and an exact tie goes to the later row.
//
// SYC-53 plan, PR 0.2, tests T12g (function half) and the precedence edges.
// Each edge is pinned at the function (authorityLevel / outranks /
// highestAuthority) and in the folds that rank statements: sterilisation and
// the ear tip. Nobody writes level 2, 3 or 4 yet, so every row here is a
// fixture.
//
// SYC-315, option B (Samuel, 16 October 2026): in the STERILISATION fold
// only, a newer "sterilised" beats any older "not sterilised", whoever said
// either; the older "no" is set aside, not a disagreement. `outranks` and
// `highestAuthority` (the function half, shared with the ear tip and
// appearance) keep plain Decision G, so the edges below pin both.

let nextId = 1000;

function obs(
  overrides: Partial<Observation> & { kind: string; value: unknown },
): Observation {
  const id = overrides.id ?? nextId++;
  const observedAt = overrides.observedAt ?? new Date("2026-01-01T00:00:00Z");
  return {
    id,
    catId: 1,
    kind: overrides.kind,
    value: overrides.value,
    deviceId: overrides.deviceId ?? null,
    accountId: overrides.accountId ?? "someone",
    roleAtTime: overrides.roleAtTime ?? "public",
    authorityScope: overrides.authorityScope ?? "none",
    provenance: overrides.provenance ?? "volunteered",
    suggestedValue: null,
    suggestionSource: null,
    sightingId: null,
    photoId: overrides.photoId ?? null,
    importRecordId: null,
    observedAt,
    createdAt: observedAt,
    supersedesId: overrides.supersedesId ?? null,
    supersedeReason: null,
    redactedAt: null,
    redactionReason: null,
  } as Observation;
}

type Who = "vet" | "owner" | "guardian" | "staff" | "management" | "import";

const WHO: Record<Who, Partial<Observation>> = {
  vet: { roleAtTime: "vet" },
  // A resident's claim today is written as `public` with this scope
  // (routes/cats.ts); SYC-130 decides what an owner's write will be.
  owner: { roleAtTime: "public", authorityScope: "owner_of_this_cat", accountId: null, deviceId: "owner-phone" },
  guardian: { roleAtTime: "guardian", authorityScope: "colony:7" },
  staff: { roleAtTime: "staff" },
  management: { roleAtTime: "management" },
  import: { roleAtTime: "system", accountId: "system:legacy-backfill", provenance: "import" },
};

const at = (iso: string) => new Date(iso);
const OLDER = at("2024-03-01T00:00:00Z");
const NEWER = at("2026-03-01T00:00:00Z");

function sterilised(who: Who, value: boolean, observedAt: Date, extra: Partial<Observation> = {}) {
  return obs({ kind: "sterilised", value: { sterilised: value }, observedAt, ...WHO[who], ...extra });
}

function earTip(who: Who, clipped: boolean, observedAt: Date, extra: Partial<Observation> = {}) {
  return obs({
    kind: "ear_tip",
    value: { clipped },
    observedAt,
    // Only a photo-backed clip counts as evidence (§10.2 rule 3).
    photoId: clipped ? nextId : null,
    ...WHO[who],
    ...extra,
  });
}

describe("authorityLevel (Decision G)", () => {
  it("vet 4, owner 3, cat guardian 2, team, management and imports 1", () => {
    expect(authorityLevel(WHO.vet as Observation)).toBe(4);
    expect(authorityLevel(obs({ kind: "x", value: null, ...WHO.owner }))).toBe(3);
    expect(authorityLevel(obs({ kind: "x", value: null, ...WHO.guardian }))).toBe(2);
    expect(authorityLevel(obs({ kind: "x", value: null, ...WHO.staff }))).toBe(1);
    expect(authorityLevel(obs({ kind: "x", value: null, ...WHO.management }))).toBe(1);
    expect(authorityLevel(obs({ kind: "x", value: null, ...WHO.import }))).toBe(1);
  });

  it("management ranks with the team, not above it", () => {
    expect(authorityLevel(obs({ kind: "x", value: null, ...WHO.management }))).toBe(
      authorityLevel(obs({ kind: "x", value: null, ...WHO.staff })),
    );
  });

  it("anything else counts for nothing: a spotter, the system, the retired admin and volunteer", () => {
    for (const roleAtTime of ["public", "system", "admin", "volunteer", "nonsense"]) {
      expect(authorityLevel(obs({ kind: "x", value: null, roleAtTime }))).toBe(0);
    }
  });

  it("a guardian counts only with an exact colony:<id> scope", () => {
    for (const authorityScope of ["none", "guardian_of_this_cat", "colony:0", "colony:07", "colony:7x", "colony:", "colony:-1", " colony:7"]) {
      expect(
        authorityLevel(obs({ kind: "x", value: null, roleAtTime: "guardian", authorityScope })),
      ).toBe(0);
    }
    expect(
      authorityLevel(obs({ kind: "x", value: null, roleAtTime: "guardian", authorityScope: "colony:123" })),
    ).toBe(2);
  });

  it("a colony:<id> scope on a non-guardian role counts for nothing (level 0), whatever the role", () => {
    for (const roleAtTime of ["staff", "management", "vet", "public", "system"]) {
      for (const authorityScope of ["colony:7", "colony:0", "colony:junk"]) {
        expect(authorityLevel(obs({ kind: "x", value: null, roleAtTime, authorityScope }))).toBe(0);
      }
    }
    // ...including an import that carries one.
    expect(
      authorityLevel(obs({ kind: "x", value: null, ...WHO.import, authorityScope: "colony:7" })),
    ).toBe(0);
  });

  it("in the sterilisation fold, a team row with a colony scope is not a statement at all", () => {
    const stray = sterilised("staff", false, NEWER, { authorityScope: "colony:7" });
    expect(resolveSterilised([stray]).confidence).toBe("unknown");
    // And it can't beat a real guardian, as a level-2 row would at least tie.
    const realGuardian = sterilised("guardian", true, OLDER);
    const r = resolveSterilised([realGuardian, stray]);
    expect(r.value).toBe(true);
    expect(r.supportingObservationIds).toEqual([realGuardian.id]);
  });
});

describe("the precedence edges, at the function and in the sterilisation fold", () => {
  /** `winner` and `loser` each say the opposite; the fold must answer `winner`'s. */
  function expectWins(winner: Observation, loser: Observation) {
    expect(outranks(winner, loser)).toBe(true);
    expect(outranks(loser, winner)).toBe(false);
    expect(highestAuthority([winner, loser])?.id).toBe(winner.id);
    expect(highestAuthority([loser, winner])?.id).toBe(winner.id);
    for (const list of [[winner, loser], [loser, winner]]) {
      const r = resolveSterilised(list);
      expect(r.value).toBe((winner.value as { sterilised: boolean }).sterilised);
      expect(r.confidence).toBe("confirmed");
      expect(r.supportingObservationIds).toEqual([winner.id]);
      expect(r.conflicts).toEqual([loser.id]);
    }
  }

  /**
   * SYC-315 (B): `no` outranks `yes` by Decision G at the function, but in
   * the sterilisation fold the NEWER `yes` wins and the older `no` is set
   * aside (no conflict). Mutation probe: drop the newer-sterilised rule in
   * resolveSterilised → red.
   */
  function expectNewerYesWins(yes: Observation, no: Observation) {
    expect(yes.observedAt.getTime()).toBeGreaterThan(no.observedAt.getTime());
    for (const list of [[yes, no], [no, yes]]) {
      const r = resolveSterilised(list);
      expect(r.value).toBe(true);
      expect(r.confidence).toBe("confirmed");
      expect(r.supportingObservationIds).toEqual([yes.id]);
      expect(r.conflicts).toEqual([]);
    }
  }

  it("vet vs guardian: a guardian's statement newer than a vet's does not win", () => {
    expectWins(sterilised("vet", true, OLDER), sterilised("guardian", false, NEWER));
  });

  it("vet vs owner: an owner's statement newer than a vet's does not win", () => {
    expectWins(sterilised("vet", true, OLDER), sterilised("owner", false, NEWER));
  });

  it("vet vs the team and imports: a newer team or import statement does not win", () => {
    expectWins(sterilised("vet", true, OLDER), sterilised("staff", false, NEWER));
    expectWins(sterilised("vet", true, OLDER), sterilised("import", false, NEWER));
  });

  it("guardian vs team: a team statement newer than a guardian's does not win", () => {
    expectWins(sterilised("guardian", true, OLDER), sterilised("staff", false, NEWER));
    expectWins(sterilised("guardian", true, OLDER), sterilised("import", false, NEWER));
    // SYC-315 (B): a newer team "sterilised" beats a guardian's older "isn't".
    const g = sterilised("guardian", false, OLDER);
    const m = sterilised("management", true, NEWER);
    expect(outranks(g, m)).toBe(true);
    expectNewerYesWins(m, g);
  });

  it("guardian vs team: a guardian's newer statement beats the team's older one too", () => {
    expectWins(sterilised("guardian", false, NEWER), sterilised("staff", true, OLDER));
  });

  it("owner vs team: a team statement newer than an owner's does not win, and the reverse", () => {
    expectWins(sterilised("owner", true, OLDER), sterilised("staff", false, NEWER));
    expectWins(sterilised("owner", false, NEWER), sterilised("staff", true, OLDER));
    // SYC-315 (B): a newer team "sterilised" beats an owner's older "isn't",
    // and an owner's newer "sterilised" sets aside the team's older "isn't".
    const o = sterilised("owner", false, OLDER);
    const m = sterilised("management", true, NEWER);
    expect(outranks(o, m)).toBe(true);
    expectNewerYesWins(m, o);
    expectNewerYesWins(sterilised("owner", true, NEWER), sterilised("staff", false, OLDER));
  });

  it("owner beats guardian when the owner spoke first (an older owner statement still wins)", () => {
    expectWins(sterilised("owner", true, OLDER), sterilised("guardian", false, NEWER));
  });

  it("owner beats guardian when the owner spoke last (a newer owner statement wins)", () => {
    expectWins(sterilised("owner", false, NEWER), sterilised("guardian", true, OLDER));
  });

  it("same level, newest wins: two guardians, two owners, two team members", () => {
    expectWins(sterilised("guardian", false, NEWER), sterilised("guardian", true, OLDER, { authorityScope: "colony:9" }));
    expectWins(sterilised("owner", false, NEWER), sterilised("owner", true, OLDER));
    expectWins(sterilised("staff", false, NEWER), sterilised("staff", true, OLDER));
    // Management and staff are one level, so the newest of the two wins.
    expectWins(sterilised("management", false, NEWER), sterilised("staff", true, OLDER));
    expectWins(sterilised("import", false, NEWER), sterilised("staff", true, OLDER));
    // A newer "sterilised" at the same level wins too, and (SYC-315 B) the
    // older "isn't" it answers is set aside rather than shown as a conflict.
    expectNewerYesWins(sterilised("guardian", true, NEWER), sterilised("guardian", false, OLDER, { authorityScope: "colony:9" }));
    expectNewerYesWins(sterilised("owner", true, NEWER), sterilised("owner", false, OLDER));
    expectNewerYesWins(sterilised("staff", true, NEWER), sterilised("management", false, OLDER));
    expectNewerYesWins(sterilised("management", true, NEWER), sterilised("staff", false, OLDER));
    expectNewerYesWins(sterilised("import", true, NEWER), sterilised("staff", false, OLDER));
  });

  it("same level, same instant: the later row (higher id) wins, whichever order they arrive in", () => {
    const first = sterilised("guardian", true, NEWER, { id: 5001 });
    const later = sterilised("guardian", false, NEWER, { id: 5002 });
    expectWins(later, first);
    const t1 = sterilised("staff", false, NEWER, { id: 5003 });
    const t2 = sterilised("staff", true, NEWER, { id: 5004 });
    expectWins(t2, t1);
  });

  it("the highest level present decides among many, then the newest within it", () => {
    const rows = [
      sterilised("staff", false, at("2026-09-01T00:00:00Z")),
      sterilised("guardian", true, at("2025-01-01T00:00:00Z")),
      sterilised("guardian", false, at("2025-06-01T00:00:00Z")),
      sterilised("import", true, at("2025-03-01T00:00:00Z")),
    ];
    const r = resolveSterilised(rows);
    expect(r.value).toBe(false);
    expect(r.supportingObservationIds).toEqual([rows[2]!.id]);
    // SYC-315 (B): an import "sterilised" dated after every "isn't" sets them
    // all aside, and then the guardian's "sterilised" (the highest level
    // left) is the answer.
    const later = [...rows.slice(0, 3), sterilised("import", true, at("2026-10-01T00:00:00Z"))];
    const b = resolveSterilised(later);
    expect(b.value).toBe(true);
    expect(b.supportingObservationIds).toEqual([later[1]!.id]);
    expect(b.conflicts).toEqual([]);
  });

  it("a not-yet-linked import record ranks with the team: it never beats a guardian", () => {
    const g = sterilised("guardian", true, OLDER);
    const r = resolveSterilised([g], [{ id: 1, sterilised: false, observedAt: NEWER.toISOString() }]);
    expect(r.value).toBe(true);
    expect(r.supportingObservationIds).toEqual([g.id]);
    // SYC-315 (B): a newer import "sterilised" does beat a guardian's older
    // "isn't" (it has standing, and the operation can't be undone).
    const no = sterilised("guardian", false, OLDER);
    const b = resolveSterilised([no], [{ id: 1, sterilised: true, observedAt: NEWER.toISOString() }]);
    expect(b.value).toBe(true);
    expect(b.supportingObservationIds).toEqual([]);
    expect(b.conflicts).toEqual([]);
  });

  it("at the same instant, the cat's own record beats a not-yet-linked import record, either way round", () => {
    for (const own of [true, false]) {
      const row = sterilised("staff", own, NEWER);
      const r = resolveSterilised([row], [{ id: 1, sterilised: !own, observedAt: NEWER.toISOString() }]);
      expect(r.value).toBe(own);
      expect(r.supportingObservationIds).toEqual([row.id]);
    }
  });

  it("a level-0 statement (a spotter's sterilised:true) is never authority, whatever its date", () => {
    const spotter = obs({ kind: "sterilised", value: { sterilised: true }, observedAt: NEWER });
    expect(resolveSterilised([spotter]).confidence).toBe("unknown");
    expect(highestAuthority([spotter])).toBeUndefined();
  });
});

describe("the precedence edges in the ear-tip fold (§10.2 rule 3)", () => {
  // Between two ear-tip statements with standing, the order decides. A
  // photo-backed authoritative clip that wins keeps the cat at Likely (an ear
  // never makes it Confirmed); one that loses leaves it Unknown.

  it("vet vs guardian: a guardian's newer 'not a clip' does not knock out a vet's clip", () => {
    const r = resolveSterilised([earTip("vet", true, OLDER), earTip("guardian", false, NEWER)]);
    expect(r.confidence).toBe("likely");
    // ...and a vet's newer 'not a clip' does knock out a guardian's clip.
    expect(
      resolveSterilised([earTip("guardian", true, OLDER), earTip("vet", false, NEWER)]).confidence,
    ).toBe("unknown");
  });

  it("vet vs guardian: a vet's OLDER 'not a clip' still knocks out a guardian's newer clip", () => {
    expect(
      resolveSterilised([earTip("vet", false, OLDER), earTip("guardian", true, NEWER)]).confidence,
    ).toBe("unknown");
  });

  it("guardian vs team: a team 'not a clip' newer than a guardian's clip does not knock it out", () => {
    expect(
      resolveSterilised([earTip("guardian", true, OLDER), earTip("staff", false, NEWER)]).confidence,
    ).toBe("likely");
    expect(
      resolveSterilised([earTip("guardian", true, OLDER), earTip("management", false, NEWER)]).confidence,
    ).toBe("likely");
  });

  it("guardian vs team: a guardian's OLDER 'not a clip' knocks out a newer team clip", () => {
    expect(
      resolveSterilised([earTip("guardian", false, OLDER), earTip("staff", true, NEWER)]).confidence,
    ).toBe("unknown");
  });

  it("same level, newest wins, and an exact tie goes to the later row", () => {
    expect(
      resolveSterilised([earTip("guardian", false, OLDER), earTip("guardian", true, NEWER)]).confidence,
    ).toBe("likely");
    expect(
      resolveSterilised([earTip("guardian", true, OLDER), earTip("guardian", false, NEWER)]).confidence,
    ).toBe("unknown");
    expect(
      resolveSterilised([
        earTip("staff", true, NEWER, { id: 6001 }),
        earTip("staff", false, NEWER, { id: 6002 }),
      ]).confidence,
    ).toBe("unknown");
    expect(
      resolveSterilised([
        earTip("staff", false, NEWER, { id: 6003 }),
        earTip("staff", true, NEWER, { id: 6004 }),
      ]).confidence,
    ).toBe("likely");
  });

  it("a spotter's clip is evidence, not a statement: a team 'not a clip' as new or newer knocks it out, an older one doesn't (unchanged)", () => {
    const spotterClip = (when: Date) =>
      obs({ kind: "ear_tip", value: { clipped: true }, photoId: 1, deviceId: "spotter", accountId: null, observedAt: when });
    expect(resolveSterilised([spotterClip(OLDER), earTip("staff", false, NEWER)]).confidence).toBe("unknown");
    expect(resolveSterilised([spotterClip(NEWER), earTip("staff", false, NEWER)]).confidence).toBe("unknown");
    // A newer spotter clip after a team "not a clip" puts the cat back at Likely.
    expect(resolveSterilised([earTip("staff", false, OLDER), spotterClip(NEWER)]).confidence).toBe("likely");
    // Even a vet's older "not a clip" doesn't silence a newer spotter clip:
    // the clip is new evidence the team is shown, and it only reaches Likely.
    expect(resolveSterilised([earTip("vet", false, OLDER), spotterClip(NEWER)]).confidence).toBe("likely");
  });

  it("a vet keeps a vet's standing on the ear even on a row that also carries an owner scope", () => {
    // earTipAuthorityLevel drops owners, but not a vet: the vet is level 4
    // under authorityLevel whatever the scope, and stays so on the ear.
    const guardianClip = earTip("guardian", true, NEWER);
    const vetNo = earTip("vet", false, OLDER, { authorityScope: "owner_of_this_cat" });
    expect(resolveSterilised([guardianClip, vetNo]).confidence).toBe("unknown");
  });

  it("imports and owners have no standing on the ear; a colony scope on a non-guardian neither", () => {
    const clip = obs({ kind: "ear_tip", value: { clipped: true }, photoId: 1, deviceId: "spotter", accountId: null, observedAt: OLDER });
    for (const no of [
      earTip("import", false, NEWER),
      earTip("owner", false, NEWER),
      earTip("staff", false, NEWER, { authorityScope: "colony:7" }),
    ]) {
      expect(resolveSterilised([clip, no]).confidence).toBe("likely");
    }
  });
});

describe("appearanceAuthorityLevel: the carve-out for colour and markings", () => {
  it("vets, imported records and owners have no standing on appearance; the rest keep their level", () => {
    for (const who of ["vet", "import", "owner"] as const) {
      expect(appearanceAuthorityLevel(obs({ kind: "coat", value: null, ...WHO[who] }))).toBe(0);
    }
    expect(appearanceAuthorityLevel(obs({ kind: "coat", value: null, ...WHO.guardian }))).toBe(2);
    expect(appearanceAuthorityLevel(obs({ kind: "coat", value: null, ...WHO.staff }))).toBe(1);
    expect(appearanceAuthorityLevel(obs({ kind: "coat", value: null, ...WHO.management }))).toBe(1);
    expect(appearanceAuthorityLevel(obs({ kind: "coat", value: null, roleAtTime: "public" }))).toBe(0);
    expect(
      appearanceAuthorityLevel(obs({ kind: "coat", value: null, roleAtTime: "staff", authorityScope: "colony:7" })),
    ).toBe(0);
  });

  it("with the carve-out, a guardian's older colour beats the team's newer one, and a vet's counts for nothing", () => {
    const guardian = obs({ kind: "coat", value: { colours: ["ginger"] }, observedAt: OLDER, ...WHO.guardian });
    const team = obs({ kind: "coat", value: { colours: ["black"] }, observedAt: NEWER, ...WHO.staff });
    const vet = obs({ kind: "coat", value: { colours: ["grey"] }, observedAt: NEWER, ...WHO.vet });
    expect(highestAuthority([team, guardian, vet], appearanceAuthorityLevel)?.id).toBe(guardian.id);
    expect(highestAuthority([vet], appearanceAuthorityLevel)).toBeUndefined();
  });
});
