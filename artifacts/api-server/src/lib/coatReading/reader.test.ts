import { beforeEach, describe, expect, it, vi } from "vitest";

// SYC-161 plan, PR 1: T-shape and T-prompt. The model is mocked in every
// test; no real call is ever made.
const create = vi.hoisted(() => vi.fn());
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create } } },
}));

import { COAT_COLOURS } from "../appearance";
import { VISION_MODEL } from "../visionModel";
import { CONFIDENCE_CUTOFF, MODEL_VERSION, coatPrompt, readCoatFromPhoto } from "./reader";

const PHOTO = { data: "AAAA", mime: "image/jpeg" };

function replies(text: string) {
  create.mockResolvedValueOnce({ choices: [{ message: { content: text } }] });
}

function answer(over: Record<string, unknown> = {}) {
  return JSON.stringify({ catCount: 1, photoClear: true, colours: ["ginger", "tabby"], confidence: 0.93, ...over });
}

beforeEach(() => {
  create.mockReset();
});

describe("T-shape: a good answer is a reading", () => {
  it("gives its colours and keeps the raw answer", async () => {
    replies(answer());
    const r = await readCoatFromPhoto(PHOTO);
    expect(r).toEqual({
      kind: "reading",
      colours: ["ginger", "tabby"],
      raw: { colours: ["ginger", "tabby"], confidence: 0.93, catCount: 1, photoClear: true },
    });
  });

  it("makes one call with one image, on the shared vision model", async () => {
    replies(answer());
    await readCoatFromPhoto(PHOTO);
    expect(create).toHaveBeenCalledTimes(1);
    const body = create.mock.calls[0]![0] as { model: string; messages: { content: { type: string }[] }[] };
    expect(body.model).toBe(VISION_MODEL);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.content.filter((p) => p.type === "image_url")).toHaveLength(1);
    expect(MODEL_VERSION).toBe(`${VISION_MODEL}/coat-v1`);
  });

  it("accepts an answer wrapped in a markdown fence", async () => {
    replies("```json\n" + answer({ colours: ["grey"] }) + "\n```");
    expect(await readCoatFromPhoto(PHOTO)).toMatchObject({ kind: "reading", colours: ["grey"] });
  });

  it("black + white is stored as black_and_white", async () => {
    replies(answer({ colours: ["black", "white"] }));
    expect(await readCoatFromPhoto(PHOTO)).toMatchObject({ kind: "reading", colours: ["black_and_white"] });
  });

  it("exactly the cut-off is a reading", async () => {
    replies(answer({ confidence: CONFIDENCE_CUTOFF }));
    expect(await readCoatFromPhoto(PHOTO)).toMatchObject({ colours: ["ginger", "tabby"] });
  });
});

describe("T-shape: each R5 case is Not sure", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["two cats", { catCount: 2 }, "cat_count"],
    ["no cat", { catCount: 0 }, "cat_count"],
    ["no cat count", { catCount: undefined }, "cat_count"],
    ["not clear", { photoClear: false }, "not_clear"],
    ["confidence 0.79", { confidence: 0.79 }, "low_confidence"],
    ["no confidence", { confidence: undefined }, "low_confidence"],
    ["three colours", { colours: ["ginger", "tabby", "white"] }, "colours"],
    ["no colours", { colours: [] }, "colours"],
    ["not_sure with a colour", { colours: ["not_sure", "grey"] }, "colours"],
    ["an unknown code", { colours: ["purple"] }, "colours"],
    ["black_and_white + white", { colours: ["black_and_white", "white"] }, "colours"],
    ["colours not a list", { colours: "ginger" }, "colours"],
    ["the model's own Not sure", { colours: ["not_sure"] }, "model_not_sure"],
  ];
  for (const [label, over, because] of cases) {
    it(label, async () => {
      replies(answer(over));
      const r = await readCoatFromPhoto(PHOTO);
      expect(r.kind).toBe("reading");
      if (r.kind !== "reading") return;
      expect(r.colours).toEqual(["not_sure"]);
      expect(r.raw.notSureBecause).toBe(because);
    });
  }
});

describe("T-shape: a failed call is failed, never a reading", () => {
  it("a thrown error", async () => {
    create.mockRejectedValueOnce(new Error("upstream 500"));
    expect(await readCoatFromPhoto(PHOTO)).toEqual({ kind: "failed", reason: "error" });
  });

  it("a timeout", async () => {
    create.mockImplementationOnce(() => new Promise(() => {}));
    expect(await readCoatFromPhoto(PHOTO, { timeoutMs: 20 })).toEqual({ kind: "failed", reason: "timeout" });
  });

  it("unparseable text", async () => {
    replies("I think it is a ginger cat.");
    expect(await readCoatFromPhoto(PHOTO)).toEqual({ kind: "failed", reason: "unparseable" });
  });

  it("broken JSON", async () => {
    replies('{"catCount": 1, "colours": [');
    expect(await readCoatFromPhoto(PHOTO)).toEqual({ kind: "failed", reason: "unparseable" });
  });

  it("an empty reply", async () => {
    create.mockResolvedValueOnce({ choices: [] });
    expect(await readCoatFromPhoto(PHOTO)).toEqual({ kind: "failed", reason: "unparseable" });
  });
});

describe("T-prompt: colour only, from the one list", () => {
  const prompt = coatPrompt();

  it("asks about nothing but colour", () => {
    for (const word of [/\bsex/i, /\bmale\b/i, /\bfemale\b/i, /\bage\b/i, /\baged?\b/i, /\bears?\b/i, /\bear[- ]?tip/i, /health/i, /sterili[sz]/i, /neuter/i, /injur/i]) {
      expect(prompt, String(word)).not.toMatch(word);
    }
  });

  it("its colour list is COAT_COLOURS exactly, in order", () => {
    const listed = [...prompt.matchAll(/^ {2}([a-z_]+): /gm)].map((m) => m[1]);
    expect(listed).toEqual([...COAT_COLOURS]);
  });
});
