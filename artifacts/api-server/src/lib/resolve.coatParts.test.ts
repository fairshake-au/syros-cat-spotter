import { describe, expect, it } from "vitest";
import type { Observation } from "@workspace/db/schema";
import { resolveCat, resolveCoatParts } from "./resolve";
import { coloursWithParity } from "./__fixtures__/coatParity";
import { resolveCoatV1 } from "./__fixtures__/resolveCoatV1";

// SYC-398 A1.3: who wins, per part (coat-colours-and-pattern.md §4). The
// colours and the pattern are each resolved on their own by SYC-2's rule
// engine, over the standing statements projected onto that part. Tests 1–15
// are the plan's, in its order. The pre-SYC-398 colour cases live on in
// resolve.appearance.test.ts, each checked for parity (test 15).

let nextId = 5000;

function obs(overrides: Partial<Observation> & { kind: string; value: unknown }): Observation {
  const observedAt = overrides.observedAt ?? new Date("2026-01-01T12:00:00Z");
  const authorGiven = overrides.deviceId !== undefined || overrides.accountId !== undefined;
  return {
    id: overrides.id ?? nextId++,
    catId: 1,
    kind: overrides.kind,
    value: overrides.value,
    deviceId: authorGiven ? (overrides.deviceId ?? null) : "d1",
    accountId: authorGiven ? (overrides.accountId ?? null) : null,
    roleAtTime: overrides.roleAtTime ?? "public",
    authorityScope: overrides.authorityScope ?? "none",
    provenance: overrides.provenance ?? "volunteered",
    suggestedValue: null,
    suggestionSource: null,
    sightingId: null,
    photoId: overrides.photoId ?? null,
    importRecordId: null,
    observedAt,
    createdAt: overrides.createdAt ?? observedAt,
    supersedesId: overrides.supersedesId ?? null,
    supersedeReason: null,
    redactedAt: overrides.redactedAt ?? null,
    redactionReason: null,
  } as Observation;
}

let nextPhoto = 9000;
/** A spotter's coat answer, on its own photo. */
function spotter(device: string, value: unknown, day: string, extra: Partial<Observation> = {}): Observation {
  return obs({ kind: "coat", value, deviceId: device, photoId: nextPhoto++, observedAt: new Date(day), ...extra });
}

/** A team statement (staff), with no photo. */
function team(value: unknown, day: string, extra: Partial<Observation> = {}): Observation {
  return obs({
    kind: "coat",
    value,
    deviceId: null,
    accountId: extra.accountId ?? "person:staff-1",
    roleAtTime: "staff",
    observedAt: new Date(day),
    ...extra,
  });
}

function machine(value: Record<string, unknown>, day: string): Observation {
  return obs({
    kind: "coat",
    value: { modelVersion: "vision-2", ...value },
    deviceId: null,
    accountId: "system:vision",
    roleAtTime: "system",
    provenance: "machine",
    observedAt: new Date(day),
  });
}

