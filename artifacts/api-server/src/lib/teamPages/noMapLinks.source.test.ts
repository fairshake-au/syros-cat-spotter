import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { t } from "./words";

// SYC-245 (SYC-209 PR 0.2, Decision 2 option B). A page the team sees must
// never send an exact position to a map company. This reads the source of
// every file in lib/teamPages, so a new page cannot add such a link without
// this test failing.

const DIR = dirname(fileURLToPath(import.meta.url));
const MAP_COMPANIES = [
  "google.com/maps",
  "maps.apple.com",
  "maps.google.",
  "goo.gl/maps",
  "geo:",
  "waze.com",
  "openstreetmap.org/?mlat",
];

// Decision 2B: the welfare queue keeps its Google link for positions far from
// every feeding site (directions for a cat in trouble), and drops it within
// 50 m of one. It is the ONLY file exempt, by exact name. The queue page
// tests cover the near-site case.
// position.ts (SYC-362) is the one shared builder of the Open map link.
const EXEMPT = new Set(["queuePage.ts", "position.ts"]);

const sources = readdirSync(DIR).filter(
  (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
);

describe("no link to a map company from the team's pages", () => {
  it("finds the page sources", () => {
    expect(sources).toContain("catPages.ts");
    expect(sources).toContain("queuePage.ts");
    // SYC-209 PR 3.2: the Feeding sites pages are covered too.
    expect(sources).toContain("sitePages.ts");
    expect(sources).toContain("map.ts");
  });

  it("the cat page contains neither a Google nor an Apple maps address", () => {
    const text = readFileSync(join(DIR, "catPages.ts"), "utf8");
    for (const company of MAP_COMPANIES) expect(text).not.toContain(company);
  });

  // SYC-209 PR 3.4: "Make a feeding site here" replaces the map-company link
  // on the cat page, and the page never has both.
  it("the cat page has the sighting buttons and no map-company address", () => {
    const text = readFileSync(join(DIR, "catPages.ts"), "utf8");
    // The words come through t(); the page names the keys, words.ts holds the text.
    expect(text).toContain('"sighting.makeSite"');
    expect(text).toContain('"sighting.showOnMap"');
    expect(t("sighting.makeSite")).toBe("Make a feeding site here");
    expect(t("sighting.showOnMap")).toBe("Show on our map");
    // Both are POST forms to our own routes, carrying only the sighting's number.
    expect(text).toContain('method=\"post\" action=\"/api/team/sites/from-sighting\"');
    expect(text).toContain('method=\"post\" action=\"/api/team/sites/map-at-sighting#map\"');
    for (const company of MAP_COMPANIES) expect(text).not.toContain(company);
  });

  it("a page that offers 'Make a feeding site here' never also links to a map company", () => {
    for (const file of sources) {
      const text = readFileSync(join(DIR, file), "utf8");
      if (!text.includes('"sighting.makeSite"')) continue;
      for (const company of MAP_COMPANIES) expect(text, `${file} has the button and ${company}`).not.toContain(company);
    }
  });

  it.each(sources.filter((f) => !EXEMPT.has(f)))(
    "%s contains no map company address",
    (file) => {
      const text = readFileSync(join(DIR, file), "utf8");
      for (const company of MAP_COMPANIES) expect(text).not.toContain(company);
    },
  );

  it("the exemption is narrow: queuePage.ts has exactly one Google maps address and no other map company", () => {
    const text = readFileSync(join(DIR, "queuePage.ts"), "utf8");
    expect(text.split("google.com/maps")).toHaveLength(2);
    for (const company of MAP_COMPANIES.filter((c) => c !== "google.com/maps"))
      expect(text).not.toContain(company);
  });
});
