import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catView } from "./__fixtures__/catView";
import { renderCatMapPage } from "./catMapPage";
import { renderDiedPage } from "./diedPage";
import { blankVisitForm, renderVetVisitForm } from "./vetVisitForm";

// SYC-739: the plain-English help on the Map, Cat has died and Log a vet visit.

beforeAll(() => {
  process.env["TEAM_SESSION_KEYS"] = "a".repeat(64);
});
afterAll(() => {
  delete process.env["TEAM_SESSION_KEYS"];
});

describe("help on the Map, Cat has died and Log a vet visit", () => {
  it("the Map says what a dot and a group are, and the Key shows without the script", () => {
    const html = renderCatMapPage({
      personName: "Susan",
      filters: {},
      colonies: [],
      cats: [],
      catCount: 0,
      sites: [],
      focus: null,
      now: new Date("2026-10-15T12:00:00Z"),
    });
    expect(html).toContain("Each dot is a cat, placed where it was last seen.");
    expect(html).toContain("zoom in to split it");
    expect(html).toContain("<summary>Key</summary>");
  });

  it("Cat has died says how to undo it and which picker greys the cat out", () => {
    const html = renderDiedPage(catView({ cat: { name: "Agatha" } }), "Susan");
    expect(html).toContain("you can undo it afterwards with Mark wrong on the entry in Agatha&#39;s History.");
    expect(html).toContain("greyed out in the cat picker in the public app");
  });

  it("Log a vet visit says what ticking Sterilised and choosing the owner do", () => {
    const html = renderVetVisitForm({
      cat: { id: 1, name: "Agatha", mainPhotoUrl: null },
      personName: "Susan",
      values: blankVisitForm(60),
      costs: true,
      vaccinate: true,
      standardPriceEur: 60,
    });
    expect(html).toContain("Ticking Sterilised records the cat as sterilised.");
    expect(html).toContain("overrules that, and undoing the visit puts it back");
    expect(html).toContain("If the owner paid, the cost is not counted in Syros Cats&#39; spend in Reports.");
  });
});
