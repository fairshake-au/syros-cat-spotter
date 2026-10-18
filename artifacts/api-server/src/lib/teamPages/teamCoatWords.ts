import { COAT_COLOURS, COAT_PATTERNS, type CoatColour, type CoatPattern } from "../appearance";
import { LIVE_LANGUAGES, pageLanguage, tr, type Language, type StringKey } from "./strings";

// The team's words for a coat (coat-colours-and-pattern.md §15, SYC-443):
// "Ginger tabby", "Calico", Solid / Tabby / Patched. Every team page that says
// a coat calls these, so the wording lives in one place, and nothing else
// builds a team coat phrase. Never imported by the public routes or by what
// the public sees (teamCoatWords.guard.source.test.ts): the public keeps §2's
// words, "Ginger · Stripes".
//
// English only (Decision T4A). The phrases are English constants, not
// catalogue keys: a team page in Greek or French says the coat in §2's words,
// which Johnny already has. Worked out each time a page is drawn; nothing
// stored changes.

/** A coat's two parts. Colours null or [] mean not known; pattern null means not known. */
export interface TeamCoat {
  colours: readonly string[] | null;
  pattern: string | null;
}

/** "known" for the cat as a whole; "stated" for one statement ("…, pattern not stated"). */
export type CoatGap = "known" | "stated";

const PATTERN_WORD: Record<CoatPattern, string> = {
  plain: "Solid",
  stripes: "Tabby",
  patches: "Patched",
};

/** The team's word for a pattern on its own (§15.2): Solid, Tabby, Patched or Not known. */
export function teamPatternWord(pattern: string | null): string {
  return (COAT_PATTERNS as readonly string[]).includes(pattern ?? "") ? PATTERN_WORD[pattern as CoatPattern] : "Not known";
}

/**
 * The Correct form's pattern buttons (Decision T3A), each with its hint, and
 * Not stated. The codes they post are unchanged: plain, stripes, patches, none.
 */
export const TEAM_PATTERN_LABELS: Record<CoatPattern | "none", string> = {
  plain: "Solid (one colour all over, maybe a little white)",
  stripes: "Tabby (stripes, swirls or spots)",
  patches: "Patched (tortoiseshell, calico, black and white…)",
  none: "Not stated",
};

/** The coat's parts, kept to the vocabulary, colours in §2's order (as coatDrawing.ts). */
function known(coat: TeamCoat): { colours: CoatColour[]; pattern: CoatPattern | null } {
  const said = new Set(coat.colours ?? []);
  const colours = COAT_COLOURS.filter((c) => said.has(c));
  const pattern = (COAT_PATTERNS as readonly string[]).includes(coat.pattern ?? "") ? (coat.pattern as CoatPattern) : null;
  return { colours, pattern };
}

/** True when neither part is known: colours null or [], and pattern null. */
export function coatIsUnknown(coat: TeamCoat): boolean {
  const { colours, pattern } = known(coat);
  return colours.length === 0 && pattern === null;
}

/** "black, grey and white": commas, then a final "and". */
function listed(colours: readonly string[]): string {
  return colours.length <= 1 ? (colours[0] ?? "") : `${colours.slice(0, -1).join(", ")} and ${colours[colours.length - 1]}`;
}

/** Only the first word has a capital: "Black, grey and white". */
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The whole coat in one phrase (§15.2; every one of the 128 is in §15.6). A
 * part nobody has said is said out loud: ", pattern not known", or "not
 * stated" for one statement. Only Black with Ginger in patches makes
 * Tortoiseshell or Calico (T5A); Black and Ginger stripes are "Black and
 * ginger tabby" (T6A).
 */
export function teamCoatPhrase(coat: TeamCoat, gap: CoatGap = "known"): string {
  const { colours, pattern } = known(coat);
  const missing = gap === "stated" ? "not stated" : "not known";
  if (colours.length === 0) {
    return pattern === null ? capital(missing) : `${teamPatternWord(pattern)}, colours ${missing}`;
  }
  const all = listed(colours);
  if (pattern === null) return capital(`${all}, pattern ${missing}`);
  const main = colours.filter((c) => c !== "white");
  const white = colours.includes("white");
  switch (pattern) {
    case "stripes":
      return main.length === 0 ? "White tabby" : capital(`${listed(main)} tabby${white ? " with white" : ""}`);
    case "patches":
      if (colours.includes("black") && colours.includes("ginger")) return white ? "Calico" : "Tortoiseshell";
      return capital(white && main.length > 0 ? all : `${all}, patched`);
    case "plain":
      return capital(main.length <= 1 ? all : `${all}, solid`);
  }
}

/**
 * The one entry point pages call. In English, the team phrase; in any other
 * language the page is drawn in (`live` widens the languages switched on),
 * §2's words joined with " · ", each unknown part said as the drawn cat's
 * caption says it.
 */
export function coatWordsFor(
  lang: string | null | undefined,
  coat: TeamCoat,
  opts: { gap?: CoatGap; live?: readonly Language[] } = {},
): string {
  const live = opts.live ?? LIVE_LANGUAGES;
  if (pageLanguage(lang, live) === "en") return teamCoatPhrase(coat, opts.gap);
  const { colours, pattern } = known(coat);
  if (colours.length === 0 && pattern === null) return tr(lang, "appearance.notKnown", undefined, live);
  return [
    ...(colours.length
      ? colours.map((c) => tr(lang, `coat.${c}` as StringKey, undefined, live))
      : [tr(lang, "appearance.drawnColoursNotKnown", undefined, live)]),
    pattern ? tr(lang, `pattern.${pattern}` as StringKey, undefined, live) : tr(lang, "appearance.drawnPatternNotKnown", undefined, live),
  ].join(" · ");
}
