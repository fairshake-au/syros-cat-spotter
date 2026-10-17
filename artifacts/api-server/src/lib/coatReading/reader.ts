import { openai } from "@workspace/integrations-openai-ai-server";
import { LEGACY_COAT_CODES, readCoatValue, type CoatParts, type LegacyCoatCode } from "../appearance";
import { VISION_MODEL } from "../visionModel";

/**
 * The colour reader (SYC-161 plan, PR 1; rule R5). Looks at ONE photo of one
 * cat and says its coat colour from SYC-119's fixed list, or Not sure. It
 * asks about colour only: never sex, age, ears or health (spec §4.7).
 *
 * One model call, one image. It never throws: a failed call (an error, a
 * timeout, output that isn't JSON) comes back as `failed`, and the caller
 * writes nothing (R6), so the photo can be tried again later.
 */

/**
 * The version written on every reading (`value.modelVersion`). A change to
 * the prompt below bumps `coat-v1`, so readings from different prompts can
 * be told apart (SYC-56).
 */
export const MODEL_VERSION = `${VISION_MODEL}/coat-v1`;

/**
 * Below this confidence the answer is Not sure. Cautious to start; tuned from
 * SYC-56's labels. Every reading keeps the model's raw confidence in its
 * team-only `suggestedValue`, so a different cut-off can be judged from one
 * trial without paying for another.
 */
export const CONFIDENCE_CUTOFF = 0.8;

/** How long one call may take before it counts as failed. */
export const READ_TIMEOUT_MS = 60_000;

/**
 * What each code means, for the prompt. coat-v1 asks for the old eight codes
 * (`LEGACY_COAT_CODES`) until SYC-398 PR C brings coat-v2: keyed by them, so
 * the live prompt stays exactly as it was (reader.test.ts pins it).
 */
const COLOUR_DESCRIPTIONS: Record<LegacyCoatCode, string> = {
  black: "solid black, or nearly all black",
  white: "solid white, or nearly all white",
  ginger: "ginger, orange or cream",
  grey: "solid grey (sometimes called blue)",
  tabby: "a tabby pattern: stripes, spots or swirls, in any colour",
  tortoiseshell_or_calico: "tortoiseshell or calico: patches of black and orange, with or without white",
  black_and_white: "black and white (bicolour or tuxedo)",
  not_sure: "you can't tell",
};

/** The prompt. Exported for T-prompt only. */
export function coatPrompt(): string {
  const list = LEGACY_COAT_CODES.map((c) => `  ${c}: ${COLOUR_DESCRIPTIONS[c]}`).join("\n");
  return (
    `This is a photo of a street cat. Say what colour its coat is, and nothing else about the cat.\n\n` +
    `Respond with ONLY valid JSON, no markdown:\n` +
    `{"catCount": number, "photoClear": boolean, "colours": string[], "confidence": number}\n\n` +
    `- catCount: how many cats you can see in the photo.\n` +
    `- photoClear: false if the photo is too dark, blurred or far away to judge the coat's colour.\n` +
    `- colours: one or two codes from this list:\n${list}\n` +
    `  Use two codes only when both describe the coat (a ginger tabby is ["ginger", "tabby"]). ` +
    `Use ["not_sure"] alone if you can't tell.\n` +
    `- confidence: from 0.0 to 1.0, how sure you are of the colours.`
  );
}

/** Why a reading came out Not sure. */
export type NotSureReason =
  | "cat_count"
  | "not_clear"
  | "colours"
  | "model_not_sure"
  | "low_confidence";

/** The model's own answer, kept in the team-only `suggestedValue`. */
export interface RawCoatAnswer {
  colours: string[];
  confidence: number | null;
  catCount: number | null;
  photoClear: boolean | null;
  /** Set when the reading is Not sure. */
  notSureBecause?: NotSureReason;
}

export type CoatReadResult =
  | { kind: "reading"; colours: LegacyCoatCode[]; parts: CoatParts; raw: RawCoatAnswer }
  | { kind: "failed"; reason: "error" | "timeout" | "unparseable" };

const COLOUR_SET: ReadonlySet<string> = new Set(LEGACY_COAT_CODES);

