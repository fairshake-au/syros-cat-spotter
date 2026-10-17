import { beforeEach, describe, expect, it, vi } from "vitest";

// SYC-161 plan, PR 1: T-shape and T-prompt, for coat-v2 (SYC-398 PR C). The
// model is mocked in every test; no real call is ever made.
const create = vi.hoisted(() => vi.fn());
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create } } },
}));

import { COAT_COLOURS, COAT_PATTERNS } from "../appearance";
import { VISION_MODEL } from "../visionModel";
import { CONFIDENCE_CUTOFF, MODEL_VERSION, coatPrompt, readCoatFromPhoto } from "./reader";

const PHOTO = { data: "AAAA", mime: "image/jpeg" };

function replies(text: string) {
  create.mockResolvedValueOnce({ choices: [{ message: { content: text } }] });
}

function answer(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    catCount: 1,
    photoClear: true,
    colours: ["ginger"],
    pattern: "stripes",
    confidence: 0.93,
    ...over,
  });
}

beforeEach(() => {
  create.mockReset();
});

describe("T-shape: a good answer is a reading (coat-v2, SYC-398 §7)", () => {
  it("gives its two parts and keeps the raw answer", async () => {
    replies(answer());
    const r = await readCoatFromPhoto(PHOTO);
    expect(r).toEqual({
      kind: "reading",
      parts: { colours: ["ginger"], pattern: "stripes", notSure: false },
      raw: { colours: ["ginger"], pattern: "stripes", confidence: 0.93, catCount: 1, photoClear: true },
    });
  });

  it("makes one call with one image, on the shared vision model, as coat-v2", async () => {
    replies(answer());
    await readCoatFromPhoto(PHOTO);
    expect(create).toHaveBeenCalledTimes(1);
    const body = create.mock.calls[0]![0] as { model: string; messages: { content: { type: string }[] }[] };
    expect(body.model).toBe(VISION_MODEL);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.content.filter((p) => p.type === "image_url")).toHaveLength(1);
    expect(MODEL_VERSION).toBe(`${VISION_MODEL}/coat-v2`);
  });

  it("asks the client never to retry on its own: one counted attempt is one paid call", async () => {
    replies(answer());
    await readCoatFromPhoto(PHOTO);
    expect(create.mock.calls[0]![1]).toMatchObject({ maxRetries: 0 });
  });

  it("accepts an answer wrapped in a markdown fence", async () => {
    replies("```json\n" + answer({ colours: ["grey"], pattern: "plain" }) + "\n```");
    expect(await readCoatFromPhoto(PHOTO)).toMatchObject({
      kind: "reading",
      parts: { colours: ["grey"], pattern: "plain", notSure: false },
    });
  });

  it("all five colours at once are accepted, in display order: there is no limit", async () => {
    replies(answer({ colours: ["white", "ginger", "brown", "grey", "black"], pattern: "patches" }));
    expect(await readCoatFromPhoto(PHOTO)).toMatchObject({
      kind: "reading",
      parts: { colours: [...COAT_COLOURS], pattern: "patches", notSure: false },
    });
  });

  it("each colour alone is accepted", async () => {
    for (const colour of COAT_COLOURS) {
      replies(answer({ colours: [colour], pattern: "plain" }));
      expect(await readCoatFromPhoto(PHOTO), colour).toMatchObject({
        kind: "reading",
        parts: { colours: [colour], pattern: "plain", notSure: false },
      });
    }
  });

  it("each pattern is accepted", async () => {
    for (const pattern of COAT_PATTERNS) {
      replies(answer({ colours: ["black", "white"], pattern }));
      expect(await readCoatFromPhoto(PHOTO), pattern).toMatchObject({
        kind: "reading",
        parts: { colours: ["black", "white"], pattern, notSure: false },
      });
    }
  });

  it("a repeated colour counts once", async () => {
    replies(answer({ colours: ["ginger", "ginger", "white"] }));
    expect(await readCoatFromPhoto(PHOTO)).toMatchObject({ parts: { colours: ["ginger", "white"] } });
  });

  it("cant_tell: the pattern is not known (null) while the colours stand", async () => {
    replies(answer({ colours: ["brown", "ginger"], pattern: "cant_tell" }));
    expect(await readCoatFromPhoto(PHOTO)).toEqual({
      kind: "reading",
      parts: { colours: ["brown", "ginger"], pattern: null, notSure: false },
      raw: { colours: ["brown", "ginger"], pattern: "cant_tell", confidence: 0.93, catCount: 1, photoClear: true },
    });
  });

  it("exactly the cut-off is a reading", async () => {
    replies(answer({ confidence: CONFIDENCE_CUTOFF }));
    expect(await readCoatFromPhoto(PHOTO)).toMatchObject({ parts: { colours: ["ginger"], notSure: false } });
  });
});

