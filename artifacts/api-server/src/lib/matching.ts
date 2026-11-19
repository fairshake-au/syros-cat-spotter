import { openai } from "@workspace/integrations-openai-ai-server";
import { VISION_MODEL } from "./visionModel";
import { logger } from "./logger";
import { logAiUsage, type AiCaller } from "./aiUsage";

/**
 * SYC-503 D3 (Samuel, 21 Oct 2026): each try at the look-alike check is cut
 * off after 30 seconds. The library's own default was 10 minutes with two
 * silent retries, so a stuck service could keep a spotter on "Checking…"
 * for a very long time.
 */
export const MATCH_TIMEOUT_MS = 30_000;
/** A failure faster than this was "couldn't connect" or a server error, never a timeout. */
export const QUICK_FAILURE_MS = 5_000;

/**
 * Retry once only when the failure was quick: the service couldn't be
 * reached, or answered with a server error. Never after a timeout (that
 * would double the wait) and never on a 4xx (asking again won't help).
 */
export function isQuickRetryable(err: unknown, elapsedMs: number): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status < 500) return false;
  return elapsedMs < QUICK_FAILURE_MS;
}

export interface CandidateInput {
  catId: number;
  name: string;
  photoBase64: string;
  mime: string;
}

/** One of the spot's own photos (SYC-415 spec §5.2), in the order taken. */
export interface NewPhotoInput {
  role: "first" | "face" | "body";
  photoBase64: string;
  mime: string;
}

export interface MatchOutput {
  /** Any of the spot's photos shows a cat. */
  isCatPhoto: boolean;
  /** SYC-415 §4.5: the spot's photos look like more than one cat. Always
   * false for one photo. Optional because older test mocks return only
   * { isCatPhoto, matches }. */
  mixedCats?: boolean;
  matches: { catId: number; confidence: number; reasoning: string }[];
}

export const roleName = (r: NewPhotoInput["role"]) =>
  r === "first" ? "first photo" : r === "face" ? "face close-up" : "whole body";

// A model sometimes sends a yes/no as the string "true"; reading that as
// "no" would call a real cat "not a cat" (review of #212).
export const yes = (v: unknown) => v === true || v === "true";

/** The line that says which images are the spot's own photos. */
export function describeNewPhotos(photos: readonly NewPhotoInput[]): string {
  const n = photos.length;
  return n > 1
    ? `The FIRST ${n} images are newly submitted photos that should all show the SAME cat from different angles (${photos
        .map((p, i) => `image ${i + 1} = ${roleName(p.role)}`)
        .join(", ")}).`
    : `The FIRST image is a newly submitted photo.`;
}

/** "image N = cat id X (name)" for each known cat, numbered after the spot's `n` photos. */
export function describeKnownCats(n: number, candidates: readonly { catId: number; name: string }[]): string {
  return candidates.map((c, i) => `image ${i + n + 1} = cat id ${c.catId} ("${c.name}")`).join(", ");
}

/** The model's matches, as the app reads them: only numeric cat ids, confidence held to 0-1. */
export function normaliseMatches(raw: unknown): MatchOutput["matches"] {
  if (!Array.isArray(raw)) return [];
  return (raw as { catId: unknown; confidence: unknown; reasoning: unknown }[])
    .filter((m): m is { catId: number; confidence: unknown; reasoning: unknown } => typeof m?.catId === "number")
    .map((m) => ({
      catId: m.catId,
      confidence: Math.max(0, Math.min(1, Number(m.confidence) || 0)),
      reasoning: String(m.reasoning ?? ""),
    }));
}

/** The JSON object in a model's reply, fences and chatter around it ignored. */
export function parseModelJson(raw: string): Record<string, unknown> {
  const jsonText = raw.replace(/```json|```/g, "").trim();
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("AI matching returned unparseable output");
  }
  return JSON.parse(jsonText.slice(start, end + 1)) as Record<string, unknown>;
}

