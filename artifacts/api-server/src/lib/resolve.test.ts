import { describe, expect, it } from "vitest";
import type { Observation } from "@workspace/db/schema";
import {
  resolveSterilised,
  resolveLifeStatus,
  resolveCat,
  clippedTipCount,
  type EvidenceOfLife,
} from "./resolve";

// Every test below is named for the rule it pins, matching
// docs/superpowers/plans/data-spine.md's PR 1 test list (§10.2, §10.8 of
// docs/specs/cat-record-data-spine.md). This file carries the hard tests —
// the resolver is where a wrong confidence level looks exactly like a right
// one, and every later PR trusts this logic.

let nextId = 1;

function obs(
  overrides: Partial<Observation> & { kind: string; value: unknown },
): Observation {
  const id = overrides.id ?? nextId++;
  const observedAt = overrides.observedAt ?? new Date("2026-01-01T00:00:00Z");
  const authorGiven =
    overrides.deviceId !== undefined || overrides.accountId !== undefined;
  return {
    id,
    catId: overrides.catId ?? 1,
    kind: overrides.kind,
    value: overrides.value,
    deviceId: authorGiven ? overrides.deviceId ?? null : "device-1",
    accountId: authorGiven ? overrides.accountId ?? null : null,
    roleAtTime: overrides.roleAtTime ?? "public",
    authorityScope: overrides.authorityScope ?? "none",
    provenance: overrides.provenance ?? "volunteered",
    suggestedValue: overrides.suggestedValue ?? null,
    suggestionSource: overrides.suggestionSource ?? null,
    sightingId: overrides.sightingId ?? null,
    photoId: overrides.photoId ?? null,
    importRecordId: overrides.importRecordId ?? null,
    observedAt,
    createdAt: overrides.createdAt ?? observedAt,
    supersedesId: overrides.supersedesId ?? null,
    supersedeReason: overrides.supersedeReason ?? null,
    redactedAt: overrides.redactedAt ?? null,
    redactionReason: overrides.redactionReason ?? null,
  } as Observation;
}

