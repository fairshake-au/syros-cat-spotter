// SYC-866: the photo check that asks "is this a cat?" neutrally and can say
// "not sure". Not wired in yet; matching.ts will call these.
import {
  describeKnownCats,
  describeNewPhotos,
  normaliseMatches,
  parseModelJson,
  yes,
  type MatchOutput,
  type NewPhotoInput,
} from "./matching";

export type CatCheck = "cat" | "not_cat" | "unsure";

export const CAT_PARTS = ["face", "eyes", "ears", "whiskers", "tail", "paws", "fur"] as const;

const STRONG_PARTS = ["face", "eyes", "ears", "tail"];
const PHOTO_SEEN_MAX = 120;

/** A cat needs one of face/eyes/ears/tail, or whiskers plus another part. Fur and paws alone never do. */
export function enoughCatParts(parts: unknown): boolean {
  if (!Array.isArray(parts)) return false;
  const seen = new Set<string>();
  for (const p of parts) {
    const name = typeof p === "string" ? p.trim().toLowerCase() : "";
    if ((CAT_PARTS as readonly string[]).includes(name)) seen.add(name);
  }
  if (STRONG_PARTS.some((p) => seen.has(p))) return true;
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
  const newDesc = describeNewPhotos(photos);

  let text =
    `${newDesc} Look at ${many ? "them" : "it"} and say what ${many ? "they show" : "it shows"}, which parts of a cat you can actually see, and whether ${many ? "any photo shows" : "it shows"} a cat.\n\n` +
    `Respond with ONLY valid JSON, no markdown, with the keys in this order: ` +
    `{"photoSeen": string, "catPartsSeen": string[], "catCheck": "cat" | "not_cat" | "unsure", "mixedCats": boolean, "matches": [{"catId": number, "confidence": number, "reasoning": "one short sentence"}]}\n\n` +
    `- "photoSeen": what ${many ? "the first photo shows" : "the photo shows"}, in a few words (for example "a black sock on a wooden floor"). Describe animals and objects only. Never describe people, faces, text, signs, house numbers or number plates.\n` +
    `- "catPartsSeen": the cat parts you can clearly make out, only from this list: ${CAT_PARTS.join(", ")}. List a part only if you can clearly make it out; do not guess a part from a shape. Leave out any you cannot clearly see.${many ? ` With several photos, list the parts clearly visible in the ONE photo that best shows a cat, not a combined list across photos.` : ``}\n` +
    `- "catCheck": "cat" only if you can clearly see at least one of face, eyes, ears or tail, or two other parts. Fur alone, or fur and paws alone, is not enough: a fuzzy sock has fur. "not_cat" if what is shown is clearly something else. "unsure" for everything in between: too dark, too blurry, too far away, or a shape that could be a cat. If in doubt between cat and unsure, choose unsure.\n` +
    (many
      ? `- With several photos: "cat" if any photo clearly shows a cat. "not_cat" only if every photo clearly shows something else. Otherwise "unsure".\n` +
        `- "mixedCats": true if the new photos appear to show MORE THAN ONE different cat.\n`
      : `- "mixedCats": false for a single photo.\n`);

  if (candidates.length > 0) {
    const known = describeKnownCats(n, candidates);
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

export function readCheckAnswer(
  raw: string,
  many: boolean,
): { catCheck: CatCheck; photoSeen: string | null; mixedCats: boolean; matches: MatchOutput["matches"] } {
  const parsed = parseModelJson(raw);

  let catCheck: CatCheck;
  if (parsed.catCheck !== undefined && parsed.catCheck !== null) {
    // A catCheck that isn't a word (e.g. ["cat"]) is present but unknown.
    const word = typeof parsed.catCheck === "string" ? parsed.catCheck.trim().toLowerCase() : "";
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
    matches: normaliseMatches(parsed.matches),
  };
}
