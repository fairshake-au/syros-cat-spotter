import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MARK_BAR_WORD, MARK_WORD } from "./marks";
import { csvOf, progressTables } from "./reportPages";
import { en } from "./strings/en";
import { el } from "./strings/el";
import { fr } from "./strings/fr";
import type { ProgressReport } from "../reports/progress";
import { catMapRig, posCat } from "./__fixtures__/catMapRig";

// SYC-601 / SYC-600: a cat whose sterilisation isn't known never reads as a
// bare "Not known yet" where a reader could take it to mean "nobody knows
// this cat". These pin the words that stand alone.

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), "utf8");

describe("sterilisation not known, in words that say what isn't known", () => {
  it("labels the mark that stands alone (cards, map legend, filter chips)", () => {
    expect(MARK_WORD.not_known).toBe("Sterilised: not known yet");
  });

  it("labels the bar's word, which sits after a count", () => {
    expect(MARK_BAR_WORD.not_known).toBe("Sterilisation not known yet");
  });

  it("uses the same word on the island map's script legend", () => {
    expect(read("..", "..", "..", "assets", "dashboard-map.js")).toContain(`not_known: "${MARK_WORD.not_known}"`);
  });

  it("the island map's marker and card say it, as drawn on the map", async () => {
    const t = await catMapRig();
    await t.answer(0, [posCat(1, 37.44, 24.94, "not_known")]);
    const [pin] = t.markers("catdot");
    expect(pin.getAttribute("aria-label")).toBe(`Cat ba: ${MARK_WORD.not_known}`);
    pin.click();
    expect(t.document.querySelector("#catsheet .mark-word").textContent).toBe(MARK_WORD.not_known);
  });

  it("labels the guardian colony bar and rows in all three languages", () => {
    expect(en["colonies.mark.notKnown"]).toBe("Sterilisation not known yet");
    // The app's own approved wording (cat-spotter/lib/i18n.ts sterilisedUnknown); Johnny checks them (SYC-283).
    expect(el["colonies.mark.notKnown"]).toBe("Στείρωση: δεν είναι γνωστή ακόμη");
    expect(fr["colonies.mark.notKnown"]).toBe("Stérilisation : pas encore connue");
  });

  it("labels the progress report's column on the page, but not in the spreadsheet", () => {
    const report = {
      workedOutAt: new Date("2026-10-18T10:00:00Z"),
      over: [],
      colonies: [{ colonyId: 1, name: "Kini", split: { sterilised: 1, probably: 0, not_sterilised: 0, not_known: 1 } }],
    } as unknown as ProgressReport;
    const t = progressTables(report, true).colonies;
    expect(t.columns.find((c) => c.key === "not_known")!.label).toBe("Sterilisation not known yet");
    expect(csvOf(t).split("\r\n")[0]).toContain(",Not known yet,");
  });

  it("leaves no bare 'Not known yet' for sterilisation in the team pages' source", () => {
    for (const f of ["likelyPage.ts", "catHistory.ts", "catPages.ts", "catCard.ts"]) {
      expect(/\bNot known yet\b/.test(read(f)), f).toBe(false);
    }
  });
});