describe("resolveCoatParts: who wins, per part (plan A1.3)", () => {
  it("1 team colours and a machine pattern: rule 1 colours, rule 3 pattern, mixed_sources on both", () => {
    const t = team({ colours: ["ginger"] }, "2026-01-01T09:00:00Z");
    const m = machine({ colours: ["brown"], pattern: "stripes" }, "2026-01-02T09:00:00Z");
    const r = resolveCoatParts([t, m]);
    expect(r.colours).toMatchObject({ value: ["ginger"], confidence: "confirmed", rule: 1, supportingObservationIds: [t.id] });
    expect(r.pattern).toMatchObject({ value: "stripes", confidence: "reported", rule: 3, supportingObservationIds: [m.id] });
    expect(r.colours.checkReasons).toContain("mixed_sources");
    expect(r.pattern.checkReasons).toContain("mixed_sources");
  });

  it("2 team colours and two spotters' pattern: mixed_sources is rule 1 against rule 2, not only machine against people", () => {
    const r = resolveCoatParts([
      team({ colours: ["ginger"] }, "2026-01-01T09:00:00Z"),
      spotter("a", { colours: ["ginger"], pattern: "stripes" }, "2026-01-02T10:00:00Z"),
      spotter("b", { colours: ["ginger"], pattern: "stripes" }, "2026-01-03T10:00:00Z"),
    ]);
    expect(r.colours).toMatchObject({ value: ["ginger"], rule: 1 });
    expect(r.pattern).toMatchObject({ value: "stripes", confidence: "likely", rule: 2 });
    expect(r.colours.checkReasons).toEqual(["mixed_sources"]);
    expect(r.pattern.checkReasons).toEqual(["mixed_sources"]);
  });

  it("3 a team pattern alone: the colours fall through to the machine", () => {
    const r = resolveCoatParts([
      machine({ colours: ["grey"], pattern: "stripes" }, "2026-01-01T09:00:00Z"),
      team({ pattern: "plain" }, "2026-01-02T09:00:00Z"),
    ]);
    expect(r.pattern).toMatchObject({ value: "plain", confidence: "confirmed", rule: 1 });
    expect(r.colours).toMatchObject({ value: ["grey"], confidence: "reported", rule: 3 });
  });

  it("4 two independent spotters agree on both parts: likely, rule 2, no mixed_sources", () => {
    const r = resolveCoatParts([
      spotter("a", { colours: ["brown", "ginger"], pattern: "stripes" }, "2026-01-01T10:00:00Z"),
      spotter("b", { colours: ["ginger", "brown"], pattern: "stripes" }, "2026-01-02T10:00:00Z"),
    ]);
    expect(r.colours).toMatchObject({ value: ["brown", "ginger"], confidence: "likely", rule: 2, checkReasons: [] });
    expect(r.pattern).toMatchObject({ value: "stripes", confidence: "likely", rule: 2, checkReasons: [] });
  });

  it("5 all five colours held by two voices are all shown, in display order", () => {
    const all = ["white", "ginger", "brown", "grey", "black"];
    const r = resolveCoatParts([
      spotter("a", { colours: all }, "2026-01-01T10:00:00Z"),
      spotter("b", { colours: all }, "2026-01-02T10:00:00Z"),
    ]);
    expect(r.colours.value).toEqual(["black", "grey", "brown", "ginger", "white"]);
    expect(r.colours.confidence).toBe("likely");
  });

  it("6 two voices for stripes and two for patches, never together: the newer shown, pattern_tied_camps", () => {
    const r = resolveCoatParts([
      spotter("a", { colours: ["ginger"], pattern: "stripes" }, "2026-01-01T10:00:00Z"),
      spotter("b", { colours: ["ginger"], pattern: "stripes" }, "2026-01-02T10:00:00Z"),
      spotter("c", { colours: ["ginger"], pattern: "patches" }, "2026-01-03T10:00:00Z"),
      spotter("d", { colours: ["ginger"], pattern: "patches" }, "2026-01-04T10:00:00Z"),
    ]);
    expect(r.pattern).toMatchObject({ value: "patches", confidence: "likely", rule: 2 });
    expect(r.pattern.checkReasons).toContain("pattern_tied_camps");
    expect(r.pattern.checkReasons).not.toContain("tied_camps");
    expect(r.colours.checkReasons).not.toContain("tied_camps");
  });

  it("7 the newest machine row alone counts: its missing pattern is not known, never the older row's", () => {
    const r = resolveCoatParts([
      machine({ colours: ["ginger"], pattern: "stripes", modelVersion: "vision-1" }, "2026-01-01T09:00:00Z"),
      machine({ colours: ["ginger"] }, "2026-01-05T09:00:00Z"),
    ]);
    expect(r.colours).toMatchObject({ value: ["ginger"], rule: 3 });
    expect(r.pattern).toMatchObject({ value: null, confidence: "unknown", rule: 5 });

    // The same with the older row in the stored v1 shape.
    const old = resolveCoatParts([
      machine({ colours: ["ginger", "tabby"], modelVersion: "vision-1" }, "2026-01-01T09:00:00Z"),
      machine({ colours: ["ginger"] }, "2026-01-05T09:00:00Z"),
    ]);
    expect(old.pattern.value).toBeNull();
  });

  it("8 a spotter's old Tabby row (pattern only) doesn't withdraw that device's earlier colours", () => {
    const r = resolveCoatParts([
      spotter("a", { colours: ["ginger"] }, "2026-01-01T10:00:00Z"),
      spotter("b", { colours: ["ginger"] }, "2026-01-02T10:00:00Z"),
      spotter("a", { colours: ["tabby"] }, "2026-01-03T10:00:00Z"),
    ]);
    expect(r.colours).toMatchObject({ value: ["ginger"], confidence: "likely", rule: 2 });
    expect(r.pattern).toMatchObject({ value: "stripes", rule: 4 });
  });

  it("9 a spotter's Not sure withdraws both of its own parts", () => {
    const r = resolveCoatParts([
      spotter("a", { colours: ["ginger"], pattern: "stripes" }, "2026-01-01T10:00:00Z"),
      spotter("b", { colours: ["ginger"], pattern: "stripes" }, "2026-01-02T10:00:00Z"),
      spotter("a", { notSure: true }, "2026-01-03T10:00:00Z"),
    ]);
    expect(r.colours).toMatchObject({ value: ["ginger"], confidence: "reported", rule: 4 });
    expect(r.pattern).toMatchObject({ value: "stripes", confidence: "reported", rule: 4 });
  });

  it("10 supersession (spotter): a device's newer answer replaces the whole older one, so its stripes don't come back", () => {
    const m = machine({ colours: ["ginger"], pattern: "plain" }, "2026-01-01T09:00:00Z");
    const s1 = spotter("a", { colours: ["ginger"], pattern: "stripes" }, "2026-01-02T10:00:00Z");
    const b = spotter("b", { colours: ["ginger"], pattern: "stripes" }, "2026-01-03T10:00:00Z");
    const s2 = spotter("a", { colours: ["ginger"] }, "2026-01-04T10:00:00Z", { supersedesId: s1.id });
    const r = resolveCoatParts([m, s1, b, s2]);
    // With s1 standing, a and b would agree on stripes (rule 2).
    expect(r.pattern).toMatchObject({ value: "plain", confidence: "reported", rule: 3 });
    expect(r.colours).toMatchObject({ value: ["ginger"], confidence: "likely", rule: 2 });
  });

  it("11 supersession (team): T2's pattern replaces T1 whole, so T1's colours don't come back", () => {
    const t1 = team({ colours: ["ginger"] }, "2026-01-01T09:00:00Z");
    const t2 = team({ pattern: "plain" }, "2026-01-02T09:00:00Z", { supersedesId: t1.id });
    const m = machine({ colours: ["grey"] }, "2026-01-01T08:00:00Z");
    const r = resolveCoatParts([t1, t2, m]);
    expect(r.colours).toMatchObject({ value: ["grey"], confidence: "reported", rule: 3 });
    expect(r.pattern).toMatchObject({ value: "plain", rule: 1 });
  });

  it("12 one device's old-then-new history counts as one voice", () => {
    const r = resolveCoatParts([
      spotter("a", { colours: ["ginger", "tabby"] }, "2026-01-01T10:00:00Z"),
      spotter("a", { colours: ["ginger"], pattern: "stripes" }, "2026-01-05T10:00:00Z"),
    ]);
    expect(r.colours).toMatchObject({ value: ["ginger"], confidence: "reported", rule: 4 });
    expect(r.pattern).toMatchObject({ value: "stripes", confidence: "reported", rule: 4 });
  });

  it("13 a later machine reading never beats a team statement, in either part", () => {
    const t = team({ colours: ["black"], pattern: "plain" }, "2026-01-01T09:00:00Z");
    const r = resolveCoatParts([t, machine({ colours: ["ginger"], pattern: "stripes" }, "2026-03-01T09:00:00Z")]);
    expect(r.colours).toMatchObject({ value: ["black"], confidence: "confirmed", rule: 1, supportingObservationIds: [t.id] });
    expect(r.pattern).toMatchObject({ value: "plain", confidence: "confirmed", rule: 1, supportingObservationIds: [t.id] });
    expect(r.colours.checkReasons).toEqual([]);
  });

  it("14 Mark wrong on a two-part team statement: both parts fall to the next rule", () => {
    const t = team({ colours: ["black"], pattern: "plain" }, "2026-01-02T09:00:00Z");
    const wrong = team({ retracted: true, reason: "wrong cat" }, "2026-01-03T09:00:00Z", {
      supersedesId: t.id,
      accountId: "person:staff-2",
    });
    const r = resolveCoatParts([machine({ colours: ["grey"], pattern: "stripes" }, "2026-01-01T09:00:00Z"), t, wrong]);
    expect(r.colours).toMatchObject({ value: ["grey"], rule: 3 });
    expect(r.pattern).toMatchObject({ value: "stripes", rule: 3 });
  });

  describe("15 parity: old-shape histories resolve to the translation of what the old engine resolved", () => {
    const fixtures: [string, Observation[]][] = [
      ["a team black and white", [team({ colours: ["black_and_white"] }, "2026-01-01")]],
      [
        "two spotters on ginger · tabby",
        [
          spotter("a", { colours: ["ginger", "tabby"] }, "2026-01-01T10:00:00Z"),
          spotter("b", { colours: ["ginger", "tabby"] }, "2026-01-02T10:00:00Z"),
        ],
      ],
      ["a machine tortoiseshell", [machine({ colours: ["tortoiseshell_or_calico"], modelVersion: "vision-1" }, "2026-01-01")]],
      [
        "a machine grey overturned by two black spotters",
        [
          machine({ colours: ["grey"], modelVersion: "vision-1" }, "2026-01-01T09:00:00Z"),
          spotter("a", { colours: ["black"] }, "2026-01-02T10:00:00Z"),
          spotter("b", { colours: ["black"] }, "2026-01-03T10:00:00Z"),
        ],
      ],
      [
        "black + white raw and stored agree",
        [
          spotter("a", { colours: ["black", "white"] }, "2026-01-01T10:00:00Z"),
          spotter("b", { colours: ["black_and_white"] }, "2026-01-02T10:00:00Z"),
        ],
      ],
      [
        "a machine Not sure leaves the gap for one spotter",
        [
          machine({ colours: ["grey"], modelVersion: "vision-1" }, "2026-01-01T09:00:00Z"),
          machine({ colours: ["not_sure"], modelVersion: "vision-1" }, "2026-01-02T09:00:00Z"),
          spotter("a", { colours: ["ginger"] }, "2026-01-03T10:00:00Z"),
        ],
      ],
      [
        "three agreed colours: the cap of two is lifted",
        [
          spotter("a", { colours: ["ginger", "white"] }, "2026-01-01T10:00:00Z"),
          spotter("b", { colours: ["ginger", "white"] }, "2026-01-02T10:00:00Z"),
          spotter("c", { colours: ["grey", "ginger"] }, "2026-01-03T10:00:00Z"),
          spotter("d", { colours: ["grey"] }, "2026-01-04T10:00:00Z"),
        ],
      ],
    ];
    for (const [label, rows] of fixtures) {
      it(label, () => {
        // coloursWithParity asserts the parity itself; this pins that the
        // old engine had a real answer for each fixture.
        expect(resolveCoatV1(rows).value).not.toBeNull();
        expect(coloursWithParity(rows).value).not.toBeNull();
      });
    }

    it("the lifted cap shows the third colour the old engine dropped", () => {
      const rows = fixtures.find(([l]) => l.startsWith("three agreed"))![1];
      expect(resolveCoatV1(rows).value).toHaveLength(2);
      expect(coloursWithParity(rows).value).toEqual(["grey", "ginger", "white"]);
    });
  });
});

describe("the cat snapshot carries the two parts", () => {
  it("coatColours and coatPattern, and no coat", () => {
    const s = resolveCat(
      [team({ colours: ["brown", "ginger"], pattern: "stripes" }, "2026-01-01")],
      null,
      new Date("2026-02-01"),
    );
    expect(s.coatColours.value).toEqual(["brown", "ginger"]);
    expect(s.coatPattern.value).toBe("stripes");
    expect("coat" in s).toBe(false);
  });
});
