import { describe, expect, it } from "vitest";
import type { Observation } from "@workspace/db/schema";
import {
  athensDay,
  hasTwoVoices,
  independentPair,
  onePerVoice,
  resolveCoat,
  resolveMarkings,
  resolveVaccinated,
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

const NOW = new Date("2026-06-01T12:00:00Z");

describe("resolveMarkings: probed cases (plan PR 1.2 table)", () => {
  it("P11 spotters only add: an omission, a later [] and cantTell remove nothing", () => {
    // Device a ticks white paws, then replaces its own answer with "nothing
    // special", then with "can't tell". Device b ticks white paws, then
    // replaces its own answer with long fur only (an omission).
    const a1 = spotterMarks("a", { marks: ["white_paws"] }, "2026-01-01T10:00:00Z");
    const a2 = spotterMarks("a", { marks: [] }, "2026-01-03T10:00:00Z", { supersedesId: a1.id });
    const a3 = spotterMarks("a", { cantTell: true }, "2026-01-04T10:00:00Z", { supersedesId: a2.id });
    const b1 = spotterMarks("b", { marks: ["white_paws"] }, "2026-01-02T10:00:00Z");
    const b2 = spotterMarks("b", { marks: ["long_fur"] }, "2026-01-05T10:00:00Z", { supersedesId: b1.id });
    // The same, with later answers appended rather than superseding.
    const c1 = spotterMarks("c", { marks: ["kinked_tail"] }, "2026-02-01T10:00:00Z");
    const c2 = spotterMarks("c", { marks: [] }, "2026-02-03T10:00:00Z");
    const d1 = spotterMarks("d", { marks: ["kinked_tail"] }, "2026-02-02T10:00:00Z");
    const d2 = spotterMarks("d", { cantTell: true }, "2026-02-04T10:00:00Z");
    const r = resolveMarkings([a1, a2, a3, b1, b2, c1, c2, d1, d2], NOW);
    expect(r.value).toEqual(["white_paws", "kinked_tail"]);
    expect(r.confidence).toBe("likely");
  });

  it("P12 marking one of three spotters' marks wrong leaves the other two", () => {
    const a = spotterMarks("a", { marks: ["three_legs"] }, "2026-01-01T10:00:00Z");
    const b = spotterMarks("b", { marks: ["three_legs"] }, "2026-01-02T10:00:00Z");
    const c = spotterMarks("c", { marks: ["three_legs"] }, "2026-01-03T10:00:00Z");
    const wrong = team("markings", { retracted: true }, "2026-01-04T10:00:00Z", { supersedesId: c.id });
    const r = resolveMarkings([a, b, c, wrong], NOW);
    expect(r.value).toEqual(["three_legs"]);
    expect(r.supportingObservationIds.sort()).toEqual([a.id, b.id].sort());

    // And the retraction does remove its own target: with only two voices,
    // marking one wrong leaves the mark held at one.
    const d = spotterMarks("d", { marks: ["missing_eye"] }, "2026-01-01T10:00:00Z");
    const e = spotterMarks("e", { marks: ["missing_eye"] }, "2026-01-02T10:00:00Z");
    const wrongE = team("markings", { retracted: true }, "2026-01-04T10:00:00Z", { supersedesId: e.id });
    expect(resolveMarkings([d, e, wrongE], NOW).value).toBeNull();
  });

  it("P13 two voices dated after the standing team list show the mark and set markings_reopened", () => {
    const list = team("markings", { marks: ["white_paws"] }, "2026-03-01T10:00:00Z");
    const r = resolveMarkings(
      [
        // Two voices for long fur from before the list: the list overruled them.
        spotterMarks("x", { marks: ["long_fur"] }, "2026-01-01T10:00:00Z"),
        spotterMarks("y", { marks: ["long_fur"] }, "2026-01-02T10:00:00Z"),
        list,
        spotterMarks("a", { marks: ["torn_ear"] }, "2026-03-05T10:00:00Z"),
        spotterMarks("b", { marks: ["torn_ear"] }, "2026-03-07T10:00:00Z"),
      ],
      new Date("2026-03-10T00:00:00Z"),
    );
    expect(r.value).toEqual(["white_paws", "torn_ear"]);
    expect(r.checkReasons).toContain("markings_reopened");
    expect(r.checkReasons).toContain("markings_changed_recently");
  });
});

describe("resolveMarkings: plain cases", () => {
  it("a mark is held at one voice and shown at two", () => {
    const one = [spotterMarks("a", { marks: ["colourpoint"] }, "2026-01-01T10:00:00Z")];
    expect(resolveMarkings(one, NOW)).toMatchObject({ value: null, confidence: "unknown" });
    const two = [...one, spotterMarks("b", { marks: ["colourpoint"] }, "2026-01-02T10:00:00Z")];
    expect(resolveMarkings(two, NOW)).toMatchObject({ value: ["colourpoint"], confidence: "likely" });
  });

  it("a device's later answer adds to what it ticked before", () => {
    const a1 = spotterMarks("a", { marks: ["white_chest"] }, "2026-01-01T10:00:00Z");
    const a2 = spotterMarks("a", { marks: ["white_face"] }, "2026-01-03T10:00:00Z", { supersedesId: a1.id });
    const b = spotterMarks("b", { marks: ["white_chest", "white_face"] }, "2026-01-02T10:00:00Z");
    expect(resolveMarkings([a1, a2, b], NOW).value).toEqual(["white_chest", "white_face"]);
  });

  it("cantTell changes nothing", () => {
    const rows = [
      spotterMarks("a", { marks: ["odd_eyes"] }, "2026-01-01T10:00:00Z"),
      spotterMarks("b", { marks: ["odd_eyes"] }, "2026-01-02T10:00:00Z"),
    ];
    const withCantTell = [
      ...rows,
      spotterMarks("c", { cantTell: true }, "2026-01-03T10:00:00Z"),
      team("markings", { cantTell: true }, "2026-01-04T10:00:00Z"),
    ];
    expect(resolveMarkings(withCantTell, NOW)).toEqual(resolveMarkings(rows, NOW));
  });

  it("only a team statement removes a mark, and an empty team list clears the marks", () => {
    const r = resolveMarkings(
      [
        spotterMarks("a", { marks: ["short_tail"] }, "2026-01-01T10:00:00Z"),
        spotterMarks("b", { marks: ["short_tail"] }, "2026-01-02T10:00:00Z"),
        team("markings", { marks: [] }, "2026-01-05T10:00:00Z"),
      ],
      NOW,
    );
    expect(r).toMatchObject({ value: [], confidence: "confirmed", checkReasons: [] });
  });

  it("a team list may hold five marks", () => {
    const five = ["white_paws", "white_chest", "white_face", "long_fur", "kinked_tail"];
    expect(resolveMarkings([team("markings", { marks: five }, "2026-01-01")], NOW).value).toEqual(five);
  });

  it("the newest team list stands; a guardian's list outranks the team's", () => {
    const older = team("markings", { marks: ["long_fur"] }, "2026-01-01");
    const newer = team("markings", { marks: ["torn_ear"] }, "2026-01-05", { accountId: "person:staff-2" });
    expect(resolveMarkings([older, newer], NOW).value).toEqual(["torn_ear"]);
    const guardian = team("markings", { marks: ["white_paws"] }, "2025-12-01", {
      roleAtTime: "guardian",
      authorityScope: "colony:3",
      accountId: "person:guardian",
    });
    expect(resolveMarkings([older, newer, guardian], NOW, WITH_GUARDIANS).value).toEqual(["white_paws"]);
  });

  it("a vet, imported or owner list counts for nothing", () => {
    const rows = [
      team("markings", { marks: ["three_legs"] }, "2026-01-01", { roleAtTime: "vet", accountId: "person:vet" }),
      team("markings", { marks: ["three_legs"] }, "2026-01-02", { provenance: "import" }),
      team("markings", { marks: ["three_legs"] }, "2026-01-03", { authorityScope: "owner_of_this_cat", roleAtTime: "public" }),
    ];
    expect(resolveMarkings(rows, NOW, AUTHORITY_LEVEL_UNCARVED).value).toBeNull();
  });

  it("each of the four recognition marks follows the same two-voice and add-only rules", () => {
    for (const mark of ["short_tail", "missing_eye", "three_legs", "odd_eyes"]) {
      const a1 = spotterMarks("a", { marks: [mark] }, "2026-01-01T10:00:00Z");
      const one = resolveMarkings([a1], NOW);
      expect(one.value).toBeNull();
      const a2 = spotterMarks("a", { marks: [] }, "2026-01-02T10:00:00Z", { supersedesId: a1.id });
      const b = spotterMarks("b", { marks: [mark] }, "2026-01-03T10:00:00Z");
      expect(resolveMarkings([a1, a2, b], NOW).value).toEqual([mark]);
    }
  });

  it("two voices on one Athens day, or one photo, or a prompted tap, are one", () => {
    const sameDay = [
      spotterMarks("a", { marks: ["long_fur"] }, "2026-01-01T23:30:00Z"),
      spotterMarks("b", { marks: ["long_fur"] }, "2026-01-02T00:30:00Z"),
    ];
    expect(resolveMarkings(sameDay, NOW).value).toBeNull();
    const samePhoto = [
      spotterMarks("a", { marks: ["long_fur"] }, "2026-01-01T10:00:00Z", { photoId: 9001 }),
      spotterMarks("b", { marks: ["long_fur"] }, "2026-01-03T10:00:00Z", { photoId: 9001 }),
    ];
    expect(resolveMarkings(samePhoto, NOW).value).toBeNull();
    const prompted = [
      spotterMarks("a", { marks: ["long_fur"] }, "2026-01-01T10:00:00Z"),
      spotterMarks("b", { marks: ["long_fur"] }, "2026-01-03T10:00:00Z", { provenance: "prompted" }),
    ];
    expect(resolveMarkings(prompted, NOW).value).toBeNull();
  });

  it("markings_changed_recently only within 30 days of the second voice", () => {
    const rows = [
      spotterMarks("a", { marks: ["white_face"] }, "2026-05-01T10:00:00Z"),
      spotterMarks("b", { marks: ["white_face"] }, "2026-05-10T10:00:00Z"),
    ];
    expect(resolveMarkings(rows, new Date("2026-06-01T00:00:00Z")).checkReasons).toEqual([
      "markings_changed_recently",
    ]);
    expect(resolveMarkings(rows, new Date("2026-06-15T00:00:00Z")).checkReasons).toEqual([]);
  });
});

describe("resolveVaccinated (resolver half of spec §10.6 'Vaccinated')", () => {
  function vacc(value: unknown, day: string, extra: Partial<Observation> = {}): Observation {
    return obs({
      kind: "vaccinated",
      value,
      deviceId: null,
      accountId: "person:staff-1",
      roleAtTime: "staff",
      observedAt: new Date(day),
      ...extra,
    });
  }

  it("returns the team's vaccinations newest first", () => {
    const older = vacc({ vaccines: ["rabies"] }, "2025-04-01");
    const newer = vacc({ vaccines: ["cat_flu_enteritis", { other: "FeLV" }], clinic: "Ermoupoli" }, "2026-04-01");
    expect(resolveVaccinated([older, newer])).toEqual([
      {
        observationId: newer.id,
        date: "2026-04-01T00:00:00.000Z",
        vaccines: ["cat_flu_enteritis", { other: "FeLV" }],
        clinic: "Ermoupoli",
      },
      { observationId: older.id, date: "2025-04-01T00:00:00.000Z", vaccines: ["rabies"], clinic: null },
    ]);
  });

  it("has no negative state: nothing recorded is an empty list, not 'not vaccinated'", () => {
    expect(resolveVaccinated([])).toEqual([]);
    // Even a value that tries to say "no" asserts nothing.
    expect(resolveVaccinated([vacc({ vaccinated: false }, "2026-01-01")])).toEqual([]);
  });

  it("takes nothing from public, guardian, system or vet rows", () => {
    const rows = [
      vacc({ vaccines: ["rabies"] }, "2026-01-01", { roleAtTime: "public", accountId: null, deviceId: "d9" }),
      vacc({ vaccines: ["rabies"] }, "2026-01-02", { roleAtTime: "guardian", authorityScope: "colony:2" }),
      vacc({ vaccines: ["rabies"] }, "2026-01-03", { roleAtTime: "system", provenance: "import" }),
      vacc({ vaccines: ["rabies"] }, "2026-01-04", { roleAtTime: "vet" }),
    ];
    expect(resolveVaccinated(rows)).toEqual([]);
  });

  it("a team correction replaces the row it supersedes; a spotter's supersession does nothing", () => {
    const wrong = vacc({ vaccines: ["rabies"] }, "2026-01-01");
    const fixed = vacc({ vaccines: ["cat_flu_enteritis"] }, "2026-01-01", { supersedesId: wrong.id });
    const bogus = obs({ kind: "vaccinated", value: { vaccines: ["rabies"] }, supersedesId: fixed.id });
    expect(resolveVaccinated([wrong, fixed, bogus]).map((v) => v.observationId)).toEqual([fixed.id]);
  });
});

describe("review finding 1: a device repeating itself never costs a value its second voice", () => {
  it("R1a A ticks torn ear Mon, B Tue, then A again Tue: still shown", () => {
    const r = resolveMarkings(
      [
        spotterMarks("a", { marks: ["torn_ear"] }, "2026-01-05T10:00:00Z", { photoId: 1 }),
        spotterMarks("b", { marks: ["torn_ear"] }, "2026-01-06T10:00:00Z", { photoId: 2 }),
        spotterMarks("a", { marks: ["torn_ear"] }, "2026-01-06T15:00:00Z", { photoId: 3 }),
      ],
      NOW,
    );
    expect(r.value).toEqual(["torn_ear"]);
  });

  it("R1b the same, with A's newer row reusing B's photo: still shown", () => {
    const r = resolveMarkings(
      [
        spotterMarks("a", { marks: ["torn_ear"] }, "2026-01-05T10:00:00Z", { photoId: 1 }),
        spotterMarks("b", { marks: ["torn_ear"] }, "2026-01-06T10:00:00Z", { photoId: 2 }),
        spotterMarks("a", { marks: ["torn_ear"] }, "2026-01-07T10:00:00Z", { photoId: 2 }),
      ],
      NOW,
    );
    expect(r.value).toEqual(["torn_ear"]);
  });

  it("R1c colour: A and B volunteer ginger, then A's later prompted ginger tap: still likely", () => {
    const r = resolveCoat([
      spotterCoat("a", ["ginger"], "2026-01-05T10:00:00Z"),
      spotterCoat("b", ["ginger"], "2026-01-06T10:00:00Z"),
      spotterCoat("a", ["ginger"], "2026-01-08T10:00:00Z", { provenance: "prompted" }),
    ]);
    expect(r).toMatchObject({ value: ["ginger"], confidence: "likely" });
  });
});

describe("review finding 2: 'Delete my data' never turns one voice into two", () => {
  function redact(o: Observation): Observation {
    return { ...o, deviceId: null, redactedAt: new Date("2026-02-01T00:00:00Z"), redactionReason: "person_deleted" };
  }

  it("R2a colour: X ginger Mon, then X ginger Tue superseding it, is one voice before and after redaction", () => {
    const x1 = spotterCoat("x", ["ginger"], "2026-01-05T10:00:00Z", { photoId: 1 });
    const x2 = spotterCoat("x", ["ginger"], "2026-01-06T10:00:00Z", { photoId: 2, supersedesId: x1.id });
    expect(resolveCoat([x1, x2]).confidence).toBe("reported");
    expect(resolveCoat([redact(x1), redact(x2)]).confidence).toBe("reported");
  });

  it("R2b markings: X three legs Mon, then Tue superseding it, shows nothing before or after redaction", () => {
    const x1 = spotterMarks("x", { marks: ["three_legs"] }, "2026-01-05T10:00:00Z", { photoId: 1 });
    const x2 = spotterMarks("x", { marks: ["three_legs"] }, "2026-01-06T10:00:00Z", { photoId: 2, supersedesId: x1.id });
    expect(resolveMarkings([x1, x2], NOW).value).toBeNull();
    expect(resolveMarkings([redact(x1), redact(x2)], NOW).value).toBeNull();
  });

  it("R2c a redacted chain through a row that ticked nothing is still one voice", () => {
    const x1 = spotterMarks("x", { marks: ["three_legs"] }, "2026-01-05T10:00:00Z");
    const x2 = spotterMarks("x", { marks: [] }, "2026-01-06T10:00:00Z", { supersedesId: x1.id });
    const x3 = spotterMarks("x", { marks: ["three_legs"] }, "2026-01-07T10:00:00Z", { supersedesId: x2.id });
    expect(resolveMarkings([redact(x1), redact(x2), redact(x3)], NOW).value).toBeNull();
  });

  it("a cross-device supersession between two live devices is still ignored", () => {
    const a = spotterMarks("a", { marks: ["three_legs"] }, "2026-01-05T10:00:00Z");
    const b = spotterMarks("b", { marks: ["three_legs"] }, "2026-01-06T10:00:00Z", { supersedesId: a.id });
    expect(resolveMarkings([a, b], NOW).value).toEqual(["three_legs"]);
  });
});