/**
 * R5, pure: the old codes the model gave, and what they say as a coat's two
 * parts (SYC-398 §6, through the one translation), which is what is written.
 * `["not_sure"]` (Not sure) unless the model saw exactly one cat, said the
 * photo is clear, gave one or two known codes that make a storable set, and
 * was at least {@link CONFIDENCE_CUTOFF} sure.
 */
export function interpretCoatAnswer(answer: Record<string, unknown>): {
  colours: LegacyCoatCode[];
  parts: CoatParts;
  raw: RawCoatAnswer;
} {
  const given = Array.isArray(answer["colours"])
    ? answer["colours"].filter((c): c is string => typeof c === "string")
    : [];
  const confidence =
    typeof answer["confidence"] === "number" && Number.isFinite(answer["confidence"])
      ? answer["confidence"]
      : null;
  const catCount = typeof answer["catCount"] === "number" ? answer["catCount"] : null;
  const photoClear = typeof answer["photoClear"] === "boolean" ? answer["photoClear"] : null;
  const raw: RawCoatAnswer = { colours: given, confidence, catCount, photoClear };
  const notSure = (because: NotSureReason) => ({
    colours: ["not_sure"] as LegacyCoatCode[],
    parts: { colours: null, pattern: null, notSure: true },
    raw: { ...raw, notSureBecause: because },
  });

  if (catCount !== 1) return notSure("cat_count");
  if (photoClear !== true) return notSure("not_clear");

  const list = answer["colours"];
  if (!Array.isArray(list) || list.some((c) => typeof c !== "string")) return notSure("colours");
  const unique = [...new Set(list as string[])];
  if (unique.length < 1 || unique.length > 2 || !unique.every((c) => COLOUR_SET.has(c))) {
    return notSure("colours");
  }
  if (unique.includes("not_sure")) {
    return notSure(unique.length === 1 ? "model_not_sure" : "colours");
  }
  // Black + white is the one stored code black_and_white (as before SYC-398).
  const colours = (
    unique.length === 2 && unique.includes("black") && unique.includes("white") ? ["black_and_white"] : unique
  ) as LegacyCoatCode[];
  // "black_and_white" already says black and says white: the validator
  // refuses either beside it, so the pair is not a reading.
  if (colours.includes("black_and_white") && (colours.includes("black") || colours.includes("white"))) {
    return notSure("colours");
  }
  if (confidence == null || confidence < CONFIDENCE_CUTOFF) return notSure("low_confidence");
  const parts = readCoatValue({ colours });
  // Every storable set of old codes translates; a set that says nothing
  // (none can, today) is Not sure rather than an empty reading.
  if (!parts || parts.notSure || (parts.colours === null && parts.pattern === null)) return notSure("colours");
  return { colours, parts, raw };
}

/** The JSON object in a model reply, or null. */
function parseReply(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

class ReadTimeout extends Error {}

/**
 * Read one photo's coat colour. One call with one image; never throws.
 * `timeoutMs` is for tests.
 */
export async function readCoatFromPhoto(
  photo: { data: string; mime: string },
  opts: { timeoutMs?: number } = {},
): Promise<CoatReadResult> {
  const timeoutMs = opts.timeoutMs ?? READ_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = openai.chat.completions.create(
      {
        model: VISION_MODEL,
        // The matcher's allowance for the same model: a reasoning model can
        // spend hidden tokens before it answers, and a cut-off answer would
        // fail every call.
        max_completion_tokens: 8192,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: coatPrompt() },
              { type: "image_url", image_url: { url: `data:${photo.mime};base64,${photo.data}` } },
            ],
          },
        ],
      },
      // No silent retries: the client would otherwise retry up to twice, so
      // one counted attempt could be three paid calls. The budgets (R6, R7)
      // are the retry policy.
      { timeout: timeoutMs, maxRetries: 0 },
    );
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ReadTimeout()), timeoutMs);
    });
    const response = await Promise.race([call, timeout]);
    const answer = parseReply(response.choices[0]?.message?.content ?? "");
    if (!answer) return { kind: "failed", reason: "unparseable" };
    return { kind: "reading", ...interpretCoatAnswer(answer) };
  } catch (err) {
    // The client's own timeout throws its own error; either is a timeout.
    const timedOut =
      err instanceof ReadTimeout || (err instanceof Error && /timeout|timed out/i.test(`${err.name} ${err.message}`));
    return { kind: "failed", reason: timedOut ? "timeout" : "error" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
