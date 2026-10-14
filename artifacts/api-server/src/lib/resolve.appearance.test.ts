import { describe, expect, it } from "vitest";
import type { Observation } from "@workspace/db/schema";
import {
  athensDay,
  hasTwoVoices,
  independentPair,
  onePerVoice,
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
