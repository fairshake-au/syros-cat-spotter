import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Observation } from "@workspace/db/schema";
import { resolveCat, type CatSnapshot } from "./resolve";

// SYC-2 PR 1.2. Colour, markings and vaccinations are never notifiable
// (data spine §9.3, spec §4.2 "Four guards") and never feed the matcher
// (SYC2-D8; plan "Every place the rules must hold", invariant 1 items 3, 4
// and 7).
//
// The data spine's nightly news job (§9) is not built yet, so there is no
// snapshot comparison to hook. What can queue anything today is the push
// fan-out, the evening round-up and the mail outbox; none of them reads a
// snapshot beyond `isResolvedDeceased`. These tests pin both halves: a
// colour change moves no field that existed before SYC-2, and no notifier
// or the matcher names the new fields.

let nextId = 1;
function obs(o: Partial<Observation> & { kind: string; value: unknown }): Observation {
  const observedAt = o.observedAt ?? new Date("2026-01-01T12:00:00Z");
  return {
    id: o.id ?? nextId++,
    catId: 1,
    kind: o.kind,
    value: o.value,
    deviceId: o.deviceId === undefined ? "d1" : o.deviceId,
    accountId: o.accountId ?? null,
    roleAtTime: o.roleAtTime ?? "public",
    authorityScope: "none",
    provenance: o.provenance ?? "volunteered",
    suggestedValue: null,
    suggestionSource: null,
    sightingId: null,
    photoId: o.photoId ?? null,
    importRecordId: null,
    observedAt,
    createdAt: observedAt,
    supersedesId: o.supersedesId ?? null,
    supersedeReason: null,
    redactedAt: null,
    redactionReason: null,
  } as Observation;
}

/** The SYC-2 fields. Everything else on the snapshot is what a news
 * comparison may look at. */
const SYC2_FIELDS = ["coat", "markings", "vaccinations"] as const;

function withoutSyc2(s: CatSnapshot): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...s };
  for (const k of SYC2_FIELDS) delete copy[k];
  return copy;
}

describe("not notifiable: a change of colour, markings or vaccination queues nothing", () => {
  it("a colour change moves no field a status comparison reads", () => {
    const team = { deviceId: null, accountId: "person:staff-1", roleAtTime: "staff" } as const;
    const evidence = { at: new Date("2026-09-01"), source: "sighting" as const, lastSightingAt: new Date("2026-09-01") };
    const now = new Date("2026-10-01");
    const base = [
      obs({ kind: "ear_tip", value: { clipped: true }, photoId: 4 }),
      obs({ kind: "coat", value: { colours: ["grey"] }, observedAt: new Date("2026-02-01"), ...team }),
    ];
    const before = resolveCat(base, evidence, now);
    const changed = [
      ...base,
      obs({ kind: "coat", value: { colours: ["ginger"] }, observedAt: new Date("2026-03-01"), ...team }),
      obs({ kind: "markings", value: { marks: ["three_legs"] }, observedAt: new Date("2026-03-01"), ...team }),
      obs({ kind: "vaccinated", value: { vaccines: ["rabies"] }, observedAt: new Date("2026-03-01"), ...team }),
    ];
    const after = resolveCat(changed, evidence, now);

    expect(after.coat.value).not.toEqual(before.coat.value);
    expect(after.markings.value).not.toEqual(before.markings.value);
    // Nothing a news comparison can see has moved.
    expect(withoutSyc2(after)).toEqual(withoutSyc2(before));
    // And the snapshot gained exactly the three SYC-2 fields, so a future
    // comparison that walks "every field" has to be told about them.
    expect(Object.keys(after).filter((k) => !(k in withoutSyc2(after))).sort()).toEqual(
      [...SYC2_FIELDS].sort(),
    );
  });
});

const LIB = __dirname;

/** Code that would read the new resolver output or the appearance kinds. */
const READS_APPEARANCE: RegExp[] = [
  /\bresolveCat\b/,
  /\bresolveCoat\b/,
  /\bresolveMarkings\b/,
  /\bresolveVaccinated\b/,
  /\bCatSnapshot\b/,
  /\bloadCatRecords\b/,
  /\bcheckReasons\b/,
  /\.(coat|markings|vaccinations)\b/,
  /\[\s*["'`](coat|markings|vaccinations)["'`]\s*\]/,
  /\bkind\b[^\n]{0,40}["'`](coat|markings|vaccinated|team_note)["'`]/,
  /from\s+["']\.{1,2}\/(resolve|appearance)["']/,
];

function offending(path: string): string[] {
  const src = readFileSync(path, "utf8");
  return READS_APPEARANCE.filter((re) => re.test(src)).map(String);
}

describe("the patterns catch a reader", () => {
  it("flags each way of reading the new fields", () => {
    for (const sample of [
      "const c = snapshot.coat.value;",
      'const m = s["markings"];',
      'where(eq(observationsTable.kind, "coat"))',
      'import { resolveCat } from "./resolve";',
    ]) {
      expect(READS_APPEARANCE.some((re) => re.test(sample)), sample).toBe(true);
    }
  });
});

describe("source: notifiers never read colour, markings or vaccinations", () => {
  const notifiers = [
    join(LIB, "notificationFanout.ts"),
    join(LIB, "sightingRoundUp.ts"),
    ...readdirSync(join(LIB, "mail"))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => join(LIB, "mail", f)),
  ];
  for (const path of notifiers) {
    it(path.slice(LIB.length + 1), () => {
      expect(offending(path)).toEqual([]);
    });
  }
});

describe("source: appearance never feeds the matcher (SYC2-D8)", () => {
  it("lib/matching.ts reads no coat, markings or snapshot field", () => {
    expect(offending(join(LIB, "matching.ts"))).toEqual([]);
  });
});
