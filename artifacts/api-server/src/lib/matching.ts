import { openai } from "@workspace/integrations-openai-ai-server";
import { VISION_MODEL } from "./visionModel";

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

const roleName = (r: NewPhotoInput["role"]) =>
  r === "first" ? "first photo" : r === "face" ? "face close-up" : "whole body";

/**
 * Compare a spot's photos against candidate cats using AI vision. Returns
 * ranked matches with a 0-1 confidence each. All of the spot's photos go
 * first, told they show the same cat (SYC-415 spec §5.2); a plain string is
 * one first photo, as before.
 */
export async function matchCatPhoto(
  newPhotos: NewPhotoInput[] | string,
  candidates: CandidateInput[],
): Promise<MatchOutput> {
  const photos: NewPhotoInput[] =
    typeof newPhotos === "string"
      ? [{ role: "first", photoBase64: newPhotos, mime: "image/jpeg" }]
      : newPhotos;
  const n = photos.length;
  const many = n > 1;
  const newDesc = many
    ? `The FIRST ${n} images are newly submitted photos that should all show the SAME cat from different angles (${photos
        .map((p, i) => `image ${i + 1} = ${roleName(p.role)}`)
        .join(", ")}).`
    : `The FIRST image is a newly submitted photo.`;
  const known = candidates
    .map((c, i) => `image ${i + n + 1} = cat id ${c.catId} ("${c.name}")`)
    .join(", ");
  const text =
    `You are an expert at identifying individual street cats by their coat pattern, colors, markings, face shape, eye color and other distinctive physical features.\n\n` +
    `${newDesc} The following ${candidates.length} images are known cats, in order: ${known}.\n\n` +
    `Tasks:\n1. Determine if ${many ? "ANY of the new photos contains" : "the first image actually contains"} a cat.\n` +
    (many ? `2. Determine if the new photos appear to show MORE THAN ONE different cat.\n` : ``) +
    `${many ? 3 : 2}. For each known cat, assess the likelihood (0.0-1.0) that it is the SAME individual cat as in the new photo${many ? "s. Use every new photo together." : "."} Judge only by physical appearance; lighting, pose and background differ between photos.\n\n` +
    `Respond with ONLY valid JSON, no markdown: {"anyCat": boolean, "mixedCats": boolean, "matches": [{"catId": number, "confidence": number, "reasoning": "one short sentence"}]}. Include every known cat in "matches". If there are no known cats, return an empty matches array.`;
  const content: any[] = [
    { type: "text", text },
    ...photos.map((p) => ({
      type: "image_url",
      image_url: { url: `data:${p.mime};base64,${p.photoBase64}` },
    })),
    ...candidates.map((c) => ({
      type: "image_url",
      image_url: { url: `data:${c.mime};base64,${c.photoBase64}` },
    })),
  ];

  const response = await openai.chat.completions.create({
    model: VISION_MODEL,
    max_completion_tokens: 8192,
    messages: [{ role: "user", content }],
  });

  const raw = response.choices[0]?.message?.content ?? "";
  const jsonText = raw.replace(/```json|```/g, "").trim();
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("AI matching returned unparseable output");
  }
  const parsed = JSON.parse(jsonText.slice(start, end + 1)) as {
    anyCat?: unknown;
    isCatPhoto?: unknown;
    mixedCats?: unknown;
    matches?: unknown;
  };
  return {
    // The new shape says "anyCat"; an answer in the old shape still works.
    isCatPhoto:
      typeof parsed.anyCat === "boolean" ? parsed.anyCat : !!parsed.isCatPhoto,
    // One photo can't show two cats, whatever the model says.
    mixedCats: many && parsed.mixedCats === true,
    matches: Array.isArray(parsed.matches)
      ? (parsed.matches as { catId: unknown; confidence: unknown; reasoning: unknown }[])
          .filter((m): m is { catId: number; confidence: unknown; reasoning: unknown } =>
            typeof m?.catId === "number",
          )
          .map((m) => ({
            catId: m.catId,
            confidence: Math.max(0, Math.min(1, Number(m.confidence) || 0)),
            reasoning: String(m.reasoning ?? ""),
          }))
      : [],
  };
}
