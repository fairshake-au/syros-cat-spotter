import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SIGN_OFF_FACT_IDS,
  STARTER_FACT_IDS,
  settingShapeProblem,
  settingsFromRows,
} from "./appSettings";

// SYC-36 / SYC-48, match-wait plan PR 1: the switches, as pure functions.

describe("settingsFromRows", () => {
  it("with no rows: no donation link, the nine sign-off facts hidden, taps counted, extra photos off", () => {
    expect(settingsFromRows([])).toEqual({
      donateUrl: null,
      hiddenFacts: [...SIGN_OFF_FACT_IDS],
      countTaps: true,
      extraPhotosOn: false,
    });
  });

  it("the nine sign-off facts are facts 1, 3, 4, 5, 6, 8, 9, 12 and 19", () => {
    const positions = SIGN_OFF_FACT_IDS.map((id) => STARTER_FACT_IDS.indexOf(id as never) + 1);
    expect(positions).toEqual([1, 3, 4, 5, 6, 8, 9, 12, 19]);
  });

  it("an https donation page switches the link on", () => {
    const s = settingsFromRows([{ key: "feed_nudge_donate_url", value: "https://syroscats.com/donations" }]);
    expect(s.donateUrl).toBe("https://syroscats.com/donations");
  });

  it("an empty donation page switches the link off", () => {
    expect(settingsFromRows([{ key: "feed_nudge_donate_url", value: "" }]).donateUrl).toBeNull();
  });

  it.each([
    ["http://syroscats.com/donations"],
    ["javascript:alert(1)"],
    ["/donations"],
    [42],
    [{ url: "https://syroscats.com" }],
  ])("a donation page of %j is read as no link, never an error", (value) => {
    expect(settingsFromRows([{ key: "feed_nudge_donate_url", value }]).donateUrl).toBeNull();
  });

  it("an empty facts list hides nothing", () => {
    expect(settingsFromRows([{ key: "starter_facts_hidden", value: [] }]).hiddenFacts).toEqual([]);
  });

  it("unknown fact ids are dropped and duplicates collapsed", () => {
    const s = settingsFromRows([
      { key: "starter_facts_hidden", value: ["fact.milk", "fact.nope", "fact.milk"] },
    ]);
    expect(s.hiddenFacts).toEqual(["fact.milk"]);
  });

  it("a wrongly shaped facts value is read as if the row were missing", () => {
    for (const value of ["fact.milk", [1, 2], null, { a: 1 }]) {
      expect(settingsFromRows([{ key: "starter_facts_hidden", value }]).hiddenFacts).toEqual([
        ...SIGN_OFF_FACT_IDS,
      ]);
    }
  });

  it("feed_tap_count false stops the count; a wrong shape counts", () => {
    expect(settingsFromRows([{ key: "feed_tap_count", value: false }]).countTaps).toBe(false);
    expect(settingsFromRows([{ key: "feed_tap_count", value: "no" }]).countTaps).toBe(true);
  });

  it("extra_photos_on (SYC-415) true shows the boxes; a wrong shape keeps them off", () => {
    expect(settingsFromRows([{ key: "extra_photos_on", value: true }]).extraPhotosOn).toBe(true);
    expect(settingsFromRows([{ key: "extra_photos_on", value: false }]).extraPhotosOn).toBe(false);
    expect(settingsFromRows([{ key: "extra_photos_on", value: "yes" }]).extraPhotosOn).toBe(false);
  });
});

describe("settingShapeProblem (what db-ops set-setting refuses)", () => {
  it("accepts the right shapes", () => {
    expect(settingShapeProblem("feed_nudge_donate_url", "https://syroscats.com/donations")).toBeNull();
    expect(settingShapeProblem("feed_nudge_donate_url", "")).toBeNull();
    expect(settingShapeProblem("starter_facts_hidden", ["fact.milk"])).toBeNull();
    expect(settingShapeProblem("feed_tap_count", true)).toBeNull();
  });

  it("refuses the wrong ones", () => {
    expect(settingShapeProblem("feed_nudge_donate_url", "http://x.org")).not.toBeNull();
    expect(settingShapeProblem("starter_facts_hidden", "fact.milk")).not.toBeNull();
    expect(settingShapeProblem("feed_tap_count", "true")).not.toBeNull();
  });
});

describe("the fact ids match the app's", () => {
  it("STARTER_FACT_IDS lists the same ids, in the same order, as artifacts/cat-spotter/lib/starterFacts.ts", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      path.join(here, "../../../cat-spotter/lib/starterFacts.ts"),
      "utf8",
    );
    const appIds = [...source.matchAll(/id:\s*'(fact\.[A-Za-z]+)'/g)].map((m) => m[1]);
    expect(appIds).toEqual([...STARTER_FACT_IDS]);
  });
});