describe("resolveSterilised", () => {
  it(
    'ear-tip asymmetry: no number, authority or recency of spotter "looks whole" ' +
      'or "can\'t tell" answers moves sterilised',
    () => {
      // §4.1: absence of a visible clip is never negative evidence, however
      // many times, however recently, and whoever has an authority scope
      // over the cat (an owner is still not vet/staff/admin). The cost of
      // getting this wrong: a volunteer sent to trap a cat sterilised years
      // ago.
      const spotterNos = [
        obs({ kind: "ear_tip", value: { clipped: false }, observedAt: new Date("2020-01-01") }),
        obs({
          kind: "ear_tip",
          value: { clipped: "cant_tell" },
          observedAt: new Date("2026-09-01"), // more recent than everything else
        }),
        obs({
          kind: "ear_tip",
          value: { clipped: false },
          authorityScope: "owner_of_this_cat", // claimed owner, still role "public"
          observedAt: new Date("2026-09-15"),
        }),
      ];

      // On their own: still unknown, not a negative.
      const onlyNos = resolveSterilised(spotterNos);
      expect(onlyNos.value).toBeNull();
      expect(onlyNos.confidence).toBe("unknown");

      // Alongside a genuine clipped-tip sighting, they don't knock it back
      // down from likely either.
      const clippedTrue = obs({
        kind: "ear_tip",
        value: { clipped: true, side: "left" },
        photoId: 10,
        observedAt: new Date("2025-01-01"),
      });
      const withNos = resolveSterilised([clippedTrue, ...spotterNos]);
      expect(withNos.value).toBe(true);
      expect(withNos.confidence).toBe("likely");
    },
  );

  it("a clipped tip reaches likely and never confirmed, whoever wrote it", () => {
    for (const roleAtTime of ["public", "staff", "vet", "admin"] as const) {
      const resolved = resolveSterilised([
        obs({
          kind: "ear_tip",
          value: { clipped: true, side: "left" },
          photoId: 5,
          roleAtTime,
        }),
      ]);
      expect(resolved.value).toBe(true);
      expect(resolved.confidence).toBe("likely");
    }
  });

  it("confidence never crosses attributes: no quantity or authority of ear_tip reaches confirmed", () => {
    const manyClippedTips = Array.from({ length: 10 }, (_, i) =>
      obs({
        kind: "ear_tip",
        value: { clipped: true, side: "left" },
        photoId: i + 1,
        roleAtTime: i % 2 === 0 ? "staff" : "vet",
        accountId: `account-${i}`,
        observedAt: new Date(2020 + i, 0, 1),
      }),
    );
    const resolved = resolveSterilised(manyClippedTips);
    expect(resolved.value).toBe(true);
    expect(resolved.confidence).toBe("likely");
  });

  it("authoritative precedence, both directions", () => {
    // Import true (2024) then staff false (2026) → confirmed negative.
    const caseA = resolveSterilised([
      obs({
        kind: "sterilised",
        value: { sterilised: true },
        provenance: "import",
        accountId: "system:legacy-backfill",
        observedAt: new Date("2024-01-01"),
      }),
      obs({
        kind: "sterilised",
        value: { sterilised: false },
        roleAtTime: "staff",
        accountId: "account-1",
        observedAt: new Date("2026-06-01"),
      }),
    ]);
    expect(caseA.value).toBe(false);
    expect(caseA.confidence).toBe("confirmed");

    // The same two statements, dates swapped → confirmed positive.
    const caseB = resolveSterilised([
      obs({
        kind: "sterilised",
        value: { sterilised: true },
        provenance: "import",
        accountId: "system:legacy-backfill",
        observedAt: new Date("2026-06-01"),
      }),
      obs({
        kind: "sterilised",
        value: { sterilised: false },
        roleAtTime: "staff",
        accountId: "account-1",
        observedAt: new Date("2024-01-01"),
      }),
    ]);
    expect(caseB.value).toBe(true);
    expect(caseB.confidence).toBe("confirmed");
  });

  it("likely needs a photo: a clipped: true with no photoId stays unknown", () => {
    const resolved = resolveSterilised([
      obs({
        kind: "ear_tip",
        value: { clipped: true, side: "left" },
        photoId: null,
      }),
    ]);
    expect(resolved.value).toBeNull();
    expect(resolved.confidence).toBe("unknown");
  });

  it('a team "that\'s not a clip" returns likely to unknown, never to a negative', () => {
    const spotterClip = obs({
      kind: "ear_tip",
      value: { clipped: true, side: "left" },
      photoId: 9,
      observedAt: new Date("2026-01-01"),
    });
    const staffCorrection = obs({
      kind: "ear_tip",
      value: { clipped: false },
      roleAtTime: "staff",
      accountId: "account-staff",
      supersedesId: spotterClip.id,
      observedAt: new Date("2026-02-01"),
    });
    const resolved = resolveSterilised([spotterClip, staffCorrection]);
    expect(resolved.value).toBeNull();
    expect(resolved.confidence).toBe("unknown");
  });

  it("a staff clipped:false postdating a spotter's clip also clears it, with no explicit supersede link", () => {
    const spotterClip = obs({
      kind: "ear_tip",
      value: { clipped: true, side: "left" },
      photoId: 9,
      observedAt: new Date("2026-01-01"),
    });
    const staffLater = obs({
      kind: "ear_tip",
      value: { clipped: false },
      roleAtTime: "staff",
      accountId: "account-staff",
      observedAt: new Date("2026-03-01"), // later, but no supersedesId
    });
    const resolved = resolveSterilised([spotterClip, staffLater]);
    expect(resolved.value).toBeNull();
    expect(resolved.confidence).toBe("unknown");
  });

  it("superseded and redacted-value observations are ignored (sterilised)", () => {
    // A redacted correction is ignored outright, so the original it would
    // have corrected still resolves.
    const originalTrue = obs({
      kind: "sterilised",
      value: { sterilised: true },
      roleAtTime: "staff",
      accountId: "a1",
      observedAt: new Date("2025-01-01"),
    });
    const redactedCorrection = obs({
      kind: "sterilised",
      value: { sterilised: false },
      roleAtTime: "staff",
      accountId: "a1",
      observedAt: new Date("2026-01-01"),
      redactedAt: new Date("2026-02-01"),
    });
    expect(resolveSterilised([originalTrue, redactedCorrection]).value).toBe(true);

    // A superseded observation is excluded even though it's dated later
    // than the one superseding it.
    const superseded = obs({
      kind: "sterilised",
      value: { sterilised: true },
      roleAtTime: "staff",
      accountId: "a1",
      observedAt: new Date("2024-01-01"),
    });
    const supersedingButOlderDate = obs({
      kind: "sterilised",
      value: { sterilised: false },
      roleAtTime: "staff",
      accountId: "a1",
      observedAt: new Date("2023-01-01"),
      supersedesId: superseded.id,
    });
    const resolved = resolveSterilised([superseded, supersedingButOlderDate]);
    expect(resolved.value).toBe(false);
    expect(resolved.confidence).toBe("confirmed");
  });

  it("welfare reports and outcomes move no derived status (the resolver half)", () => {
    const welfareReport = obs({
      kind: "welfare_report",
      value: { severity: "urgent", isLitter: false, reportId: 1 },
      observedAt: new Date("2026-09-01"),
    });
    const welfareOutcome = obs({
      kind: "welfare_outcome",
      value: { state: "done", reportId: 1 },
      roleAtTime: "staff",
      accountId: "a1",
      observedAt: new Date("2026-09-02"),
    });
    const resolved = resolveSterilised([welfareReport, welfareOutcome]);
    expect(resolved.value).toBeNull();
    expect(resolved.confidence).toBe("unknown");
  });

  it("no observations resolves to unknown (sterilised half of step 2)", () => {
    const resolved = resolveSterilised([]);
    expect(resolved.value).toBeNull();
    expect(resolved.confidence).toBe("unknown");
  });
});

