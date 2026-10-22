import { describe, expect, it } from "vitest";
import { GROWING_DAYS, GROWING_MIN } from "../dashboard/colonyFigures";
import { CATALOGUE } from "./strings";

const tr = (lang: "en" | "el" | "fr", key: "colonies.flag.growingKey" | "colonies.empty" | "colonies.emptyTeam" | "sites.empty") => CATALOGUE[lang][key];

// SYC-522: the Colonies and Feeding sites explanations, in all three languages.
describe("Colonies and Feeding sites say what they are for (SYC-522)", () => {
  it("the Growing chip is explained with the rule it uses", () => {
    expect(tr("en", "colonies.flag.growingKey")).toContain("3 or more new cats in the last 90 days");
    for (const lang of ["el", "fr"] as const) {
      const words = tr(lang, "colonies.flag.growingKey");
      expect(words).not.toBe(tr("en", "colonies.flag.growingKey"));
      expect(words).toContain("90");
    }
  });

  it("the key's numbers are the rule's own", () => {
    expect(tr("en", "colonies.flag.growingKey")).toContain(`${GROWING_MIN} or more new cats in the last ${GROWING_DAYS} days`);
    expect(tr("en", "colonies.flag.growingKey")).toContain(`the ${GROWING_DAYS} days before`);
    for (const lang of ["el", "fr"] as const) {
      expect(tr(lang, "colonies.flag.growingKey")).toContain(String(GROWING_MIN));
      expect(tr(lang, "colonies.flag.growingKey")).toContain(String(GROWING_DAYS));
    }
  });

  it("an empty Colonies list says what a colony is", () => {
    expect(tr("en", "colonies.emptyTeam")).toContain("A colony is a group of street cats looked after by a cat guardian");
    expect(tr("en", "colonies.emptyTeam")).not.toMatch(/colony carer/i);
  });

  it("an empty Feeding sites list says what a feeding site is", () => {
    expect(tr("en", "sites.empty")).toContain("A feeding site is a place where street cats are fed.");
    expect(tr("el", "sites.empty")).not.toBe(tr("en", "sites.empty"));
    expect(tr("fr", "sites.empty")).not.toBe(tr("en", "sites.empty"));
  });
});
