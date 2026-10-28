import { describe, expect, it } from "vitest";
import type { Observation } from "@workspace/db/schema";
import {
  appearanceAuthorityLevel,
  clippedTipCount,
  resolveCoatParts,
  resolveLifeStatus,
  resolveMarkings,
  resolveSterilised,
  resolveVaccinated,
  standingAppearanceRows,
  standingRows,
  supersedeChains,
} from "./resolve";
import { newestActiveClip } from "./teamCorrections";

// SYC-150 PR 3.1 (which-cat-is-which.md §9.5): a row `loadCatRecords` lists
// as `elsewhere` (it lives on another cat, and replaces one of this cat's
// rows) never counts for this cat. One test per resolver: the same rows with
// the elsewhere row give the same answer as without it, and the same row
// NOT marked elsewhere does change the answer (so the test can fail).

let nextId = 1;
const at = (d: number) => new Date(Date.UTC(2026, 8, d, 9));
const now = at(28);

function obs(o: Partial<Observation> & { kind: string; value: unknown }): Observation {
  const observedAt = o.observedAt ?? at(10);
  const authorGiven = o.deviceId !== undefined || o.accountId !== undefined;
  return {
    id: o.id ?? nextId++,
    catId: o.catId ?? 1,
    kind: o.kind,
    value: o.value,
    deviceId: authorGiven ? (o.deviceId ?? null) : "device-1",
    accountId: authorGiven ? (o.accountId ?? null) : null,
    roleAtTime: o.roleAtTime ?? "public",
    authorityScope: o.authorityScope ?? "none",
    provenance: o.provenance ?? "volunteered",
    suggestedValue: null,
    suggestionSource: null,
    sightingId: o.sightingId ?? null,
    photoId: o.photoId ?? null,
    importRecordId: null,
    observedAt,
    createdAt: o.createdAt ?? observedAt,
    supersedesId: o.supersedesId ?? null,
    supersedeReason: o.supersedeReason ?? null,
    sightingMoveId: o.sightingMoveId ?? null,
    redactedAt: null,
    redactionReason: null,
  } as Observation;
}

const elsewhere = (o: Observation) => ({ ...o, elsewhere: true as const });

/** The row on another cat, as loadCatRecords lists it, and the same row with no flag. */
function both<T>(base: Observation[], row: Observation, resolve: (rows: Observation[]) => T) {
  return {
    without: resolve(base),
    withElsewhere: resolve([...base, elsewhere(row)]),
    unflagged: resolve([...base, row]),
  };
}

function expectIgnored<T>(r: { without: T; withElsewhere: T; unflagged: T }) {
  expect(r.withElsewhere).toEqual(r.without);
  expect(r.unflagged, "the row must change the answer when it isn't elsewhere").not.toEqual(r.without);
}

const clip = (extra: Partial<Observation> = {}) =>
  obs({ kind: "ear_tip", value: { clipped: true, side: "left" }, photoId: 7, sightingId: 70, catId: 2, sightingMoveId: 1, ...extra });

describe("an elsewhere row never counts", () => {
  it("resolveSterilised", () => {
    expectIgnored(both([], clip(), (rows) => resolveSterilised(rows, [])));
  });

  it("clippedTipCount", () => {
    expectIgnored(both([], clip(), clippedTipCount));
  });

  it("resolveLifeStatus", () => {
    const row = obs({ kind: "life_status", value: { status: "deceased" }, accountId: "staff-a", roleAtTime: "staff", catId: 2, sightingMoveId: 1 });
    expectIgnored(both([], row, (rows) => resolveLifeStatus(rows, null, now)));
  });

  it("resolveCoatParts and standingAppearanceRows (coat)", () => {
    const row = obs({ kind: "coat", value: { colours: ["ginger"], pattern: "stripes" }, accountId: "staff-a", deviceId: null, roleAtTime: "staff", catId: 2, sightingMoveId: 1 });
    expectIgnored(both([], row, (rows) => resolveCoatParts(rows, appearanceAuthorityLevel)));
    expectIgnored(both([], row, (rows) => standingAppearanceRows(rows, "coat", false, appearanceAuthorityLevel)));
  });

  it("resolveMarkings", () => {
    const row = obs({ kind: "markings", value: { marks: ["white_paws"] }, accountId: "staff-a", deviceId: null, roleAtTime: "staff", catId: 2, sightingMoveId: 1 });
    expectIgnored(both([], row, (rows) => resolveMarkings(rows, now, appearanceAuthorityLevel)));
  });

  it("resolveVaccinated, standingRows and supersedeChains", () => {
    const row = obs({ kind: "vaccinated", value: { vaccines: ["rabies"] }, accountId: "staff-a", deviceId: null, roleAtTime: "staff", catId: 2, sightingMoveId: 1 });
    expectIgnored(both([], row, resolveVaccinated));
    expectIgnored(both([], row, (rows) => standingRows(rows, "vaccinated")));
    expectIgnored(both([], row, (rows) => supersedeChains(rows, "vaccinated").standing));
  });

  it("newestActiveClip (the Likely list's rule)", () => {
    const own = obs({ kind: "ear_tip", value: { clipped: true }, photoId: 3, createdAt: at(5) });
    expectIgnored(both([own], clip({ createdAt: at(6) }), (rows) => newestActiveClip(rows)?.id ?? null));
  });

  it("…while the row it replaces stops counting here", () => {
    // The spotter's clipped answer on Mimi, copied to Agatha by a move: Mimi
    // is back to Unknown, as if she never had the sighting.
    const original = obs({ kind: "ear_tip", value: { clipped: true, side: "left" }, photoId: 7, sightingId: 70, catId: 1 });
    const copy = elsewhere(clip({ supersedesId: original.id }));
    expect(resolveSterilised([original], []).confidence).toBe("likely");
    expect(resolveSterilised([original, copy], [])).toEqual(resolveSterilised([], []));
    expect(clippedTipCount([original, copy])).toBe(0);
  });
});
