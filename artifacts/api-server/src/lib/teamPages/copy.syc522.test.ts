import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CATALOGUE } from "./strings";
import { GROWING_DAYS, GROWING_MIN } from "../dashboard/colonyFigures";

const tr = (lang: "en" | "el" | "fr", key: "colonies.flag.growingKey" | "colonies.empty" | "sites.empty") => CATALOGUE[lang][key];

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

  it("an empty Colonies list says what a colony is", () => {
    expect(tr("en", "colonies.empty")).toContain("A colony is a group of street cats looked after by a cat guardian");
    expect(tr("en", "colonies.empty")).not.toMatch(/colony carer/i);
  });

  it("an empty Feeding sites list says what a feeding site is", () => {
    expect(tr("en", "sites.empty")).toContain("A feeding site is a place where street cats are fed.");
    expect(tr("el", "sites.empty")).not.toBe(tr("en", "sites.empty"));
    expect(tr("fr", "sites.empty")).not.toBe(tr("en", "sites.empty"));
  });
});

// The typed numbers in the chip's explanation must be the rule's own.
describe("the Growing explanation matches the rule (review of #283)", () => {
  it("names GROWING_MIN and GROWING_DAYS in every language", () => {
    for (const lang of ["en", "el", "fr"] as const) {
      const words = tr(lang, "colonies.flag.growingKey");
      expect(words).toContain(String(GROWING_MIN));
      expect(words.match(/\d+/g)).toContain(String(GROWING_DAYS));
    }
  });
});

// Find from a photo's script is only fetched by a browser, so pin its guards here.
describe("find-photo.js keeps its guards (review of #283)", () => {
  const js = readFileSync(new URL("../../../assets/find-photo.js", import.meta.url), "utf8");
  it("ignores a second submit, resets on every pageshow, and times out", () => {
    expect(js).toMatch(/if \(sent\) \{\s*e\.preventDefault\(\)/);
    expect(js).toContain('window.addEventListener("pageshow", reset)');
    expect(js).toMatch(/setTimeout\(reset, 40000\)/);
  });
});