describe("clippedTipCount", () => {
  it("counts active, photo-backed clipped-tip observations only", () => {
    const counted = obs({
      kind: "ear_tip",
      value: { clipped: true },
      photoId: 1,
      observedAt: new Date("2026-01-01"),
    });
    const noPhoto = obs({
      kind: "ear_tip",
      value: { clipped: true },
      photoId: null,
      observedAt: new Date("2026-01-02"),
    });
    const notClipped = obs({
      kind: "ear_tip",
      value: { clipped: false },
      observedAt: new Date("2026-01-03"),
    });
    const superseded = obs({
      kind: "ear_tip",
      value: { clipped: true },
      photoId: 2,
      observedAt: new Date("2026-01-04"),
    });
    const supersedes = obs({
      kind: "ear_tip",
      value: { clipped: false },
      roleAtTime: "staff",
      accountId: "a1",
      supersedesId: superseded.id,
      observedAt: new Date("2026-01-05"),
    });
    expect(
      clippedTipCount([counted, noPhoto, notClipped, superseded, supersedes]),
    ).toBe(1);
  });
});

describe("resolveLifeStatus", () => {
  it(
    "a sighting after a deceased statement clears it in the same read, " +
      "returning street, with the disagreement in conflicts",
    () => {
      const deceased = obs({
        kind: "life_status",
        value: { status: "deceased" },
        roleAtTime: "staff",
        accountId: "account-1",
        observedAt: new Date("2026-01-01"),
      });
      const evidence: EvidenceOfLife = { at: "2026-02-01T00:00:00Z", source: "sighting" };
      const resolved = resolveLifeStatus([deceased], evidence, new Date("2026-02-02"));
      expect(resolved.value).toBe("street");
      expect(resolved.conflicts).toEqual([deceased.id]);
    },
  );

  it("a sighting BEFORE a deceased statement does not clear it", () => {
    const deceased = obs({
      kind: "life_status",
      value: { status: "deceased" },
      roleAtTime: "staff",
      accountId: "account-1",
      observedAt: new Date("2026-02-01"),
    });
    const evidence: EvidenceOfLife = { at: "2026-01-01T00:00:00Z", source: "sighting" };
    const resolved = resolveLifeStatus([deceased], evidence, new Date("2026-02-02"));
    expect(resolved.value).toBe("deceased");
    expect(resolved.conflicts).toEqual([]);
  });

  it("a cat created today with no sightings is not presumed deceased", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    const evidence: EvidenceOfLife = { at: now.toISOString(), source: "created" };
    const resolved = resolveLifeStatus([], evidence, now);
    expect(resolved.value).toBe("street");
    expect(resolved.presumedDeceased).toBe(false);
  });

  it("presumed deceased counts from when the photo was taken, not when it synced", () => {
    // Taken 37 months before "now"; a late offline sync must not make it
    // look recent. PR 2's loader computes evidenceOfLife.at from the
    // sighting's capture time, never its createdAt — this resolver only
    // ever sees the one date it's given, and trusts it.
    const takenAt = new Date("2023-09-01T00:00:00Z");
    const now = new Date("2026-10-02T00:00:00Z");
    const evidence: EvidenceOfLife = { at: takenAt.toISOString(), source: "sighting" };
    const resolved = resolveLifeStatus([], evidence, now);
    expect(resolved.presumedDeceased).toBe(true);
    expect(resolved.notSeenSince).toBe(takenAt.toISOString());
  });

  it("presumed deceased after 36 months of silence, and each kind of evidence of life resets it", () => {
    const now = new Date("2026-10-02T00:00:00Z");
    const old = new Date("2023-01-01T00:00:00Z"); // > 36 months before now
    const recent = new Date("2026-09-01T00:00:00Z"); // < 36 months before now

    // Silence: nothing recent → presumed deceased.
    expect(
      resolveLifeStatus([], { at: old.toISOString(), source: "created" }, now).presumedDeceased,
    ).toBe(true);

    // Each qualifying kind resets it when recent. A non-deceased life_status
    // is handled by the resolver itself (test below); the rest arrive via
    // evidenceOfLife, however PR 2's loader labels them.
    for (const source of ["sighting", "sterilised", "ear_tip", "welfare_report"]) {
      const resolved = resolveLifeStatus(
        [],
        { at: recent.toISOString(), source },
        now,
      );
      expect(resolved.presumedDeceased).toBe(false);
    }
    const recentLifeStatus = obs({
      kind: "life_status",
      value: { status: "homed" },
      observedAt: recent,
    });
    expect(
      resolveLifeStatus([recentLifeStatus], { at: old.toISOString(), source: "created" }, now)
        .presumedDeceased,
    ).toBe(false);

    // colony, note, name, food_and_water and coat are never evidence of
    // life (§3.4) — a correct loader never promotes one of these into
    // evidenceOfLife, so a recent one changes nothing here: the resolver
    // has no special case for them at all, and the only genuine evidence
    // (the "created" fallback) is still old.
    for (const kind of ["colony", "note", "name", "food_and_water", "coat"]) {
      const recentOther = obs({
        kind,
        value: kind === "colony" ? { colonyId: 1 } : { text: "x" },
        observedAt: recent,
      });
      const resolved = resolveLifeStatus(
        [recentOther],
        { at: old.toISOString(), source: "created" },
        now,
      );
      expect(resolved.presumedDeceased).toBe(true);
    }
  });

  it("a live deceased statement suppresses presumed deceased", () => {
    const now = new Date("2026-10-02T00:00:00Z");
    const old = new Date("2020-01-01T00:00:00Z");
    const deceased = obs({
      kind: "life_status",
      value: { status: "deceased" },
      roleAtTime: "staff",
      accountId: "account-1",
      observedAt: new Date("2026-09-01"),
    });
    const resolved = resolveLifeStatus([deceased], { at: old.toISOString(), source: "created" }, now);
    expect(resolved.value).toBe("deceased");
    expect(resolved.presumedDeceased).toBe(false);
  });

  it("a life_status newer than the last evidence of life suppresses it", () => {
    const now = new Date("2026-10-02T00:00:00Z");
    const old = new Date("2020-01-01T00:00:00Z"); // stale evidenceOfLife
    const recentHomed = obs({
      kind: "life_status",
      value: { status: "homed" },
      observedAt: new Date("2026-09-01"),
    });
    const resolved = resolveLifeStatus(
      [recentHomed],
      { at: old.toISOString(), source: "sighting" },
      now,
    );
    expect(resolved.presumedDeceased).toBe(false);
  });

  it("superseded and redacted-value observations are ignored (life status)", () => {
    const superseded = obs({
      kind: "life_status",
      value: { status: "deceased" },
      roleAtTime: "staff",
      accountId: "a1",
      observedAt: new Date("2026-05-01"),
    });
    const supersedes = obs({
      kind: "life_status",
      value: { status: "street" },
      roleAtTime: "staff",
      accountId: "a1",
      supersedesId: superseded.id,
      observedAt: new Date("2026-06-01"),
    });
    const redactedLater = obs({
      kind: "life_status",
      value: { status: "deceased" },
      roleAtTime: "staff",
      accountId: "a1",
      observedAt: new Date("2026-07-01"),
      redactedAt: new Date("2026-08-01"),
    });
    const resolved = resolveLifeStatus(
      [superseded, supersedes, redactedLater],
      null,
      new Date("2026-09-01"),
    );
    expect(resolved.value).toBe("street");
  });

  it("welfare reports and outcomes move no derived status (the resolver half)", () => {
    const welfareReport = obs({
      kind: "welfare_report",
      value: { severity: "urgent", isLitter: false, reportId: 1 },
      observedAt: new Date("2026-09-01"),
    });
    const welfareOutcome = obs({
      kind: "welfare_outcome",
      value: { state: "done", reportId: 1 },
      roleAtTime: "staff",
      accountId: "a1",
      observedAt: new Date("2026-09-02"),
    });
    const resolved = resolveLifeStatus(
      [welfareReport, welfareOutcome],
      null,
      new Date("2026-10-01"),
    );
    expect(resolved.value).toBe("street");
    expect(resolved.confidence).toBe("unknown");
  });

  it("no observations resolves to street and unknown (step 2)", () => {
    const resolved = resolveLifeStatus([], null, new Date("2026-10-01"));
    expect(resolved.value).toBe("street");
    expect(resolved.confidence).toBe("unknown");
    expect(resolved.presumedDeceased).toBe(false);
  });
});

describe("resolveCat", () => {
  it("combines both resolvers into one snapshot", () => {
    const homed = obs({
      kind: "life_status",
      value: { status: "homed" },
      authorityScope: "owner_of_this_cat",
      observedAt: new Date("2026-01-01"),
    });
    const clip = obs({
      kind: "ear_tip",
      value: { clipped: true, side: "left" },
      photoId: 3,
      observedAt: new Date("2026-01-01"),
    });
    const snapshot = resolveCat(
      [homed, clip],
      { at: "2026-09-01T00:00:00Z", source: "sighting" },
      new Date("2026-10-01"),
    );
    expect(snapshot.lifeStatus).toBe("homed");
    expect(snapshot.presumedDeceased).toBe(false);
    expect(snapshot.sterilised).toEqual({
      value: true,
      confidence: "likely",
      asOf: "2026-01-01T00:00:00.000Z",
      clippedTipSightings: 1,
    });
  });
});
