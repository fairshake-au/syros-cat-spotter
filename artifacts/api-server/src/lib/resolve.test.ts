import { describe, expect, it } from "vitest";
import type { Observation } from "@workspace/db/schema";
import {
  resolveSterilised,
  resolveLifeStatus,
  resolveCat,
  clippedTipCount,
  type EvidenceOfLife,
} from "./resolve";

/** Builds an EvidenceOfLife with a sensible default for the new field, so
 * every pre-existing test that only cares about `at`/`source` doesn't need
 * to spell out `lastSightingAt` too. Tests that exercise the clearing rule
 * pass `lastSightingAt` explicitly. */
function makeEvidence(e: {
  at: string;
  source: EvidenceOfLife["source"];
  lastSightingAt?: string | null;
}): EvidenceOfLife {
  return {
    at: new Date(e.at),
    source: e.source,
    lastSightingAt:
      e.lastSightingAt == null ? null : new Date(e.lastSightingAt),
  };
}

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

  it("superseded observations are ignored, whatever date they carry", () => {
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

  it(
    "a newer photo-backed clip doesn't move a confirmed negative, but is " +
      "surfaced to the team (J2)",
    () => {
      const neg = obs({
        kind: "sterilised",
        value: { sterilised: false },
        roleAtTime: "staff",
        accountId: "s",
        observedAt: new Date("2024-01-01"),
      });
      const olderClip = obs({
        kind: "ear_tip",
        value: { clipped: true },
        photoId: 1,
        observedAt: new Date("2023-01-01"), // older than the negative: not a conflict
      });
      const newerClip = obs({
        kind: "ear_tip",
        value: { clipped: true },
        photoId: 9,
        observedAt: new Date("2026-06-01"), // newer than the negative: a conflict
      });
      const resolved = resolveSterilised([neg, olderClip, newerClip]);
      expect(resolved.value).toBe(false);
      expect(resolved.confidence).toBe("confirmed");
      expect(resolved.conflicts).toEqual([newerClip.id]);
    },
  );

  it("vet and admin sterilised:false are confirmed negative (never dropped from authoritative)", () => {
    for (const roleAtTime of ["vet", "admin"] as const) {
      const resolved = resolveSterilised([
        obs({
          kind: "sterilised",
          value: { sterilised: false },
          roleAtTime,
          accountId: "x",
        }),
      ]);
      expect(resolved.value).toBe(false);
      expect(resolved.confidence).toBe("confirmed");
    }
  });

  it("vet and admin can also clear a wrong likely back to unknown", () => {
    for (const roleAtTime of ["vet", "admin"] as const) {
      const clip = obs({
        kind: "ear_tip",
        value: { clipped: true },
        photoId: 1,
        observedAt: new Date("2026-01-01"),
      });
      const correction = obs({
        kind: "ear_tip",
        value: { clipped: false },
        roleAtTime,
        accountId: "x",
        observedAt: new Date("2026-02-01"),
      });
      expect(resolveSterilised([clip, correction]).confidence).toBe("unknown");
    }
  });

  it("a system or guardian role sterilised assertion is NOT authoritative", () => {
    for (const roleAtTime of ["system", "guardian", "volunteer", "public"] as const) {
      const resolved = resolveSterilised([
        obs({ kind: "sterilised", value: { sterilised: false }, roleAtTime }),
      ]);
      expect(resolved.confidence).toBe("unknown");
    }
  });

  it("disagreeing authoritative statements surface the losing one in conflicts (S3)", () => {
    const older = obs({
      kind: "sterilised",
      value: { sterilised: true },
      roleAtTime: "staff",
      accountId: "s",
      observedAt: new Date("2024-01-01"),
    });
    const newer = obs({
      kind: "sterilised",
      value: { sterilised: false },
      roleAtTime: "staff",
      accountId: "s",
      observedAt: new Date("2026-01-01"),
    });
    expect(resolveSterilised([older, newer]).conflicts).toEqual([older.id]);
  });

  it(
    "an authoritative clipped:false at exactly the same instant as the " +
      "spotter's clip clears it too, with no explicit supersede link (M13 tie)",
    () => {
      const spotterClip = obs({
        kind: "ear_tip",
        value: { clipped: true },
        photoId: 9,
        observedAt: new Date("2026-02-01T00:00:00Z"),
      });
      const sameInstantCorrection = obs({
        kind: "ear_tip",
        value: { clipped: false },
        roleAtTime: "staff",
        accountId: "account-staff",
        observedAt: new Date("2026-02-01T00:00:00Z"),
      });
      const resolved = resolveSterilised([spotterClip, sameInstantCorrection]);
      expect(resolved.value).toBeNull();
      expect(resolved.confidence).toBe("unknown");
    },
  );

  it("likely's asOf is the newest surviving clip, not the first one in the array (M22)", () => {
    const earliest = obs({
      kind: "ear_tip",
      value: { clipped: true },
      photoId: 1,
      observedAt: new Date("2026-01-01"),
    });
    const newest = obs({
      kind: "ear_tip",
      value: { clipped: true },
      photoId: 2,
      observedAt: new Date("2026-06-01"),
    });
    const middle = obs({
      kind: "ear_tip",
      value: { clipped: true },
      photoId: 3,
      observedAt: new Date("2026-03-01"),
    });
    // Deliberately out of date order in the input array.
    const resolved = resolveSterilised([middle, newest, earliest]);
    expect(resolved.asOf).toBe("2026-06-01T00:00:00.000Z");
  });

});

