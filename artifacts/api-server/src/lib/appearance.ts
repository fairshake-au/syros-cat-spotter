/**
 * The appearance vocabulary (coat-colours-and-pattern.md §2,
 * coat-markings-and-health.md §3.2) and the one translation of a stored
 * coat. Pure: no database import, so the resolver (`resolve.ts`) and every
 * writer (`observations.ts` re-exports these) share
 * the single definition. Nothing else may define these lists.
 */
/**
 * The coat vocabulary (coat-colours-and-pattern.md §2, SYC-398): a coat is
 * any of five colours, with no limit, plus one pattern. Display order is
 * the order below. The only definitions: nothing else may list them.
 */
export const COAT_COLOURS = ["black", "grey", "brown", "ginger", "white"] as const;
export type CoatColour = (typeof COAT_COLOURS)[number];
export const COAT_PATTERNS = ["plain", "stripes", "patches"] as const;
export type CoatPattern = (typeof COAT_PATTERNS)[number];

/**
 * The eight codes stored before SYC-398 (SYC-119's list,
 * `choose-a-different-cat.md` §4.7), and still asked of the coat-v1 reader
 * until SYC-398 PR C. Never written again from A1: every stored value is
 * read through `readCoatValue`.
 */
export const LEGACY_COAT_CODES = [
  "black",
  "white",
  "ginger",
  "grey",
  "tabby",
  "tortoiseshell_or_calico",
  "black_and_white",
  "not_sure",
] as const;
export type LegacyCoatCode = (typeof LEGACY_COAT_CODES)[number];
/** The old public `coat` field's codes (`GET /cats`), for older phones. */
export type LegacyPublicCode = Exclude<LegacyCoatCode, "not_sure">;

/**
 * A coat statement read into its two parts. A part is null when the
 * statement doesn't say it. `notSure` is a person's (or the reader's) whole
 * "Not sure", the only withdrawal (spec §4).
 */
export interface CoatParts {
  colours: CoatColour[] | null;
  pattern: CoatPattern | null;
  notSure: boolean;
}

const COLOUR_SET: ReadonlySet<string> = new Set(COAT_COLOURS);
const PATTERN_SET: ReadonlySet<string> = new Set(COAT_PATTERNS);
const LEGACY_ONLY: ReadonlySet<string> = new Set(["tabby", "tortoiseshell_or_calico", "black_and_white", "not_sure"]);

/** The given codes that are colours, once each, in display order. */
export function orderColours(xs: Iterable<string>): CoatColour[] {
  const present = new Set(xs);
  return COAT_COLOURS.filter((c) => present.has(c));
}

/**
 * The one translation of a stored coat value into parts (spec §6). New and
 * old shapes alike; only what a statement said becomes known (an old
 * "Tabby · White" never said the tabby's own colour, so its colours are not
 * known). Null for a retraction or a malformed value. Other keys (`reason`,
 * `agreesWith`, `modelVersion`) are ignored.
 */
export function readCoatValue(value: unknown): CoatParts | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v["retracted"] === true) return null;
  if (v["notSure"] === true) return { colours: null, pattern: null, notSure: true };
  const raw = v["colours"];
  const rawPattern = v["pattern"];
  if (raw !== undefined && !Array.isArray(raw)) return null;
  if (rawPattern !== undefined && !(typeof rawPattern === "string" && PATTERN_SET.has(rawPattern))) return null;
  const codes = (raw as unknown[] | undefined) ?? [];
  if (!codes.every((c) => typeof c === "string" && (COLOUR_SET.has(c) || LEGACY_ONLY.has(c)))) return null;
  if (codes.length === 0 && rawPattern === undefined) return null;
  if (codes.includes("not_sure")) {
    return codes.length === 1 && rawPattern === undefined ? { colours: null, pattern: null, notSure: true } : null;
  }

  let pattern = (rawPattern as CoatPattern | undefined) ?? null;
  const colours = new Set<string>();
  let bareWhite = false;
  for (const c of codes as string[]) {
    if (c === "tabby") continue;
    if (c === "black_and_white") {
      colours.add("black");
      colours.add("white");
      continue;
    }
    if (c === "tortoiseshell_or_calico") {
      colours.add("black");
      colours.add("ginger");
      pattern ??= "patches";
      continue;
    }
    if (c === "white") bareWhite = true;
    colours.add(c);
  }
  if (codes.includes("tabby")) {
    pattern ??= "stripes";
    // §6: beside an old "tabby", a bare white is not the coat's colour (the
    // tabby's own colour was never said). "black_and_white" still says both.
    if (bareWhite && !codes.includes("black_and_white")) colours.delete("white");
  }
  const ordered = orderColours(colours);
  return { colours: ordered.length ? ordered : null, pattern, notSure: false };
}

/** The reverse, for writers: never emits a null or false part. */
export function partsToValue(
  parts: CoatParts,
): { colours?: CoatColour[]; pattern?: CoatPattern } | { notSure: true } {
  if (parts.notSure) return { notSure: true };
  return {
    ...(parts.colours?.length ? { colours: [...parts.colours] } : {}),
    ...(parts.pattern ? { pattern: parts.pattern } : {}),
  };
}

/**
 * The old public `coat` field for phones that haven't updated (spec §6's
 * truth table): at most two old codes, coarser but never wrong. Display
 * only; nothing filters on it.
 */
export function legacyCoatCodes(colours: readonly CoatColour[], pattern: CoatPattern | null): LegacyPublicCode[] {
  const has = (c: CoatColour) => colours.includes(c);
  const nonBW = colours.filter((c) => c !== "black" && c !== "white");
  if (has("black") && has("white") && nonBW.length === 0 && pattern !== "stripes") return ["black_and_white"];
  if (pattern === "patches" && has("black") && has("ginger")) return ["tortoiseshell_or_calico"];
  if (pattern === "stripes") {
    // Brown has no old code: a brown tabby is plain "tabby".
    const first = (["ginger", "grey", "black", "white"] as const).find(has);
    return first ? (first === "white" ? ["tabby", "white"] : [first, "tabby"]) : ["tabby"];
  }
  return (["black", "white", "ginger", "grey"] as const).filter(has).slice(0, 2);
}

/**
 * The eleven distinguishing-mark codes (coat-markings-and-health.md §3.2),
 * in the spec's order. The only definition: nothing else lists them.
 */
export const MARKS = [
  "white_paws",
  "white_chest",
  "white_face",
  "colourpoint",
  "long_fur",
  "kinked_tail",
  "torn_ear",
  "short_tail",
  "missing_eye",
  "three_legs",
  "odd_eyes",
] as const;
export type Mark = (typeof MARKS)[number];

/**
 * De-duplicates a colour list, and turns the exact set {black, white} (in
 * either order) into `["black_and_white"]`, the only stored form of that
 * pair. Everything else is returned de-duplicated, in its original order.
 *
 * Every writer calls this before `writeObservation`: the answers route
 * (4.1), and the team and guardian statement functions (3.1 and 5.1). The
 * validator's refusal of the raw black + white pair is only the backstop.
 */
export function normaliseColours(colours: readonly string[]): string[] {
  const unique = [...new Set(colours)];
  if (
    unique.length === 2 &&
    unique.includes("black") &&
    unique.includes("white")
  ) {
    return ["black_and_white"];
  }
  return unique;
}