describe("T-shape: each R5 case is Not sure", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["two cats", { catCount: 2 }, "cat_count"],
    ["no cat", { catCount: 0 }, "cat_count"],
    ["no cat count", { catCount: undefined }, "cat_count"],
    ["not clear", { photoClear: false }, "not_clear"],
    ["no photoClear", { photoClear: undefined }, "not_clear"],
    ["confidence 0.79", { confidence: 0.79 }, "low_confidence"],
    ["no confidence", { confidence: undefined }, "low_confidence"],
    ["no colours: the model can't tell", { colours: [] }, "model_not_sure"],
    ["an unknown code", { colours: ["purple"] }, "colours"],
    ["a known colour beside an unknown code", { colours: ["ginger", "purple"] }, "colours"],
    ["the old code tabby", { colours: ["ginger", "tabby"] }, "colours"],
    ["the old code tortoiseshell_or_calico", { colours: ["tortoiseshell_or_calico"] }, "colours"],
    ["the old code black_and_white", { colours: ["black_and_white"] }, "colours"],
    ["the old code not_sure", { colours: ["not_sure"] }, "colours"],
    ["colours not a list", { colours: "ginger" }, "colours"],
    ["a colour that isn't a string", { colours: ["ginger", 3] }, "colours"],
    ["an unknown pattern", { pattern: "spots" }, "pattern"],
    ["an old code as the pattern", { pattern: "tabby" }, "pattern"],
    ["no pattern", { pattern: undefined }, "pattern"],
    ["a pattern that isn't a string", { pattern: ["stripes"] }, "pattern"],
  ];
  for (const [label, over, because] of cases) {
    it(label, async () => {
      replies(answer(over));
      const r = await readCoatFromPhoto(PHOTO);
      expect(r.kind).toBe("reading");
      if (r.kind !== "reading") return;
      expect(r.parts).toEqual({ colours: null, pattern: null, notSure: true });
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

describe("T-prompt: the coat only, from the one vocabulary", () => {
  const prompt = coatPrompt();

  it("asks about nothing but the coat", () => {
    for (const word of [/\bsex/i, /\bmale\b/i, /\bfemale\b/i, /\bage\b/i, /\baged?\b/i, /\bears?\b/i, /\bear[- ]?tip/i, /health/i, /sterili[sz]/i, /neuter/i, /injur/i]) {
      expect(prompt, String(word)).not.toMatch(word);
    }
  });

  // SYC-398 PR C replaces A1's "the v1 prompt is unchanged" pin: coat-v2
  // is a new prompt by design.
  it("asks for exactly the five colours, then exactly the three patterns, in order", () => {
    const listed = [...prompt.matchAll(/^ {2}([a-z_]+): /gm)].map((m) => m[1]);
    expect(listed).toEqual([...COAT_COLOURS, ...COAT_PATTERNS]);
    const colourBlock = prompt.slice(prompt.indexOf("- colours:"), prompt.indexOf("- pattern:"));
    const patternBlock = prompt.slice(prompt.indexOf("- pattern:"), prompt.indexOf("- confidence:"));
    expect([...colourBlock.matchAll(/^ {2}([a-z_]+): /gm)].map((m) => m[1])).toEqual([...COAT_COLOURS]);
    expect([...patternBlock.matchAll(/^ {2}([a-z_]+): /gm)].map((m) => m[1])).toEqual([...COAT_PATTERNS]);
    expect(patternBlock).toContain('"cant_tell"');
  });

  it("asks for the coat-v2 answer shape", () => {
    expect(prompt).toContain(
      '{"catCount": number, "photoClear": boolean, "colours": string[], "pattern": string, "confidence": number}',
    );
  });

  it("never names a breeders' coat or an old code, so none can be an answer (spec §2, §7)", () => {
    for (const word of [/tabby/i, /tortoise/i, /calico/i, /black_and_white/, /not_sure/]) {
      expect(prompt, String(word)).not.toMatch(word);
    }
  });

  it("describes the values plainly, as §7 asks", () => {
    // Any patchy look is Patches, never Stripes; a warm sandy brown is
    // Brown, not Ginger; white counts when it is part of the coat.
    expect(prompt).toMatch(/patches:.*any patchy look.*never stripes/i);
    expect(prompt).toMatch(/both striped and patchy is patches/i);
    expect(prompt).toMatch(/brown:.*sandy.*not ginger/i);
    expect(prompt).toMatch(/ginger:.*orange or cream/i);
    expect(prompt).toMatch(/white:.*part of the coat/i);
  });
});
