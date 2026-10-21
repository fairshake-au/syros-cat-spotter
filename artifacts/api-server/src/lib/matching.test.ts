import { beforeEach, describe, expect, it, vi } from "vitest";

// SYC-415 plan Task 2.4 (spec §5.2): the matcher sees all of a spot's
// photos first, then the candidates. The model is mocked; no real call.
const create = vi.hoisted(() => vi.fn());
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create } } },
}));

import { isQuickRetryable, matchCatPhoto, type NewPhotoInput } from "./matching";

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

describe("matchCatPhoto tolerates booleans sent as strings", () => {
  it('"anyCat": "true" is a cat, not "no cat"', async () => {
    replies({ anyCat: "true", mixedCats: "false", matches: [] });
    const r = await matchCatPhoto(THREE, CANDIDATES);
    expect(r.isCatPhoto).toBe(true);
    expect(r.mixedCats).toBe(false);
  });

  it('"anyCat": "false" is no cat', async () => {
    replies({ anyCat: "false", matches: [] });
    expect((await matchCatPhoto(THREE, CANDIDATES)).isCatPhoto).toBe(false);
  });

  it('old-shape "isCatPhoto": "true" is a cat', async () => {
    replies({ isCatPhoto: "true", matches: [] });
    expect((await matchCatPhoto(THREE, CANDIDATES)).isCatPhoto).toBe(true);
  });

  it('"mixedCats": "true" counts with several photos, never with one', async () => {
    replies({ anyCat: true, mixedCats: "true", matches: [] });
    expect((await matchCatPhoto(THREE, CANDIDATES)).mixedCats).toBe(true);
    replies({ anyCat: true, mixedCats: "true", matches: [] });
    expect((await matchCatPhoto("ONLY", CANDIDATES)).mixedCats).toBe(false);
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

// SYC-503 D3: a 30-second cap per try, and one retry only for a quick failure.
describe("matchCatPhoto time limit and retry (SYC-503)", () => {
  const ok = { choices: [{ message: { content: JSON.stringify({ anyCat: true, matches: [] }) } }] };

  it("caps each try at 30 seconds and turns the library's own retries off", async () => {
    create.mockResolvedValueOnce(ok);
    await matchCatPhoto("ONE", []);
    expect(create.mock.calls[0]![1]).toEqual({ timeout: 30_000, maxRetries: 0 });
  });

  it("retries once when the service couldn't be reached", async () => {
    create.mockRejectedValueOnce(Object.assign(new Error("Connection error."), { status: undefined }));
    create.mockResolvedValueOnce(ok);
    await expect(matchCatPhoto("ONE", [])).resolves.toMatchObject({ isCatPhoto: true });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("retries once on a server error, and gives up if that fails too", async () => {
    create.mockRejectedValueOnce(Object.assign(new Error("502"), { status: 502 }));
    create.mockRejectedValueOnce(Object.assign(new Error("503"), { status: 503 }));
    await expect(matchCatPhoto("ONE", [])).rejects.toThrow("503");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("never retries a 4xx", async () => {
    create.mockRejectedValueOnce(Object.assign(new Error("400"), { status: 400 }));
    await expect(matchCatPhoto("ONE", [])).rejects.toThrow("400");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("never retries after a timeout (a slow failure)", async () => {
    vi.useFakeTimers();
    try {
      create.mockImplementationOnce(async () => {
        vi.advanceTimersByTime(30_000);
        throw new Error("Request timed out.");
      });
      await expect(matchCatPhoto("ONE", [])).rejects.toThrow("timed out");
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("isQuickRetryable", () => {
  it("is quick-and-not-4xx only", () => {
    expect(isQuickRetryable(new Error("x"), 100)).toBe(true);
    expect(isQuickRetryable({ status: 500 }, 100)).toBe(true);
    expect(isQuickRetryable({ status: 429 }, 100)).toBe(false);
    expect(isQuickRetryable(new Error("x"), 5_000)).toBe(false);
  });
});