describe("B1: deleting a person must not change a cat's derived status (§8.3, §8.5, §10.8.14)", () => {
  // §8.3/§8.5: redaction clears the identifying columns and stamps
  // redactedAt — it does NOT empty the value for anything but a `note`,
  // which never reaches this resolver. A redacted row with its value
  // intact must count exactly as it did before redaction.
  it("a redacted ear_tip observation with its value intact still counts (sterilised stays likely)", () => {
    const clip = obs({
      kind: "ear_tip",
      value: { clipped: true, side: "left" },
      photoId: 7,
      deviceId: null,
      accountId: null,
      redactedAt: new Date("2026-05-01"),
      redactionReason: "delete_me",
    });
    const resolved = resolveSterilised([clip]);
    expect(resolved.value).toBe(true);
    expect(resolved.confidence).toBe("likely");
    expect(clippedTipCount([clip])).toBe(1);
  });

  it("a redacted life_status observation with its value intact still counts (an owner deleting themselves does not unhome their cat)", () => {
    const homed = obs({
      kind: "life_status",
      value: { status: "homed" },
      authorityScope: "owner_of_this_cat",
      deviceId: null,
      accountId: null,
      redactedAt: new Date("2026-05-01"),
      redactionReason: "delete_me",
    });
    const resolved = resolveLifeStatus([homed], null, new Date("2026-06-01"));
    expect(resolved.value).toBe("homed");
  });

  it("a redacted observation whose value HAS been emptied (the note case) does not count", () => {
    // Hypothetical for this resolver's kinds (only `note` is actually
    // emptied by §8.3, and `note` never reaches resolveSterilised /
    // resolveLifeStatus) — proves the exclusion comes from failing to
    // parse the value, not from a redactedAt check.
    const emptiedClip = obs({
      kind: "ear_tip",
      value: {},
      photoId: 7,
      deviceId: null,
      accountId: null,
      redactedAt: new Date("2026-05-01"),
      redactionReason: "delete_me",
    });
    const resolved = resolveSterilised([emptiedClip]);
    expect(resolved.value).toBeNull();
    expect(resolved.confidence).toBe("unknown");
  });

  it(
    "a full resolveCat snapshot is unchanged by a deletion-shaped redaction " +
      "(identifying columns cleared, redactedAt set, value kept)",
    () => {
      const clip = obs({
        kind: "ear_tip",
        value: { clipped: true, side: "left" },
        photoId: 3,
        observedAt: new Date("2026-01-01"),
      });
      const homed = obs({
        kind: "life_status",
        value: { status: "homed" },
        authorityScope: "owner_of_this_cat",
        observedAt: new Date("2026-01-01"),
      });
      const before = resolveCat(
        [clip, homed],
        makeEvidence({ at: "2026-01-01T00:00:00Z", source: "sighting" }),
        new Date("2026-02-01"),
      );

      const redactedClip: Observation = {
        ...clip,
        deviceId: null,
        accountId: null,
        redactedAt: new Date("2026-03-01"),
        redactionReason: "delete_me",
      };
      const redactedHomed: Observation = {
        ...homed,
        deviceId: null,
        accountId: null,
        redactedAt: new Date("2026-03-01"),
        redactionReason: "delete_me",
      };
      const after = resolveCat(
        [redactedClip, redactedHomed],
        makeEvidence({ at: "2026-01-01T00:00:00Z", source: "sighting" }),
        new Date("2026-02-01"),
      );

      expect(after.sterilised.value).toBe(before.sterilised.value);
      expect(after.sterilised.confidence).toBe(before.sterilised.confidence);
      expect(after.sterilised.clippedTipSightings).toBe(before.sterilised.clippedTipSightings);
      expect(after.lifeStatus).toBe(before.lifeStatus);
      expect(after.lifeStatus).toBe("homed");
      expect(after.sterilised.confidence).toBe("likely");
    },
  );
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
      "returning street, with the disagreement in conflicts, and stays " +
      "confirmed (S2: Samuel decided — a cleared death is not a weaker claim)",
    () => {
      const deceased = obs({
        kind: "life_status",
        value: { status: "deceased" },
        roleAtTime: "staff",
        accountId: "account-1",
        observedAt: new Date("2026-01-01"),
      });
      const resolved = resolveLifeStatus(
        [deceased],
        makeEvidence({
          at: "2026-02-01T00:00:00Z",
          source: "sighting",
          lastSightingAt: "2026-02-01T00:00:00Z",
        }),
        new Date("2026-02-02"),
      );
      expect(resolved.value).toBe("street");
      expect(resolved.conflicts).toEqual([deceased.id]);
      expect(resolved.confidence).toBe("confirmed");
      // Flagged, not fixed here: EvidenceOfLife carries only a date, no
      // observation/sighting id, so the clearing sighting itself can't be
      // added to supportingObservationIds yet — PR 2 would need to widen
      // the contract again to close this. See the PR body.
      expect(resolved.supportingObservationIds).toEqual([]);
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
    const resolved = resolveLifeStatus(
      [deceased],
      makeEvidence({
        at: "2026-01-01T00:00:00Z",
        source: "sighting",
        lastSightingAt: "2026-01-01T00:00:00Z",
      }),
      new Date("2026-02-02"),
    );
    expect(resolved.value).toBe("deceased");
    expect(resolved.conflicts).toEqual([]);
  });

  it(
    "a sighting at exactly the deceased statement's time does NOT clear it " +
      "(strictly greater, not greater-or-equal — kills M15)",
    () => {
      const deceased = obs({
        kind: "life_status",
        value: { status: "deceased" },
        roleAtTime: "staff",
        accountId: "account-1",
        observedAt: new Date("2026-01-01T00:00:00Z"),
      });
      const resolved = resolveLifeStatus(
        [deceased],
        makeEvidence({
          at: "2026-01-01T00:00:00Z",
          source: "sighting",
          lastSightingAt: "2026-01-01T00:00:00Z",
        }),
        new Date("2026-02-02"),
      );
      expect(resolved.value).toBe("deceased");
    },
  );

  it(
    "B2: a welfare report dated after a clearing sighting must not hide " +
      "that sighting — the resolver checks lastSightingAt, not the overall " +
      "newest evidence's source (kills M5)",
    () => {
      const deceased = obs({
        kind: "life_status",
        value: { status: "deceased" },
        roleAtTime: "staff",
        accountId: "s1",
        observedAt: new Date("2026-01-01T00:00:00Z"),
      });
      // The newest evidence of life overall is the welfare report (1 Mar),
      // but there was also a sighting on 1 Feb — after the death, so it
      // must still clear it.
      const resolved = resolveLifeStatus(
        [deceased],
        makeEvidence({
          at: "2026-03-01T00:00:00Z",
          source: "welfare_report",
          lastSightingAt: "2026-02-01T00:00:00Z",
        }),
        new Date("2026-03-02"),
      );
      expect(resolved.value).toBe("street");
    },
  );

  it(
    "P5: non-sighting evidence after a deceased statement leaves it " +
      "deceased — only a sighting clears it (surviving mutant)",
    () => {
      const deceased = obs({
        kind: "life_status",
        value: { status: "deceased" },
        roleAtTime: "staff",
        accountId: "s1",
        observedAt: new Date("2026-01-01"),
      });
      const resolved = resolveLifeStatus(
        [deceased],
        makeEvidence({ at: "2026-02-01T00:00:00Z", source: "sterilised", lastSightingAt: null }),
        new Date("2026-03-01"),
      );
      expect(resolved.value).toBe("deceased");
    },
  );

  it("a cat created today with no sightings is not presumed deceased", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    const evidence = makeEvidence({ at: now.toISOString(), source: "created" });
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
    const evidence = makeEvidence({ at: takenAt.toISOString(), source: "sighting" });
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
      resolveLifeStatus([], makeEvidence({ at: old.toISOString(), source: "created" }), now)
        .presumedDeceased,
    ).toBe(true);

    // Each qualifying kind resets it when recent. A non-deceased life_status
    // is handled by the resolver itself (test below); the rest arrive via
    // evidenceOfLife, however PR 2's loader labels them.
    for (const source of ["sighting", "sterilised", "ear_tip", "welfare_report"] as const) {
      const resolved = resolveLifeStatus(
        [],
        makeEvidence({ at: recent.toISOString(), source }),
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
      resolveLifeStatus(
        [recentLifeStatus],
        makeEvidence({ at: old.toISOString(), source: "created" }),
        now,
      ).presumedDeceased,
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
        makeEvidence({ at: old.toISOString(), source: "created" }),
        now,
      );
      expect(resolved.presumedDeceased).toBe(true);
    }
  });

  describe("S1: the 36-month presumed-deceased boundary", () => {
    const at = "2023-10-02T00:00:00.000Z";

    it("exactly 36 months is not 'more than 36 months'", () => {
      const now = new Date("2026-10-02T00:00:00.000Z");
      expect(
        resolveLifeStatus([], makeEvidence({ at, source: "sighting" }), now).presumedDeceased,
      ).toBe(false);
    });

    it("one millisecond past 36 months is presumed", () => {
      const now = new Date("2026-10-02T00:00:00.001Z");
      expect(
        resolveLifeStatus([], makeEvidence({ at, source: "sighting" }), now).presumedDeceased,
      ).toBe(true);
    });

    it("35 months and 30 days is not presumed", () => {
      const now = new Date("2026-09-30T00:00:00Z");
      expect(
        resolveLifeStatus([], makeEvidence({ at, source: "sighting" }), now).presumedDeceased,
      ).toBe(false);
    });

    it("leap day: 29 Feb 2024 + 36 months rolls over to 1 Mar 2027, not 28/29 Feb", () => {
      const leapAt = "2024-02-29T00:00:00Z";
      const justBefore = resolveLifeStatus(
        [],
        makeEvidence({ at: leapAt, source: "sighting" }),
        new Date("2027-02-28T23:59:59Z"),
      );
      const justAfter = resolveLifeStatus(
        [],
        makeEvidence({ at: leapAt, source: "sighting" }),
        new Date("2027-03-01T00:00:01Z"),
      );
      expect(justBefore.presumedDeceased).toBe(false);
      expect(justAfter.presumedDeceased).toBe(true);
    });

    it(
      "the threshold is computed in UTC months, not the runner's local " +
        "calendar (kills M10's setMonth/setUTCMonth swap)",
      () => {
        // A date-plus-time whose UTC and local month roll over on different
        // days exposes a local-time addMonths immediately, in any TZ.
        const evidenceAt = "2023-10-31T22:30:00Z";
        const now = new Date("2026-10-31T22:30:01Z"); // 1 ms after the UTC threshold
        const resolved = resolveLifeStatus(
          [],
          makeEvidence({ at: evidenceAt, source: "sighting" }),
          now,
        );
        expect(resolved.presumedDeceased).toBe(true);
      },
    );
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
    const resolved = resolveLifeStatus(
      [deceased],
      makeEvidence({ at: old.toISOString(), source: "created" }),
      now,
    );
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
      makeEvidence({ at: old.toISOString(), source: "sighting" }),
      now,
    );
    expect(resolved.presumedDeceased).toBe(false);
  });

  it("superseded observations are ignored, whatever date they carry (life status)", () => {
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
    const resolved = resolveLifeStatus([superseded, supersedes], null, new Date("2026-09-01"));
    expect(resolved.value).toBe("street");
  });

  it(
    "a tie in observedAt between two life_status writes breaks by the " +
      "higher id, the later write (kills M14)",
    () => {
      const sameInstant = new Date("2026-01-01T00:00:00Z");
      const first = obs({
        kind: "life_status",
        value: { status: "homed" },
        roleAtTime: "staff",
        accountId: "a",
        observedAt: sameInstant,
      });
      const second = obs({
        kind: "life_status",
        value: { status: "deceased" },
        roleAtTime: "staff",
        accountId: "a",
        observedAt: sameInstant,
      });
      // second.id > first.id (nextId increments), so it is treated as the
      // later write and wins the tie.
      const resolved = resolveLifeStatus([first, second], null, new Date("2026-02-01"));
      expect(resolved.value).toBe("deceased");
    },
  );

  it("a live life_status resolves confirmed (S3, kills M8)", () => {
    const h = obs({
      kind: "life_status",
      value: { status: "in_care" },
      roleAtTime: "staff",
      accountId: "s",
      observedAt: new Date("2026-01-01"),
    });
    expect(resolveLifeStatus([h], null, new Date("2026-02-01")).confidence).toBe("confirmed");
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
      makeEvidence({ at: "2026-09-01T00:00:00Z", source: "sighting" }),
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

  it("is pure: the same input twice gives identical output", () => {
    const observations = [
      obs({ kind: "ear_tip", value: { clipped: true }, photoId: 1 }),
    ];
    const evidence = makeEvidence({ at: "2026-01-01T00:00:00Z", source: "sighting" });
    const now = new Date("2026-02-01");
    expect(resolveCat(observations, evidence, now)).toEqual(
      resolveCat(observations, evidence, now),
    );
  });
});