/** One vision call: the text, then the images in order. The caller reads the reply. */
export function callVision(text: string, images: readonly { mime: string; base64: string }[]) {
  const content: any[] = [
    { type: "text", text },
    ...images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.base64}` } })),
  ];
  return openai.chat.completions.create(
    {
      model: VISION_MODEL,
      max_completion_tokens: 8192,
      messages: [{ role: "user", content }],
    },
    { timeout: MATCH_TIMEOUT_MS, maxRetries: 0 },
  );
}

/**
 * Compare a spot's photos against candidate cats using AI vision. Returns
 * ranked matches with a 0-1 confidence each. All of the spot's photos go
 * first, told they show the same cat (SYC-415 spec §5.2); a plain string is
 * one first photo, as before.
 */
export async function matchCatPhoto(
  newPhotos: NewPhotoInput[] | string,
  candidates: CandidateInput[],
  caller: Extract<AiCaller, "sighting_match" | "find_from_photo">,
): Promise<MatchOutput> {
  const photos: NewPhotoInput[] =
    typeof newPhotos === "string"
      ? [{ role: "first", photoBase64: newPhotos, mime: "image/jpeg" }]
      : newPhotos;
  const n = photos.length;
  const many = n > 1;
  const newDesc = describeNewPhotos(photos);
  const known = describeKnownCats(n, candidates);
  const text =
    `You are an expert at identifying individual street cats by their coat pattern, colors, markings, face shape, eye color and other distinctive physical features.\n\n` +
    `${newDesc} The following ${candidates.length} images are known cats, in order: ${known}.\n\n` +
    `Tasks:\n1. Determine if ${many ? "ANY of the new photos contains" : "the first image actually contains"} a cat.\n` +
    (many ? `2. Determine if the new photos appear to show MORE THAN ONE different cat.\n` : ``) +
    `${many ? 3 : 2}. For each known cat, assess the likelihood (0.0-1.0) that it is the SAME individual cat as in the new photo${many ? "s. Use every new photo together." : "."} Judge only by physical appearance; lighting, pose and background differ between photos.\n\n` +
    `Respond with ONLY valid JSON, no markdown: {"anyCat": boolean, "mixedCats": boolean, "matches": [{"catId": number, "confidence": number, "reasoning": "one short sentence"}]}. Include every known cat in "matches". If there are no known cats, return an empty matches array.`;
  const call = () =>
    callVision(text, [
      ...photos.map((p) => ({ mime: p.mime, base64: p.photoBase64 })),
      ...candidates.map((c) => ({ mime: c.mime, base64: c.photoBase64 })),
    ]);
  // How long checks take, and how often they time out, is logged so the
  // 30-second limit can be tuned (spec D3).
  const started = Date.now();
  let attempts = 1;
  let response: Awaited<ReturnType<typeof call>>;
  try {
    try {
      response = await call();
    } catch (err) {
      if (!isQuickRetryable(err, Date.now() - started)) throw err;
      attempts = 2;
      response = await call();
    }
  } catch (err) {
    const durationMs = Date.now() - started;
    logger.warn(
      { durationMs, attempts, timedOut: durationMs >= MATCH_TIMEOUT_MS * 0.95 },
      "look-alike check failed",
    );
    throw err;
  }
  logger.info({ durationMs: Date.now() - started, attempts }, "look-alike check answered");
  logAiUsage(caller, response.usage);

  const raw = response.choices[0]?.message?.content ?? "";
  const parsed = parseModelJson(raw);
  return {
    // The new shape says "anyCat"; an answer in the old shape still works.
    isCatPhoto: yes(parsed.anyCat !== undefined ? parsed.anyCat : parsed.isCatPhoto),
    // One photo can't show two cats, whatever the model says.
    mixedCats: many && yes(parsed.mixedCats),
    matches: normaliseMatches(parsed.matches),
  };
}
