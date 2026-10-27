import { describe, expect, it } from "vitest";
import type { Observation } from "@workspace/db/schema";
import { handPickDisagrees } from "./handPick";
import { resolveCoatParts } from "./resolve";

// SYC-398 A1.4 item 3: the hand-pick reason reads the spotter's answer
// through the one translation, and flags a shared-nothing colour answer or
// a different pattern (both known). Pure: the rows are built here; the
// route-level cases are in routes/team.appearance.test.ts.

let nextId = 7000;
const SIGHTING = 42;

function row(o: Partial<Observation> & { value: unknown }): Observation {
  const at = o.observedAt ?? new Date("2026-01-01T12:00:00Z");
  return {
    id: nextId++,
    catId: 1,
    kind: "coat",
    value: o.value,
    deviceId: o.deviceId === undefined ? null : o.deviceId,
    accountId: o.accountId ?? null,
    roleAtTime: o.roleAtTime ?? "public",
    authorityScope: "none",
    provenance: o.provenance ?? "volunteered",
    suggestedValue: null,
    suggestionSource: null,
    sightingId: o.sightingId ?? null,
    photoId: null,
    importRecordId: null,
    observedAt: at,
    createdAt: o.createdAt ?? at,
    supersedesId: null,
    supersedeReason: null,
    redactedAt: null,
    redactionReason: null,
  } as Observation;
}

/** The machine's reading, written before the spotter answered. */
const machine = (value: Record<string, unknown>) =>
  row({
    value: { modelVersion: "m", ...value },
    accountId: "system:vision",
    roleAtTime: "system",
    provenance: "machine",
    observedAt: new Date("2026-01-01T09:00:00Z"),
  });

/** The spotter's own answer on the hand-picked sighting, a day later. */
const answer = (value: unknown) =>
  row({ value, deviceId: "picker", sightingId: SIGHTING, observedAt: new Date("2026-01-02T10:00:00Z") });

function flags(rows: Observation[]): boolean {
  // The spotter's answers on the hand-picked sighting (handPickedAmong's ids).
  const picked = new Set(rows.filter((o) => o.sightingId === SIGHTING && o.deviceId === "picker").map((o) => o.id));
  return handPickDisagrees(rows, resolveCoatParts(rows), picked);
}

describe("handPickDisagrees (SYC-398)", () => {
  it("a translated old answer: black and white shares black with a black cat, so no flag", () => {
    expect(flags([machine({ colours: ["black"] }), answer({ colours: ["black_and_white"] })])).toBe(false);
  });

  it("a shared colour means no flag", () => {
    expect(flags([machine({ colours: ["brown", "ginger"] }), answer({ colours: ["ginger", "white"] })])).toBe(false);
  });

  it("no shared colour flags", () => {
    expect(flags([machine({ colours: ["black"] }), answer({ colours: ["ginger"] })])).toBe(true);
  });

  it("a pattern mismatch flags when both patterns are known", () => {
    expect(flags([machine({ colours: ["ginger"], pattern: "plain" }), answer({ colours: ["ginger"], pattern: "stripes" })])).toBe(true);
  });

  it("no pattern on either side gives no pattern flag", () => {
    expect(flags([machine({ colours: ["ginger"] }), answer({ colours: ["ginger"], pattern: "stripes" })])).toBe(false);
    expect(flags([machine({ colours: ["ginger"], pattern: "plain" }), answer({ colours: ["ginger"] })])).toBe(false);
  });

  it("an old Tabby · White answer says no colour, so only its stripes are compared", () => {
    expect(flags([machine({ colours: ["grey"], pattern: "stripes" }), answer({ colours: ["tabby", "white"] })])).toBe(false);
    expect(flags([machine({ colours: ["grey"], pattern: "plain" }), answer({ colours: ["tabby", "white"] })])).toBe(true);
  });

  it("a Not sure, in either shape, never flags", () => {
    expect(flags([machine({ colours: ["black"] }), answer({ notSure: true })])).toBe(false);
    expect(flags([machine({ colours: ["black"] }), answer({ colours: ["not_sure"] })])).toBe(false);
  });

  it("an answer on a sighting not picked by hand never flags", () => {
    const rows = [machine({ colours: ["black"] }), answer({ colours: ["ginger"] })];
    expect(handPickDisagrees(rows, resolveCoatParts(rows), new Set())).toBe(false);
  });
});
