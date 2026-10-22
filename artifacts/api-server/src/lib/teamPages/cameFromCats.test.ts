import { describe, expect, it } from "vitest";
import { cameFromCats } from "./catPages";

describe("cameFromCats (SYC-522)", () => {
  it("keeps the Cats page's filters, from any host, as a path only", () => {
    expect(cameFromCats("https://a.test/api/team/cats?colour=black&q=mimi")).toBe("/api/team/cats?colour=black&q=mimi");
    expect(cameFromCats("https://a.test/api/team/cats?view=map&area=x")).toBe("/api/team/cats?view=map&area=x");
    expect(cameFromCats("https://a.test/api/team/cats")).toBe("/api/team/cats");
  });
  it("drops the page number and a report being tied", () => {
    expect(cameFromCats("https://a.test/api/team/cats?page=4&tie=abc&lives=street")).toBe("/api/team/cats?lives=street");
  });
  it("is nothing for any other page or a bad header", () => {
    for (const r of [undefined, "", "nope", "https://a.test/api/team", "https://a.test/api/team/cats/3", "https://a.test/api/team/cats/find?x=1"]) {
      expect(cameFromCats(r)).toBeUndefined();
    }
  });
});
