/**
 * The appearance vocabulary (coat-markings-and-health.md §3.1, §3.2) and the
 * one colour normaliser. Pure: no database import, so the resolver
 * (`resolve.ts`) and every writer (`observations.ts` re-exports these) share
 * the single definition. Nothing else may define either list.
 */
/**
 * SYC-119's fixed coat-colour vocabulary (`choose-a-different-cat.md` §4.7:
 * "Black · White · Ginger · Grey · Tabby · Tortoiseshell or calico · Black
 * and white · Not sure").
 *
 * Under Decision A1 (SYC-2), SYC-161 imports this list and these are the
 * only definitions: nothing else may define a second colour list.
 */
export const COAT_COLOURS = [
  "black",
  "white",
  "ginger",
  "grey",
  "tabby",
  "tortoiseshell_or_calico",
  "black_and_white",
  "not_sure",
] as const;
export type CoatColour = (typeof COAT_COLOURS)[number];

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
