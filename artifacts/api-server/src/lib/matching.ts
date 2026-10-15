import { openai } from "@workspace/integrations-openai-ai-server";
import { VISION_MODEL } from "./visionModel";

export interface CandidateInput {
  catId: number;
  name: string;
  photoBase64: string;
  mime: string;
}

export interface MatchOutput {
  isCatPhoto: boolean;
  matches: { catId: number; confidence: number; reasoning: string }[];
}

/**
 * Compare a newly submitted cat photo against candidate cats using AI vision.
 * Returns ranked matches with a 0-1 confidence each.
 */
export async function matchCatPhoto(
  newPhotoBase64: string,
  candidates: CandidateInput[],
): Promise<MatchOutput> {
  const content: any[] = [
    {
      type: "text",
      text:
        `You are an expert at identifying individual street cats by their coat pattern, colors, markings, face shape, eye color and other distinctive physical features.\n\n` +
        `The FIRST image is a newly submitted photo. The following ${candidates.length} images are known cats, in order: ` +
        candidates.map((c, i) => `image ${i + 2} = cat id ${c.catId} ("${c.name}")`).join(", ") +
        `.\n\nTasks:\n1. Determine if the first image actually contains a cat.\n2. For each known cat, assess the likelihood (0.0-1.0) that it is the SAME individual cat as in the new photo. Judge only by physical appearance; lighting, pose and background differ between photos.\n\n` +
        `Respond with ONLY valid JSON, no markdown: {"isCatPhoto": boolean, "matches": [{"catId": number, "confidence": number, "reasoning": "one short sentence"}]}. Include every known cat in "matches". If there are no known cats, return an empty matches array.`,
    },
    {
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${newPhotoBase64}` },
    },
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
  const parsed = JSON.parse(jsonText.slice(start, end + 1)) as MatchOutput;
  return {
    isCatPhoto: !!parsed.isCatPhoto,
    matches: Array.isArray(parsed.matches)
      ? parsed.matches
          .filter((m) => typeof m.catId === "number")
          .map((m) => ({
            catId: m.catId,
            confidence: Math.max(0, Math.min(1, Number(m.confidence) || 0)),
            reasoning: String(m.reasoning ?? ""),
          }))
      : [],
  };
}
