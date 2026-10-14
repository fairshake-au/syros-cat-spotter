import { describe, expect, it } from "vitest";
import type { Observation } from "@workspace/db/schema";
import {
  athensDay,
  hasTwoVoices,
  independentPair,
  onePerVoice,
  resolveCoat,
  standingAppearanceRows,
  twoVoicesSince,
  type AppearanceRanking,
} from "./resolve";

// SYC-2 PR 1.2: colour, markings and vaccinations in the resolver
// (coat-markings-and-health.md §4.2, §6.3, §10.2, §10.6; data spine §10.2
// "Colour and markings"). Tests named P1–P15 are the plan's mutation-probed
// cases, in the plan's table order.

let nextId = 1000;

/** A row as the loader returns it. Defaults: a public, volunteered answer
 * from device "d1", no photo, observed 1 Jan 2026 noon UTC. */
function obs(
  overrides: Partial<Observation> & { kind: string; value: unknown },
): Observation {
  const id = overrides.id ?? nextId++;
  const observedAt = overrides.observedAt ?? new Date("2026-01-01T12:00:00Z");
  const authorGiven =
    overrides.deviceId !== undefined || overrides.accountId !== undefined;
  return {
    id,
    catId: overrides.catId ?? 1,
    kind: overrides.kind,
    value: overrides.value,
    deviceId: authorGiven ? overrides.deviceId ?? null : "d1",
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

let nextPhoto = 1;
/** A spotter's colour answer. Each gets its own photo unless one is given. */
function spotterCoat(
  device: string | null,
  colours: string[],
  day: string,
  extra: Partial<Observation> = {},
): Observation {
  return obs({
    kind: "coat",
    value: { colours },
    deviceId: device,
    photoId: nextPhoto++,
    observedAt: new Date(day),
    ...extra,
  });
}

function spotterMarks(
  device: string | null,
  value: unknown,
  day: string,
  extra: Partial<Observation> = {},
): Observation {
  return obs({
    kind: "markings",
    value,
    deviceId: device,
    photoId: nextPhoto++,
    observedAt: new Date(day),
    ...extra,
  });
}

/** A team statement (staff by default), with no photo. */
function team(
  kind: "coat" | "markings",
  value: unknown,
  day: string,
  extra: Partial<Observation> = {},
): Observation {
  return obs({
    kind,
    value,
    deviceId: null,
    accountId: extra.accountId ?? "person:staff-1",
    roleAtTime: "staff",
    observedAt: new Date(day),
    ...extra,
  });
}

function machineCoat(colours: string[], day: string): Observation {
  return obs({
    kind: "coat",
    value: { colours, modelVersion: "vision-1" },
    deviceId: null,
    accountId: "system:vision",
    roleAtTime: "system",
    provenance: "machine",
    observedAt: new Date(day),
  });
}

/** A ranking with guardians in it (SYC-53's shape, before it is on main):
 * a guardian with a colony scope is level 2, the team level 1. */
const WITH_GUARDIANS: AppearanceRanking = (o) => {
  if (o.roleAtTime === "guardian" && /^colony:[1-9][0-9]*$/.test(o.authorityScope)) return 2;
  if (["staff", "admin", "management"].includes(o.roleAtTime)) return 1;
  return null;
};

/** Like SYC-53's `authorityLevel` with no appearance carve-out: vets, owners
 * and imports rank above everyone. The resolver must ignore them anyway. */
const AUTHORITY_LEVEL_UNCARVED: AppearanceRanking = (o) => {
  if (o.roleAtTime === "vet") return 4;
  if (o.provenance === "import") return 4;
  if (o.authorityScope === "owner_of_this_cat") return 3;
  if (o.roleAtTime === "guardian") return 2;
  if (["staff", "admin", "management"].includes(o.roleAtTime)) return 1;
  return null;
};


describe("the shared voice-counting helper", () => {
  it("buckets days in Europe/Athens, not UTC", () => {
    // 23:30 UTC on 1 Jan is 01:30 on 2 Jan in Athens (UTC+2 in winter).
    expect(athensDay(new Date("2026-01-01T23:30:00Z"))).toBe("2026-01-02");
    expect(athensDay(new Date("2026-01-02T00:30:00Z"))).toBe("2026-01-02");
    // Summer time is UTC+3: 21:30 UTC on 1 Jul is 00:30 on 2 Jul.
    expect(athensDay(new Date("2026-07-01T21:30:00Z"))).toBe("2026-07-02");
  });

  it("keeps one voice per device, the newest row", () => {
    const older = spotterCoat("a", ["ginger"], "2026-01-01T10:00:00Z");
    const newer = spotterCoat("a", ["black"], "2026-01-05T10:00:00Z");
    const other = spotterCoat("b", ["ginger"], "2026-01-03T10:00:00Z");
    const voices = onePerVoice([older, newer, other]);
    expect(voices).toHaveLength(2);
    expect(voices.find((v) => v.key === "device:a")!.row.id).toBe(newer.id);
  });

  it("makes each redacted row a voice of its own", () => {
    const r1 = spotterCoat(null, ["ginger"], "2026-01-01T10:00:00Z", { redactedAt: new Date() });
    const r2 = spotterCoat(null, ["ginger"], "2026-01-03T10:00:00Z", { redactedAt: new Date() });
    expect(onePerVoice([r1, r2]).map((v) => v.key)).toEqual([
      `redacted:${r1.id}`,
      `redacted:${r2.id}`,
    ]);
  });

  it("never counts team, machine or system rows as voices", () => {
    expect(
      onePerVoice([
        team("coat", { colours: ["ginger"] }, "2026-01-01"),
        machineCoat(["ginger"], "2026-01-02"),
      ]),
    ).toEqual([]);
  });

  it("needs different photos, different Athens days and no prompted tap for two", () => {
    const [a, b] = onePerVoice([
      spotterCoat("a", ["ginger"], "2026-01-01T10:00:00Z"),
      spotterCoat("b", ["ginger"], "2026-01-02T10:00:00Z"),
    ]);
    expect(independentPair(a!, b!)).toBe(true);

    const [c, d] = onePerVoice([
      spotterCoat("c", ["ginger"], "2026-01-01T10:00:00Z", { photoId: 77 }),
      spotterCoat("d", ["ginger"], "2026-01-02T10:00:00Z", { photoId: 77 }),
    ]);
    expect(independentPair(c!, d!)).toBe(false);

    const [e, f] = onePerVoice([
      spotterCoat("e", ["ginger"], "2026-01-01T10:00:00Z"),
      spotterCoat("f", ["ginger"], "2026-01-01T15:00:00Z"),
    ]);
    expect(independentPair(e!, f!)).toBe(false);

    const [g, h] = onePerVoice([
      spotterCoat("g", ["ginger"], "2026-01-01T10:00:00Z"),
      spotterCoat("h", ["ginger"], "2026-01-02T10:00:00Z", { provenance: "prompted" }),
    ]);
    expect(independentPair(g!, h!)).toBe(false);
  });

  it("dates two voices from the later row of the earliest independent pair", () => {
    const voices = onePerVoice([
      spotterCoat("a", ["ginger"], "2026-01-01T10:00:00Z"),
      spotterCoat("b", ["ginger"], "2026-01-04T10:00:00Z"),
      spotterCoat("c", ["ginger"], "2026-01-09T10:00:00Z"),
    ]);
    expect(twoVoicesSince(voices)?.toISOString()).toBe("2026-01-04T10:00:00.000Z");
    expect(hasTwoVoices(voices.slice(0, 1))).toBe(false);
  });

  it("drops a retracted row and the retraction, and ignores a cross-device supersession", () => {
    const a = spotterCoat("a", ["ginger"], "2026-01-01");
    const b = spotterCoat("b", ["black"], "2026-01-02");
    const hijack = spotterCoat("c", ["grey"], "2026-01-03", { supersedesId: a.id });
    const retraction = team("coat", { retracted: true }, "2026-01-04", { supersedesId: b.id });
    const standing = standingAppearanceRows([a, b, hijack, retraction], "coat", false);
    expect(standing.map((o) => o.id).sort()).toEqual([a.id, hijack.id].sort());
  });

  it("ignores a retraction from a spotter", () => {
    const a = spotterCoat("a", ["ginger"], "2026-01-01");
    const bogus = spotterCoat("b", null as never, "2026-01-02", {
      value: { retracted: true },
      supersedesId: a.id,
    });
    expect(standingAppearanceRows([a, bogus], "coat", false).map((o) => o.id)).toEqual([a.id]);
  });

  it("drops vet, imported and owner-scope rows entirely", () => {
    const rows = [
      team("coat", { colours: ["ginger"] }, "2026-01-01", { roleAtTime: "vet" }),
      team("coat", { colours: ["ginger"] }, "2026-01-01", { provenance: "import" }),
      spotterCoat("o", ["ginger"], "2026-01-01", { authorityScope: "owner_of_this_cat" }),
    ];
    expect(standingAppearanceRows(rows, "coat", false)).toEqual([]);
  });
});

describe("resolveCoat: probed cases (plan PR 1.2 table)", () => {
  it("P1 one device counts once, even with two live rows", () => {
    // Two standing rows from one device, different photos and days, and no
    // supersession between them: still one voice, so no rule-2 agreement.
    const result = resolveCoat([
      spotterCoat("a", ["ginger"], "2026-01-01T10:00:00Z"),
      spotterCoat("a", ["ginger"], "2026-01-05T10:00:00Z"),
    ]);
    expect(result.confidence).toBe("reported");
    expect(result.value).toEqual(["ginger"]);
  });

  it("P2 two devices with the same photo are one voice", () => {
    const result = resolveCoat([
      spotterCoat("a", ["ginger"], "2026-01-01T10:00:00Z", { photoId: 501 }),
      spotterCoat("b", ["ginger"], "2026-01-05T10:00:00Z", { photoId: 501 }),
    ]);
    expect(result.confidence).toBe("reported");
  });

  it("P3 two devices on one Athens day are one voice; across Athens midnight they are two", () => {
    // 23:30 and 00:30 UTC: different UTC days, both 2 Jan in Athens.
    const sameAthensDay = resolveCoat([
      spotterCoat("a", ["ginger"], "2026-01-01T23:30:00Z"),
      spotterCoat("b", ["ginger"], "2026-01-02T00:30:00Z"),
    ]);
    expect(sameAthensDay.confidence).toBe("reported");

    // The reverse: 21:30 and 22:30 UTC on one UTC day are 23:30 on 1 Jan
    // and 00:30 on 2 Jan in Athens, so they are two voices.
    const acrossAthensMidnight = resolveCoat([
      spotterCoat("a", ["ginger"], "2026-01-01T21:30:00Z"),
      spotterCoat("b", ["ginger"], "2026-01-01T22:30:00Z"),
    ]);
    expect(acrossAthensMidnight.confidence).toBe("likely");
    expect(acrossAthensMidnight.value).toEqual(["ginger"]);
  });

  it("P4 a prompted Yes never counts towards two, including a prompted tap on a spotter-filled value", () => {
    // No machine reading: device a's volunteered ginger fills the gap, and
    // device b's "Yes" to that pre-filled ginger is prompted.
    const onSpotterValue = resolveCoat([
      spotterCoat("a", ["ginger"], "2026-01-01T10:00:00Z"),
      spotterCoat("b", ["ginger"], "2026-01-05T10:00:00Z", {
        provenance: "prompted",
        suggestedValue: { colours: ["ginger"] },
        suggestionSource: "spotter",
      }),
    ]);
    expect(onSpotterValue.confidence).toBe("reported");

    // Two prompted Yeses on a machine guess never overturn anything either.
    const onMachineValue = resolveCoat([
      machineCoat(["grey"], "2026-01-01T09:00:00Z"),
      spotterCoat("a", ["ginger"], "2026-01-02T10:00:00Z", { provenance: "prompted" }),
      spotterCoat("b", ["ginger"], "2026-01-05T10:00:00Z", { provenance: "prompted" }),
    ]);
    expect(onMachineValue.value).toEqual(["grey"]);
    expect(onMachineValue.confidence).toBe("reported");
  });

  it("P5 one spotter never overturns a real machine reading (SYC2-D10)", () => {
    const result = resolveCoat([
      machineCoat(["ginger"], "2026-01-01T09:00:00Z"),
      spotterCoat("a", ["black"], "2026-01-05T10:00:00Z"),
    ]);
    expect(result.value).toEqual(["ginger"]);
    expect(result.confidence).toBe("reported");
    expect(result.checkReasons).toEqual(["no_authority"]);
  });

  it("P6 a later machine reading never beats an earlier team statement", () => {
    const statement = team("coat", { colours: ["black"] }, "2026-01-01T09:00:00Z");
    const result = resolveCoat([statement, machineCoat(["ginger"], "2026-03-01T09:00:00Z")]);
    expect(result.value).toEqual(["black"]);
    expect(result.confidence).toBe("confirmed");
    expect(result.supportingObservationIds).toEqual([statement.id]);
  });

  it("P7 a vet, imported or owner row on coat counts for nothing, as authority or as a voice", () => {
    // A ranking that, like SYC-53's authorityLevel, ranks vets, imports and
    // owners above the team. The appearance carve-out must still drop them.
    const rows = [
      team("coat", { colours: ["black"] }, "2026-02-01T09:00:00Z", { roleAtTime: "vet", accountId: "person:vet" }),
      team("coat", { colours: ["white"] }, "2026-02-02T09:00:00Z", { provenance: "import", accountId: "system:import" }),
      team("coat", { colours: ["grey"] }, "2026-02-03T09:00:00Z", {
        roleAtTime: "public",
        accountId: "person:owner",
        authorityScope: "owner_of_this_cat",
      }),
      // An owner-scope spotter answer is not a voice either: with device a
      // it would make two.
      spotterCoat("owner-device", ["tabby"], "2026-01-01T10:00:00Z", { authorityScope: "owner_of_this_cat" }),
      spotterCoat("a", ["tabby"], "2026-01-05T10:00:00Z"),
    ];
    const result = resolveCoat(rows, AUTHORITY_LEVEL_UNCARVED);
    expect(result.confidence).toBe("reported");
    expect(result.value).toEqual(["tabby"]);
  });

  it("P8 a guardian's older statement beats the team's newer one; the newest wins within a level", () => {
    const guardian = team("coat", { colours: ["ginger"] }, "2026-01-01T09:00:00Z", {
      roleAtTime: "guardian",
      authorityScope: "colony:7",
      accountId: "person:guardian",
    });
    const staffOld = team("coat", { colours: ["grey"] }, "2026-01-03T09:00:00Z");
    const staffNew = team("coat", { colours: ["black"] }, "2026-01-05T09:00:00Z", { accountId: "person:staff-2" });
    const withGuardian = resolveCoat([guardian, staffOld, staffNew], WITH_GUARDIANS);
    expect(withGuardian.value).toEqual(["ginger"]);
    expect(withGuardian.supportingObservationIds).toEqual([guardian.id]);

    const teamOnly = resolveCoat([staffNew, staffOld], WITH_GUARDIANS);
    expect(teamOnly.value).toEqual(["black"]);
  });

  it("P9 two camps resolve to the newer camp, with tied_camps", () => {
    const result = resolveCoat([
      spotterCoat("a", ["ginger"], "2026-01-01T10:00:00Z"),
      spotterCoat("b", ["ginger"], "2026-01-03T10:00:00Z"),
      spotterCoat("c", ["black"], "2026-01-02T10:00:00Z"),
      spotterCoat("d", ["black"], "2026-01-06T10:00:00Z"),
    ]);
    expect(result.value).toEqual(["black"]);
    expect(result.confidence).toBe("likely");
    expect(result.checkReasons).toContain("tied_camps");
  });

  it("P10 Ginger · Tabby and Ginger agree on Ginger; Tabby is not shown", () => {
    const result = resolveCoat([
      spotterCoat("a", ["ginger", "tabby"], "2026-01-01T10:00:00Z"),
      spotterCoat("b", ["ginger"], "2026-01-03T10:00:00Z"),
    ]);
    expect(result.value).toEqual(["ginger"]);
    expect(result.confidence).toBe("likely");
  });

  it("P14 a cross-device supersession in the data does not remove the other device's row", () => {
    const a = spotterCoat("a", ["ginger"], "2026-01-01T10:00:00Z");
    const b = spotterCoat("b", ["ginger"], "2026-01-03T10:00:00Z", { supersedesId: a.id });
    const result = resolveCoat([a, b]);
    expect(result.confidence).toBe("likely");
    expect(result.supportingObservationIds.sort()).toEqual([a.id, b.id].sort());
  });

  it("P15 a redacted row is one voice; a deletion between two voices still leaves two", () => {
    const deleted = spotterCoat(null, ["ginger"], "2026-01-01T10:00:00Z", {
      redactedAt: new Date("2026-01-04T00:00:00Z"),
      redactionReason: "person_deleted",
    });
    const result = resolveCoat([deleted, spotterCoat("b", ["ginger"], "2026-01-03T10:00:00Z")]);
    expect(result.confidence).toBe("likely");
    expect(result.value).toEqual(["ginger"]);
  });
});

describe("resolveCoat: plain cases", () => {
  it("rule 1 alone: a team statement is confirmed", () => {
    const r = resolveCoat([team("coat", { colours: ["grey"] }, "2026-01-01")]);
    expect(r).toMatchObject({ value: ["grey"], confidence: "confirmed", checkReasons: [] });
  });

  it("rule 2 alone: two independent spotters are likely", () => {
    const r = resolveCoat([
      spotterCoat("a", ["tortoiseshell_or_calico"], "2026-01-01T10:00:00Z"),
      spotterCoat("b", ["tortoiseshell_or_calico"], "2026-01-02T10:00:00Z"),
    ]);
    expect(r).toMatchObject({ value: ["tortoiseshell_or_calico"], confidence: "likely", checkReasons: [] });
  });

  it("rule 3 alone: the machine's reading is reported and on the check list", () => {
    const m = machineCoat(["grey", "tabby"], "2026-01-01");
    expect(resolveCoat([m])).toMatchObject({
      value: ["grey", "tabby"],
      confidence: "reported",
      supportingObservationIds: [m.id],
      checkReasons: ["no_authority"],
    });
  });

  it("rule 4 alone: one spotter fills the gap", () => {
    expect(resolveCoat([spotterCoat("a", ["white"], "2026-01-01")])).toMatchObject({
      value: ["white"],
      confidence: "reported",
    });
  });

  it("rule 5 alone: nothing at all is not sure", () => {
    expect(resolveCoat([])).toMatchObject({
      value: null,
      confidence: "unknown",
      checkReasons: ["no_authority"],
    });
  });

  it("rule 1 over rule 2: the team correcting after two spotters agree wins", () => {
    const r = resolveCoat([
      spotterCoat("a", ["ginger"], "2026-01-01T10:00:00Z"),
      spotterCoat("b", ["ginger"], "2026-01-02T10:00:00Z"),
      team("coat", { colours: ["tabby"] }, "2026-01-03T10:00:00Z"),
    ]);
    expect(r).toMatchObject({ value: ["tabby"], confidence: "confirmed" });
  });

  it("rule 1 over later spotters: two spotters after a team statement change nothing", () => {
    const r = resolveCoat([
      team("coat", { colours: ["tabby"] }, "2026-01-01T10:00:00Z"),
      spotterCoat("a", ["ginger"], "2026-01-05T10:00:00Z"),
      spotterCoat("b", ["ginger"], "2026-01-06T10:00:00Z"),
    ]);
    expect(r.value).toEqual(["tabby"]);
  });

  it("rule 2 over rule 3: two spotters overturn the machine and flag spotters_over_machine", () => {
    const m = machineCoat(["grey"], "2026-01-01T09:00:00Z");
    const r = resolveCoat([
      m,
      spotterCoat("a", ["black"], "2026-01-02T10:00:00Z"),
      spotterCoat("b", ["black"], "2026-01-03T10:00:00Z"),
    ]);
    expect(r).toMatchObject({ value: ["black"], confidence: "likely", checkReasons: ["spotters_over_machine"] });
    expect(r.conflicts).toContain(m.id);
  });

  it("two spotters agreeing with the machine raise no check reason", () => {
    const r = resolveCoat([
      machineCoat(["black"], "2026-01-01T09:00:00Z"),
      spotterCoat("a", ["black"], "2026-01-02T10:00:00Z"),
      spotterCoat("b", ["black"], "2026-01-03T10:00:00Z"),
    ]);
    expect(r.checkReasons).toEqual([]);
  });

  it("a machine Not sure leaves the gap for one spotter, and a newer machine Not sure replaces an older reading", () => {
    const r = resolveCoat([
      machineCoat(["grey"], "2026-01-01T09:00:00Z"),
      machineCoat(["not_sure"], "2026-01-02T09:00:00Z"),
      spotterCoat("a", ["ginger"], "2026-01-03T10:00:00Z"),
    ]);
    expect(r).toMatchObject({ value: ["ginger"], confidence: "reported" });
  });

  it("a person's Not sure never wins: not from the team, and a later one withdraws nothing", () => {
    const r = resolveCoat([
      spotterCoat("a", ["ginger"], "2026-01-01T10:00:00Z"),
      spotterCoat("b", ["ginger"], "2026-01-02T10:00:00Z"),
      spotterCoat("b", ["not_sure"], "2026-01-04T10:00:00Z"),
      team("coat", { colours: ["not_sure"] }, "2026-01-05T10:00:00Z"),
    ]);
    expect(r).toMatchObject({ value: ["ginger"], confidence: "likely" });
  });

  it("black + white equals black and white", () => {
    // A row written before normalising existed still agrees with the stored form.
    const r = resolveCoat([
      spotterCoat("a", ["black", "white"], "2026-01-01T10:00:00Z"),
      spotterCoat("b", ["black_and_white"], "2026-01-02T10:00:00Z"),
    ]);
    expect(r).toMatchObject({ value: ["black_and_white"], confidence: "likely" });
  });

  it("two gap-filling spotters with different colours show the newest", () => {
    const r = resolveCoat([
      spotterCoat("a", ["white"], "2026-01-05T10:00:00Z"),
      spotterCoat("b", ["grey"], "2026-01-02T10:00:00Z"),
    ]);
    expect(r.value).toEqual(["white"]);
  });

  it("more than two agreed colours in one camp show the two with the most voices", () => {
    const r = resolveCoat([
      spotterCoat("a", ["ginger", "tabby"], "2026-01-01T10:00:00Z"),
      spotterCoat("b", ["ginger", "white"], "2026-01-02T10:00:00Z"),
      spotterCoat("c", ["ginger", "tabby"], "2026-01-03T10:00:00Z"),
      spotterCoat("d", ["white"], "2026-01-04T10:00:00Z"),
    ]);
    // ginger 3 voices, tabby 2, white 2 (newer): ginger then white.
    expect(r.value).toEqual(["ginger", "white"]);
    expect(r.checkReasons).toEqual([]);
  });

  it("a team Confirm (agreesWith, no photo) is a team statement with the same value", () => {
    const spotter = spotterCoat("a", ["grey"], "2026-01-01T10:00:00Z");
    const confirm = team("coat", { colours: ["grey"], agreesWith: spotter.id }, "2026-01-02T10:00:00Z");
    expect(resolveCoat([spotter, confirm])).toMatchObject({
      value: ["grey"],
      confidence: "confirmed",
      supportingObservationIds: [confirm.id],
    });
  });

  it("retraction: marking a spotter's colour wrong leaves the next rule to decide", () => {
    const a = spotterCoat("a", ["black"], "2026-01-01T10:00:00Z");
    const b = spotterCoat("b", ["black"], "2026-01-02T10:00:00Z");
    const m = machineCoat(["grey"], "2026-01-01T09:00:00Z");
    const wrong = team("coat", { retracted: true, reason: "That is the neighbour's cat" }, "2026-01-03", {
      supersedesId: b.id,
    });
    const r = resolveCoat([a, b, m, wrong]);
    expect(r).toMatchObject({ value: ["grey"], confidence: "reported" });
  });

  it("retraction: a team member can withdraw the team's own statement, leaving the rules below", () => {
    const s = team("coat", { colours: ["black"] }, "2026-01-01");
    const wrong = team("coat", { retracted: true }, "2026-01-02", { supersedesId: s.id, accountId: "person:staff-2" });
    expect(resolveCoat([s, wrong, machineCoat(["grey"], "2026-01-01")]).value).toEqual(["grey"]);
  });
});
