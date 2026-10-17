import { openai } from "@workspace/integrations-openai-ai-server";
import { COAT_COLOURS, COAT_PATTERNS, orderColours, type CoatColour, type CoatParts, type CoatPattern } from "../appearance";
import { VISION_MODEL } from "../visionModel";

/**
 * The colour reader (SYC-161 plan, PR 1; rule R5). Looks at ONE photo of one
 * cat and says its coat as two parts (coat-colours-and-pattern.md §7): every
 * colour it can see from the five, and the pattern from the three, or Not
 * sure. It asks about the coat only: never sex, age, ears or health (spec
 * §4.7 of choose-a-different-cat.md).
 *
 * One model call, one image. It never throws: a failed call (an error, a
 * timeout, output that isn't JSON) comes back as `failed`, and the caller
 * writes nothing (R6), so the photo can be tried again later.
 */

/**
 * The version written on every reading (`value.modelVersion`). A change to
 * the prompt below bumps the version, so readings from different prompts can
 * be told apart (SYC-56), and a manual re-read (`reread`, SYC-398 §7) knows
 * which cats were read by an older one. coat-v2 is SYC-398 PR C (absorbs
 * SYC-397).
 */
export const MODEL_VERSION = `${VISION_MODEL}/coat-v2`;

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
 * What each colour means, for the prompt (spec §2 and §7, in plain words).
 * None of these, nor the pattern descriptions, names a breeders' coat
 * (tabby, tortoiseshell, calico): the answers are the codes themselves, and
 * an old code in an answer is Not sure.
 */
const COLOUR_DESCRIPTIONS: Record<CoatColour, string> = {
  black: "black",
  grey: "grey (what breeders call blue)",
  brown: "warm brown, sandy or golden-brown. A warm sandy brown is brown, not ginger",
  ginger: "ginger, orange or cream",
  white: "white, when you can see it as part of the coat",
};

const PATTERN_DESCRIPTIONS: Record<CoatPattern, string> = {
  plain: "one colour all over, perhaps with a small white bib, socks or face",
  stripes: "stripes, swirls or spots",
  patches:
    "any patchy look: a patchwork of colours, including black and white or ginger and white in patches. " +
    "Any patchy look is patches, never stripes; a coat that is both striped and patchy is patches",
};

/** The pattern answer when the model can't tell it; the colours still stand. */
const CANT_TELL = "cant_tell";

/** The prompt. Exported for T-prompt only. */
export function coatPrompt(): string {
  const colours = COAT_COLOURS.map((c) => `  ${c}: ${COLOUR_DESCRIPTIONS[c]}`).join("\n");
  const patterns = COAT_PATTERNS.map((p) => `  ${p}: ${PATTERN_DESCRIPTIONS[p]}`).join("\n");
  return (
    `This is a photo of a street cat. Say what its coat looks like, and nothing else about the cat.\n\n` +
    `Respond with ONLY valid JSON, no markdown:\n` +
    `{"catCount": number, "photoClear": boolean, "colours": string[], "pattern": string, "confidence": number}\n\n` +
    `- catCount: how many cats you can see in the photo.\n` +
    `- photoClear: false if the photo is too dark, blurred or far away to judge the coat.\n` +
    `- colours: every colour you can see in the coat, from this list:\n${colours}\n` +
    `  List each colour once. Use [] if you can't tell the colours.\n` +
    `- pattern: one code from this list:\n${patterns}\n` +
    `  Use "${CANT_TELL}" if you can't tell the pattern.\n` +
    `- confidence: from 0.0 to 1.0, how sure you are of the coat.`
  );
}

/** Why a reading came out Not sure. */
export type NotSureReason =
  | "cat_count"
  | "not_clear"
  | "colours"
  | "pattern"
  | "model_not_sure"
  | "low_confidence";

/** The model's own answer, kept in the team-only `suggestedValue`. */
export interface RawCoatAnswer {
  colours: string[];
  /** The pattern as the model gave it (`cant_tell` included), or null. */
  pattern: string | null;
  confidence: number | null;
  catCount: number | null;
  photoClear: boolean | null;
  /** Set when the reading is Not sure. */
  notSureBecause?: NotSureReason;
}

export type CoatReadResult =
  | { kind: "reading"; parts: CoatParts; raw: RawCoatAnswer }
  | { kind: "failed"; reason: "error" | "timeout" | "unparseable" };

const COLOUR_SET: ReadonlySet<string> = new Set(COAT_COLOURS);
const PATTERN_SET: ReadonlySet<string> = new Set(COAT_PATTERNS);

/**
 * R5, pure: the coat the model gave, as its two parts (spec §7), which is
 * what is written. Not sure (`notSure`) unless the model saw exactly one
 * cat, said the photo is clear, gave one or more of the five colours (an old
 * code such as `tabby`, or any unknown code, is Not sure), gave one of the
 * three patterns or `cant_tell`, and was at least {@link CONFIDENCE_CUTOFF}
 * sure. `cant_tell` leaves the pattern not known while the colours stand.
 */
export function interpretCoatAnswer(answer: Record<string, unknown>): { parts: CoatParts; raw: RawCoatAnswer } {
  const given = Array.isArray(answer["colours"])
    ? answer["colours"].filter((c): c is string => typeof c === "string")
    : [];
  const confidence =
    typeof answer["confidence"] === "number" && Number.isFinite(answer["confidence"])
      ? answer["confidence"]
      : null;
  const catCount = typeof answer["catCount"] === "number" ? answer["catCount"] : null;
  const photoClear = typeof answer["photoClear"] === "boolean" ? answer["photoClear"] : null;
  const pattern = typeof answer["pattern"] === "string" ? answer["pattern"] : null;
  const raw: RawCoatAnswer = { colours: given, pattern, confidence, catCount, photoClear };
  const notSure = (because: NotSureReason) => ({
    parts: { colours: null, pattern: null, notSure: true },
    raw: { ...raw, notSureBecause: because },
  });

  if (catCount !== 1) return notSure("cat_count");
  if (photoClear !== true) return notSure("not_clear");

  const list = answer["colours"];
  if (!Array.isArray(list) || list.some((c) => typeof c !== "string")) return notSure("colours");
  if (list.length === 0) return notSure("model_not_sure");
  if (!(list as string[]).every((c) => COLOUR_SET.has(c))) return notSure("colours");
  if (pattern === null || (pattern !== CANT_TELL && !PATTERN_SET.has(pattern))) return notSure("pattern");
  if (confidence == null || confidence < CONFIDENCE_CUTOFF) return notSure("low_confidence");
  return {
    parts: {
      colours: orderColours(list as string[]),
      pattern: pattern === CANT_TELL ? null : (pattern as CoatPattern),
      notSure: false,
    },
    raw,
  };
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
