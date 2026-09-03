import { openai } from "@workspace/integrations-openai-ai-server";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  el: "Greek",
  fr: "French",
};

/**
 * Generate playful cat name ideas in the given language via AI, excluding
 * any names already in use (case-insensitive).
 */
export async function suggestCatNames(
  language: "en" | "el" | "fr",
  takenNames: string[],
  excludeNames: string[] = [],
  count = 5,
): Promise<string[]> {
  const unavailable = new Set(
    [...takenNames, ...excludeNames]
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n.length > 0),
  );
  const excludedNames = [
    ...new Set([...takenNames, ...excludeNames].map((n) => n.trim())),
  ].filter((n) => n.length > 0);

  const response = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    max_completion_tokens: 2048,
    messages: [
      {
        role: "user",
        content:
          `Suggest ${count * 2} fun, playful, family-friendly names for a street cat on the Greek island of Syros. ` +
          `The names must be in ${LANGUAGE_NAMES[language]}. Each name must be short (1-2 words, max 25 characters), charming and varied in style.\n` +
          (excludedNames.length > 0
            ? `Do NOT use any of these unavailable names (or trivial variations of them): ${excludedNames.join(", ")}.\n`
            : "") +
          `Respond with ONLY valid JSON, no markdown: {"names": ["...", "..."]}`,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "";
  const jsonText = raw.replace(/```json|```/g, "").trim();
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Name suggestion returned unparseable output");
  }
  const parsed = JSON.parse(jsonText.slice(start, end + 1)) as {
    names?: unknown;
  };
  const names = Array.isArray(parsed.names)
    ? parsed.names
        .filter((n): n is string => typeof n === "string")
        .map((n) => n.trim().slice(0, 40))
        .filter((n) => n.length > 0 && !unavailable.has(n.toLowerCase()))
    : [];

  // Dedupe case-insensitively and cap the list.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const n of names) {
    const key = n.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(n);
    }
    if (unique.length >= count) break;
  }
  return unique;
}
