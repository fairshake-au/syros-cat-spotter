import { describe, expect, it } from "vitest";
import {
  coverageTables,
  csvOf,
  healthTable,
  progressTables,
  vetTables,
  welfareTables,
} from "./reportPages";
import type { ProgressReport } from "../reports/progress";
import type { HealthReport } from "../reports/colonyHealth";
import type { CoverageReport } from "../reports/coverage";
import type { WelfarePatterns } from "../reports/welfarePatterns";
import type { VetCostsReport } from "../reports/vetCosts";

// SYC-619 task 16: the spreadsheet files must not change when the pages do.
// These snapshots were written against the code BEFORE the reports rework.

const d = (s: string) => new Date(`${s}T10:00:00Z`);
const base = { areasVersion: 3, workedOutAt: d("2026-10-18"), ms: 1 };

const progress = {
  ...base,
  headline: { street: 10, homed: 1, inCare: 2, split: { sterilised: 4, probably: 1, not_sterilised: 3, not_known: 2 } },
  over: [
    { at: d("2026-09-01"), confirmed: 2, street: 8 },
    { at: d("2026-10-01"), confirmed: 4, street: 10 },
  ],
  colonies: [
    { colonyId: 1, name: "=Harbour, east", split: { sterilised: 1, probably: 0, not_sterilised: 2, not_known: 1 } },
    { colonyId: 2, name: "Empty", split: { sterilised: 0, probably: 0, not_sterilised: 0, not_known: 0 } },
  ],
} as unknown as ProgressReport;

const health: HealthReport = {
  anyColonies: true,
  ...base,
  rows: [
    { colonyId: 1, name: "Kini", catsNow: 5, change: -2, kittens: true, notSeenLately: 1, guardian: false, lastVisit: d("2026-10-10"), flags: ["kittens", "no_guardian"] },
    { colonyId: 2, name: "Azolimnos", catsNow: 3, change: 4, kittens: false, notSeenLately: 0, guardian: true, lastVisit: null, flags: [] },
  ],
};

const coverage = {
  ...base,
  cells: [],
  labels: [],
  perWeek: [{ at: d("2026-10-05"), sightings: 3 }],
  sightings: 3,
  spotters: 2,
  withoutSpotter: 0,
  offSyros: 0,
  areas: [{ area: "Kini", notLookedAt: 4, seen: 2, sightings: 3 }],
} as unknown as CoverageReport;

const welfare = {
  ...base,
  perWeek: [{ at: d("2026-10-05"), counts: { urgent: 1, attention: 2, litter: 0 } }],
  total: 3,
  drafts: 1,
  contentReports: 0,
  topAreas: [{ area: "Kini", count: 3 }],
} as unknown as WelfarePatterns;

const vet = {
  workedOutAt: d("2026-10-18"),
  ms: 1,
  perMonth: [{ at: d("2026-10-01"), visits: 2, spendEur: 60.5 }],
  byPurpose: { sterilised: 60.5, vaccinated: 0, treated: 0, checked: 0 },
  visitsByPurpose: { sterilised: 1, vaccinated: 0, treated: 0, checked: 1 },
  perSterilisation: { avg: 60.5, min: 60.5, max: 60.5, n: 1 },
  noCost: 1,
  visits: [
    { visitId: 1, catId: 1, catName: "=Tom", at: d("2026-10-10"), clinic: "Symviosis", did: ["sterilised"], costEur: 60.5, paidBy: "syros_cats" },
    { visitId: 2, catId: 2, catName: "Ada", at: d("2026-10-11"), clinic: "Symviosis", did: ["checked"], costEur: null, paidBy: "owner" },
  ],
} as unknown as VetCostsReport;

describe("CSV output is locked (SYC-619 task 16)", () => {
  it("progress-over", () => expect(csvOf(progressTables(progress, true).over)).toMatchSnapshot());
  it("progress-colonies", () => expect(csvOf(progressTables(progress, true).colonies)).toMatchSnapshot());
  it("health", () => expect(csvOf(healthTable(health, "name", "asc", true))).toMatchSnapshot());
  it("coverage-weeks", () => expect(csvOf(coverageTables(coverage, true).weeks)).toMatchSnapshot());
  it("coverage-areas", () => expect(csvOf(coverageTables(coverage, true).areas)).toMatchSnapshot());
  it("welfare-weeks", () => expect(csvOf(welfareTables(welfare, true).weeks)).toMatchSnapshot());
  it("welfare-areas", () => expect(csvOf(welfareTables(welfare, true).areas)).toMatchSnapshot());
  it("vet-months", () => expect(csvOf(vetTables(vet, true).months)).toMatchSnapshot());
  it("vet-purposes", () => expect(csvOf(vetTables(vet, true).purposes)).toMatchSnapshot());
  it("vet-visits", () => expect(csvOf(vetTables(vet, true).visits)).toMatchSnapshot());
});
