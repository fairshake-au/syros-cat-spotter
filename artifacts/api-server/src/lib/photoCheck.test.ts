import { describe, it, expect } from "vitest";
import { buildCheckPrompt, readCheckAnswer, enoughCatParts } from "./photoCheck";

const read = (o: unknown, many = false) => readCheckAnswer(JSON.stringify(o), many);

describe("readCheckAnswer", () => {
  it("ignores capitals and spaces in catCheck", () => {
    expect(read({ catCheck: "Cat ", catPartsSeen: ["face"] }).catCheck).toBe("cat");
  });
  it("reads UNSURE and unknown words as unsure", () => {
    expect(read({ catCheck: "UNSURE" }).catCheck).toBe("unsure");
    expect(read({ catCheck: "maybe" }).catCheck).toBe("unsure");
  });
  it("reads not_cat", () => {
    expect(read({ catCheck: "not_cat", catPartsSeen: [] }).catCheck).toBe("not_cat");
  });
  it("downgrades cat to unsure when the parts do not meet the rule", () => {
    expect(read({ catCheck: "cat", catPartsSeen: ["fur", "paws"] }).catCheck).toBe("unsure");
    expect(read({ catCheck: "cat" }).catCheck).toBe("unsure");
  });
  it("keeps cat when the parts meet the rule", () => {
    expect(read({ catCheck: "cat", catPartsSeen: ["whiskers", "paws"] }).catCheck).toBe("cat");
  });
  it("reads the old shape without a parts check", () => {
    expect(read({ anyCat: true }).catCheck).toBe("cat");
    expect(read({ anyCat: false }).catCheck).toBe("not_cat");
    expect(read({ isCatPhoto: "true" }).catCheck).toBe("cat");
    expect(read({}).catCheck).toBe("not_cat");
  });
  it("lets catCheck win over old fields", () => {
    expect(read({ catCheck: "not_cat", anyCat: true }).catCheck).toBe("not_cat");
  });
  it("trims photoSeen to 120 characters and gives null when missing", () => {
    expect(read({ catCheck: "unsure", photoSeen: "a".repeat(200) }).photoSeen).toHaveLength(120);
    expect(read({ catCheck: "unsure" }).photoSeen).toBeNull();
  });
  it("mixedCats is false for one photo whatever the model says", () => {
    expect(read({ catCheck: "cat", mixedCats: true }, false).mixedCats).toBe(false);
    expect(read({ catCheck: "cat", mixedCats: true }, true).mixedCats).toBe(true);
  });
  it("filters and clamps matches as before", () => {
    const out = read({
      catCheck: "unsure",
      matches: [
        { catId: "x", confidence: 0.5, reasoning: "no" },
        { catId: 3, confidence: 4, reasoning: "yes" },
        { catId: 4, confidence: -2 },
      ],
    });
    expect(out.matches).toEqual([
      { catId: 3, confidence: 1, reasoning: "yes" },
      { catId: 4, confidence: 0, reasoning: "" },
    ]);
  });
  it("throws on unparseable output", () => {
    expect(() => readCheckAnswer("no json here", false)).toThrow(
      "AI matching returned unparseable output",
    );
  });
});

describe("enoughCatParts", () => {
  it("applies the rule", () => {
    expect(enoughCatParts(["tail"])).toBe(true);
    expect(enoughCatParts(["whiskers", "fur"])).toBe(true);
    expect(enoughCatParts(["fur"])).toBe(false);
    expect(enoughCatParts(["fur", "paws"])).toBe(false);
    expect(enoughCatParts("face")).toBe(false);
    expect(enoughCatParts(["face", "face", "sock"])).toBe(true);
    expect(enoughCatParts(["whiskers", "whiskers"])).toBe(false);
  });
});

describe("buildCheckPrompt", () => {
  const photos = [{ role: "first" as const, photoBase64: "x", mime: "image/jpeg" }];
  it("leaves out the known-cats part when there are no candidates", () => {
    const t = buildCheckPrompt({ photos, candidates: [] });
    expect(t).not.toContain("known cats");
    expect(t).not.toContain("0 images");
    expect(t).not.toContain("expert");
  });
  it("opens neutrally, orders the JSON and excludes people and text", () => {
    const t = buildCheckPrompt({ photos, candidates: [{ catId: 7, name: "Mimi" }] });
    expect(t.split(/[.\n]/)[0]).not.toContain("expert");
    expect(t).toContain("expert");
    expect(t.indexOf('"catCheck"')).toBeLessThan(t.indexOf('"matches"'));
    expect(t).toMatch(/never describe people/i);
    expect(t).toContain("number plates");
    expect(t).toContain('cat id 7 ("Mimi")');
  });
  it("applies the several-photos rule", () => {
    const t = buildCheckPrompt({
      photos: [...photos, { role: "face", photoBase64: "y", mime: "image/jpeg" }],
      candidates: [],
    });
    expect(t).toContain("any photo clearly shows a cat");
  });
});
