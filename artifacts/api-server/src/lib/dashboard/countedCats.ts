import type { SterilisedMark, TeamCat } from "../teamCatList";

// Who is counted (SYC-396 PR 2.0; spec §9.5). Every figure, list and report
// on the team dashboard goes through here: no page writes its own "street
// cat" filter. The cats come from `loadTeamCats`, which already leaves out
// merged-away halves. Pure functions: no database.

/** 6 weeks (spec §4.3). Syros Cats may change it: SYC-442. */
export const NOT_SEEN_LATELY_DAYS = 42;

export type Split = Record<SterilisedMark, number>;

const DAY = 86_400_000;

/** On the street (not gone, so never presumed deceased), and on Syros: Off Syros is never counted (§3.3). */
export const isStreet = (c: TeamCat): boolean => c.lives === "street" && c.areaKey !== "off";

/** A street cat, a cat with a home, or a cat in care. Never "No longer with us". */
export const isActive = (c: TeamCat): boolean => c.lives !== "gone";

/** Off Syros is never counted in any figure (§3.3), whoever the cat is. */
const onSyros = (c: TeamCat): boolean => c.areaKey !== "off";

/**
 * Street cats with at least one resolved sighting, last seen
 * NOT_SEEN_LATELY_DAYS or more ago. `lastSeenAt` is the newest matched
 * sighting, so a cat only ever seen in an import is never here.
 */
export function notSeenLately(cats: readonly TeamCat[], now: Date): TeamCat[] {
  const cutoff = now.getTime() - NOT_SEEN_LATELY_DAYS * DAY;
  return cats.filter((c) => isStreet(c) && c.lastSeenAt !== null && c.lastSeenAt.getTime() <= cutoff);
}

/** How many street cats carry each sterilisation mark. Street cats only. */
export function splitOf(cats: readonly TeamCat[]): Split {
  const split: Split = { sterilised: 0, probably: 0, not_sterilised: 0, not_known: 0 };
  for (const c of cats) if (isStreet(c)) split[c.mark] += 1;
  return split;
}

export interface Headline {
  street: number;
  split: Split;
  homed: number;
  inCare: number;
  /** When the figures were worked out (§9.6). */
  at: Date;
}

/** The island headline: street cats and their split, with homed and in care counted separately. */
export function headline(cats: readonly TeamCat[], now: Date): Headline {
  const split = splitOf(cats);
  return {
    street: split.sterilised + split.probably + split.not_sterilised + split.not_known,
    split,
    homed: cats.filter((c) => c.lives === "homed" && onSyros(c)).length,
    inCare: cats.filter((c) => c.lives === "in_care" && onSyros(c)).length,
    at: now,
  };
}

/** The planner's group order (§9.2): not sterilised, then not known, then probably. */
const TO_DO_ORDER: Partial<Record<SterilisedMark, number>> = { not_sterilised: 0, not_known: 1, probably: 2 };

/**
 * Trapping "To do": street cats not confirmed sterilised, in the planner's
 * order (§9.2). Within each group the most recently seen comes first, and
 * cats never seen come last.
 */
export function toDo(cats: readonly TeamCat[]): TeamCat[] {
  return cats
    .filter((c) => isStreet(c) && TO_DO_ORDER[c.mark] !== undefined)
    .sort(
      (a, b) =>
        TO_DO_ORDER[a.mark]! - TO_DO_ORDER[b.mark]! ||
        (b.lastSeenAt?.getTime() ?? -Infinity) - (a.lastSeenAt?.getTime() ?? -Infinity) ||
        a.id - b.id,
    );
}
