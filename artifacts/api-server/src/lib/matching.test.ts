import { beforeEach, describe, expect, it, vi } from "vitest";

// SYC-415 plan Task 2.4 (spec §5.2): the matcher sees all of a spot's
// photos first, then the candidates. The model is mocked; no real call.
const create = vi.hoisted(() => vi.fn());
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create } } },
}));

import { matchCatPhoto, type NewPhotoInput } from "./matching";

function replies(obj: unknown) {
  create.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(obj) } }] });
}

const CANDIDATES = [
  { catId: 7, name: "Mitsos", photoBase64: "CAND7", mime: "image/jpeg" },
  { catId: 9, name: "Roza", photoBase64: "CAND9", mime: "image/png" },
];

const THREE: NewPhotoInput[] = [
  { role: "first", photoBase64: "FIRST", mime: "image/jpeg" },
  { role: "face", photoBase64: "FACE", mime: "image/jpeg" },
  { role: "body", photoBase64: "BODY", mime: "image/jpeg" },
];

function sentContent(): any[] {
  return create.mock.calls[0]![0].messages[0].content;
}

beforeEach(() => {
  create.mockReset();
});

describe("matchCatPhoto with several photos", () => {
  it("sends the spot's photos first, in order, then the candidates, and says which is which", async () => {
    replies({ anyCat: true, mixedCats: false, matches: [] });
    await matchCatPhoto(THREE, CANDIDATES);
    const content = sentContent();
    const images = content.filter((c) => c.type === "image_url").map((c) => c.image_url.url);
    expect(images).toEqual([
      "data:image/jpeg;base64,FIRST",
      "data:image/jpeg;base64,FACE",
      "data:image/jpeg;base64,BODY",
      "data:image/jpeg;base64,CAND7",
      "data:image/png;base64,CAND9",
    ]);
    const text = content.find((c) => c.type === "text").text as string;
    expect(text).toContain("image 1 = first photo");
    expect(text).toContain("image 2 = face close-up");
    expect(text).toContain("image 3 = whole body");
    expect(text).toContain('image 4 = cat id 7 ("Mitsos")');
    expect(text).toContain('image 5 = cat id 9 ("Roza")');
    expect(text).toContain("SAME cat");
  });

  it("reads the new answer shape: any cat, and more than one cat", async () => {
    replies({ anyCat: true, mixedCats: true, matches: [{ catId: 7, confidence: 0.8, reasoning: "x" }] });
    const r = await matchCatPhoto(THREE, CANDIDATES);
    expect(r).toEqual({
      isCatPhoto: true,
      mixedCats: true,
      matches: [{ catId: 7, confidence: 0.8, reasoning: "x" }],
    });
  });

  it("no cat in any photo", async () => {
    replies({ anyCat: false, mixedCats: false, matches: [] });
    const r = await matchCatPhoto(THREE, CANDIDATES);
    expect(r.isCatPhoto).toBe(false);
  });

  it("still reads the old answer shape", async () => {
    replies({ isCatPhoto: false, matches: [] });
    const r = await matchCatPhoto(THREE, CANDIDATES);
    expect(r).toEqual({ isCatPhoto: false, mixedCats: false, matches: [] });
  });
});

describe("matchCatPhoto with one photo", () => {
  it("a plain string is one first photo, and 'more than one cat' can't apply", async () => {
    replies({ anyCat: true, mixedCats: true, matches: [] });
    const r = await matchCatPhoto("ONLY", CANDIDATES);
    const images = sentContent()
      .filter((c) => c.type === "image_url")
      .map((c) => c.image_url.url);
    expect(images).toEqual([
      "data:image/jpeg;base64,ONLY",
      "data:image/jpeg;base64,CAND7",
      "data:image/png;base64,CAND9",
    ]);
    const text = sentContent().find((c) => c.type === "text").text as string;
    expect(text).toContain("The FIRST image is a newly submitted photo.");
    expect(text).toContain('image 2 = cat id 7 ("Mitsos")');
    expect(r.mixedCats).toBe(false);
    expect(r.isCatPhoto).toBe(true);
  });

  it("a one-photo list behaves like the string", async () => {
    replies({ isCatPhoto: true, matches: [] });
    const r = await matchCatPhoto([THREE[0]!], []);
    expect(r).toEqual({ isCatPhoto: true, mixedCats: false, matches: [] });
  });
});
