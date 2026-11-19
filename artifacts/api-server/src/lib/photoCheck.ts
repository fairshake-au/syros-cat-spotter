// SYC-866: the photo check that asks "is this a cat?" neutrally and can say
// "not sure". Not wired in yet; matching.ts will call these.
import type { NewPhotoInput, MatchOutput } from "./matching";

export type CatCheck = "cat" | "not_cat" | "unsure";

export const CAT_PARTS = ["face", "eyes", "ears", "whiskers", "tail", "paws", "fur"] as const;

const STRONG_PARTS = new Set<string>(["face", "eyes", "ears", "tail"]);
const PHOTO_SEEN_MAX = 120;

const roleName = (r: NewPhotoInput["role"]) =>
  r === "first" ? "first photo" : r === "face" ? "face close-up" : "whole body";

/** A cat needs one of face/eyes/ears/tail, or whiskers plus another part. Fur and paws alone never do. */
export function enoughCatParts(parts: unknown): boolean {
  if (!Array.isArray(parts)) return false;
  const seen = new Set<string>();
  for (const p of parts) {
    if (typeof p !== "string") continue;
    const name = p.trim().toLowerCase();
    if ((CAT_PARTS as readonly string[]).includes(name)) seen.add(name);
  }
  if ([...seen].some((p) => STRONG_PARTS.has(p))) return true;
  // Two other parts count, but fur and paws alone don't: a fuzzy sock has both.
  return seen.has("whiskers") && seen.size >= 2;
}

export function buildCheckPrompt(opts: {
  photos: NewPhotoInput[];
  candidates: { catId: number; name: string }[];
}): string {
  const { photos, candidates } = opts;
  const n = photos.length;
  const many = n > 1;
  const newDesc = many
    ? `The FIRST ${n} images are newly submitted photos that should all show the SAME cat from different angles (${photos
        .map((p, i) => `image ${i + 1} = ${roleName(p.role)}`)
        .join(", ")}).`
    : `The FIRST image is a newly submitted photo.`;

  let text =
    `${newDesc} Look at ${many ? "them" : "it"} and say what ${many ? "they show" : "it shows"}, which parts of a cat you can actually see, and whether ${many ? "any photo shows" : "it shows"} a cat.\n\n` +
    `Respond with ONLY valid JSON, no markdown, with the keys in this order: ` +
    `{"photoSeen": string, "catPartsSeen": string[], "catCheck": "cat" | "not_cat" | "unsure", "mixedCats": boolean, "matches": [{"catId": number, "confidence": number, "reasoning": "one short sentence"}]}\n\n` +
    `- "photoSeen": what ${many ? "the first photo shows" : "the photo shows"}, in a few words (for example "a black sock on a wooden floor"). Describe animals and objects only. Never describe people, faces, text, signs, house numbers or number plates.\n` +
    `- "catPartsSeen": the cat parts you can actually see, only from this list: ${CAT_PARTS.join(", ")}. Leave out any you cannot see.\n` +
    `- "catCheck": "cat" if at least one of face, eyes, ears or tail is visible, or two other parts are. Fur alone, or fur and paws alone, is not enough: a fuzzy sock has fur. "not_cat" if what is shown is clearly something else. "unsure" for everything in between: too dark, too blurry, too far away, or a shape that could be a cat.\n` +
    (many
      ? `- With several photos: "cat" if any photo clearly shows a cat. "not_cat" only if every photo clearly shows something else. Otherwise "unsure".\n` +
        `- "mixedCats": true if the new photos appear to show MORE THAN ONE different cat.\n`
      : `- "mixedCats": false for a single photo.\n`);

  if (candidates.length > 0) {
    const known = candidates
      .map((c, i) => `image ${i + n + 1} = cat id ${c.catId} ("${c.name}")`)
      .join(", ");
    text +=
      `\nMatching: you are also an expert at identifying individual street cats by their coat pattern, colors, markings, face shape, eye color and other distinctive physical features. ` +
      `The following ${candidates.length} images are known cats, in order: ${known}. ` +
      `For each known cat, assess the likelihood (0.0-1.0) that it is the SAME individual cat as in the new photo${many ? "s. Use every new photo together." : "."} ` +
      `Judge only by physical appearance; lighting, pose and background differ between photos. Include every known cat in "matches".\n`;
  } else {
    text += `\nReturn an empty "matches" array.\n`;
  }
  return text;
}

// A model sometimes sends a yes/no as the string "true"; reading that as
// "no" would call a real cat "not a cat" (review of #212).
const yes = (v: unknown) => v === true || v === "true";

export function readCheckAnswer(
  raw: string,
  many: boolean,
): { catCheck: CatCheck; photoSeen: string | null; mixedCats: boolean; matches: MatchOutput["matches"] } {
  const jsonText = raw.replace(/```json|```/g, "").trim();
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("AI matching returned unparseable output");
  }
  const parsed = JSON.parse(jsonText.slice(start, end + 1)) as {
    catCheck?: unknown;
    catPartsSeen?: unknown;
    photoSeen?: unknown;
    anyCat?: unknown;
    isCatPhoto?: unknown;
    mixedCats?: unknown;
    matches?: unknown;
  };

  let catCheck: CatCheck;
  if (parsed.catCheck !== undefined && parsed.catCheck !== null) {
    const word = String(parsed.catCheck).trim().toLowerCase();
    catCheck = word === "cat" ? "cat" : word === "not_cat" ? "not_cat" : "unsure";
    // The server double-check: "cat" needs enough parts to be believed.
    if (catCheck === "cat" && !enoughCatParts(parsed.catPartsSeen)) catCheck = "unsure";
  } else {
    // Old shape: anyCat, or isCatPhoto if that's missing; no parts check.
    catCheck = yes(parsed.anyCat !== undefined ? parsed.anyCat : parsed.isCatPhoto)
      ? "cat"
      : "not_cat";
  }

  const photoSeen =
    typeof parsed.photoSeen === "string" && parsed.photoSeen.trim() !== ""
      ? parsed.photoSeen.trim().slice(0, PHOTO_SEEN_MAX)
      : null;

  return {
    catCheck,
    photoSeen,
    // One photo can't show two cats, whatever the model says.
    mixedCats: many && yes(parsed.mixedCats),
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
