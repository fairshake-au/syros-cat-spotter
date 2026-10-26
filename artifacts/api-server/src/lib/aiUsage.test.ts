import { beforeEach, describe, expect, it, vi } from "vitest";

// SYC-534: every AI call logs its token counts and which feature made it,
// and nothing else. The model and the logger are mocked; no real call.
const create = vi.hoisted(() => vi.fn());
const info = vi.hoisted(() => vi.fn());
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create } } },
}));
vi.mock("./logger", () => ({ logger: { info, warn: vi.fn(), error: vi.fn() } }));

import { matchCatPhoto } from "./matching";
import { readCoatFromPhoto } from "./coatReading/reader";
import { suggestCatNames } from "./nameSuggestions";

const USAGE = { prompt_tokens: 1200, completion_tokens: 80, total_tokens: 1280 };
const KEYS = ["caller", "inputTokens", "outputTokens", "totalTokens"];

function reply(content: string, usage: unknown = USAGE) {
  create.mockResolvedValueOnce({ choices: [{ message: { content } }], usage });
}

/** The token-usage lines only, as [fields, message]. */
function usageLines() {
  return info.mock.calls.filter((c) => c[1] === "ai token usage") as [Record<string, unknown>, string][];
}

const CAND = [{ catId: 7, name: "Mitsos", photoBase64: "CAND7", mime: "image/jpeg" }];
const MATCH = JSON.stringify({ anyCat: true, mixedCats: false, matches: [] });
const COAT = JSON.stringify({ catCount: 1, photoClear: true, colours: ["ginger"], pattern: "stripes", confidence: 0.93 });

beforeEach(() => {
  create.mockReset();
  info.mockReset();
});

describe("AI token usage lines", () => {
  it("a sighting match logs one line: the caller and the three counts, no other keys", async () => {
    reply(MATCH);
    await matchCatPhoto("PHOTO", CAND, "sighting_match");
    const lines = usageLines();
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]![0]).sort()).toEqual([...KEYS].sort());
    expect(lines[0]![0]).toEqual({ caller: "sighting_match", inputTokens: 1200, outputTokens: 80, totalTokens: 1280 });
  });

  it("find from a photo names itself as the caller", async () => {
    reply(MATCH);
    await matchCatPhoto("PHOTO", CAND, "find_from_photo");
    expect(usageLines().map((l) => l[0]["caller"])).toEqual(["find_from_photo"]);
  });

  it("a coat reading logs one line with only those keys", async () => {
    reply(COAT);
    await readCoatFromPhoto({ data: "AAAA", mime: "image/jpeg" });
    const lines = usageLines();
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]![0]).sort()).toEqual([...KEYS].sort());
    expect(lines[0]![0]["caller"]).toBe("coat_reading");
  });

  it("a name suggestion logs one line with only those keys", async () => {
    reply(JSON.stringify({ names: ["Mitsos"] }));
    await suggestCatNames("en", []);
    const lines = usageLines();
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]![0]).sort()).toEqual([...KEYS].sort());
    expect(lines[0]![0]["caller"]).toBe("name_suggestion");
  });

  it("a reply with no usage logs nulls, still one line", async () => {
    create.mockResolvedValueOnce({ choices: [{ message: { content: MATCH } }] });
    await matchCatPhoto("PHOTO", CAND, "sighting_match");
    expect(usageLines()[0]![0]).toEqual({ caller: "sighting_match", inputTokens: null, outputTokens: null, totalTokens: null });
  });

  it("never carries the photo or the cat's name or id", async () => {
    reply(MATCH);
    await matchCatPhoto("SECRETPHOTOBYTES", CAND, "sighting_match");
    const text = JSON.stringify(usageLines());
    for (const leak of ["SECRETPHOTOBYTES", "CAND7", "Mitsos"]) expect(text).not.toContain(leak);
    expect(text).not.toMatch(/\b7\b/);
  });

  it("a coat reading that finishes after our own timeout still logs its tokens", async () => {
    create.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ choices: [{ message: { content: COAT } }], usage: USAGE }), 40)),
    );
    const r = await readCoatFromPhoto({ data: "AAAA", mime: "image/jpeg" }, { timeoutMs: 5 });
    expect(r).toEqual({ kind: "failed", reason: "timeout" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(usageLines().map((l) => l[0]["caller"])).toEqual(["coat_reading"]);
  });
});
