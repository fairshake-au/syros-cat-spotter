import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { catMapBody } from "./__fixtures__/catMapRig";

// SYC-812 §3.6: the Map says who is left out, inside #mapresults so the script's redraw keeps it true.

const WORDS = "Not showing cats who are no longer with us.";
const resultsOf = (body: string) => new JSDOM(body).window.document.getElementById("mapresults")!;

describe("the Map's honest note (SYC-812 §3.6)", () => {
  it("is inside #mapresults with a Show them link that stays on the Map and keeps the filters", () => {
    const results = resultsOf(catMapBody({ filters: { colours: ["black"] } }));
    expect(results.textContent).toContain(WORDS);
    const link = results.querySelector("p.hint a")!;
    expect(link.textContent).toBe("Show them");
    const href = link.getAttribute("href")!;
    expect(href).toContain("view=map");
    expect(href).toContain("colours=black");
    expect(href).toContain("lives=gone");
  });

  it("is gone when No longer with us is ticked", () => {
    const results = resultsOf(catMapBody({ filters: { lives: ["street", "gone"] } }));
    expect(results.textContent).not.toContain(WORDS);
  });

  it("is not drawn outside #mapresults, and the old words are not on the page", () => {
    const body = catMapBody();
    expect(body.split(WORDS)).toHaveLength(2);
    expect(body).not.toContain("haven't been seen");
    expect(body).not.toContain("haven&#39;t been seen");
  });
});
