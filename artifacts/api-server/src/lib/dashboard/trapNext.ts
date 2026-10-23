import type { ColonyFigures } from "./colonyFigures";
import type { Split } from "./countedCats";

// Where to trap next (SYC-603, spec §4.2): the colonies with the most street
// cats still to sterilise. Pure: it ranks the figures the Colonies list
// already works out (§9.1), so the trapping planner (§9.2) isn't needed.

export const TRAP_NEXT_LIMIT = 3;

export interface TrapColony {
  colonyId: number;
  name: string;
  /** Street cats not confirmed sterilised: Not sterilised, Not known or Probably (§9.5 "To do"). */
  toDo: number;
  street: number;
  sterilised: number;
  split: Split;
  /** The Colonies list's Kittens reported flag (§9.1). */
  kittens: boolean;
}

/**
 * Most to do first; ties go to a colony with kittens reported, then by name.
 * A colony with nothing to do is never listed, nor one this viewer can't name.
 */
export function rankTrapNext(
  figures: ReadonlyMap<number, ColonyFigures>,
  names: ReadonlyMap<number, string>,
  limit: number = TRAP_NEXT_LIMIT,
): TrapColony[] {
  const out: TrapColony[] = [];
  for (const f of figures.values()) {
    const name = names.get(f.colonyId);
    const toDo = f.street - f.split.sterilised;
    if (name === undefined || toDo <= 0) continue;
    out.push({
      colonyId: f.colonyId,
      name,
      toDo,
      street: f.street,
      sterilised: f.split.sterilised,
      split: f.split,
      kittens: f.flags.includes("kittens"),
    });
  }
  return out
    .sort(
      (a, b) =>
        b.toDo - a.toDo ||
        Number(b.kittens) - Number(a.kittens) ||
        a.name.localeCompare(b.name) ||
        a.colonyId - b.colonyId,
    )
    .slice(0, limit);
}
