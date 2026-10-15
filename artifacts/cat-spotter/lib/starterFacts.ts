/**
 * SYC-48: the twenty starter facts (docs/specs/starter-facts.md §4), listed
 * once. Each fact's words are in lib/i18n.ts under its id, in all three
 * languages. The server keeps the same ids in the same order
 * (lib/db/src/appSettings/shape.ts); a server test checks the two agree.
 *
 * - strand: the proposal's six teaching strands (1 Reading a cat · 2 Life in a
 *   colony · 3 Why sterilisation works · 4 Being around a street cat · 5 When a
 *   cat needs help · 6 You're doing science), so Teaching in full (SYC-61)
 *   builds on this set.
 * - core: the ten that ship first if the set has to be cut (Decision 3).
 * - signOff: Syros Cats must say yes to these (§7); without it the server
 *   lists them as hidden.
 * - photo: shows the ear-tip example photo above the words.
 */
export interface StarterFact {
  id: string;
  strand: 1 | 2 | 3 | 4 | 5 | 6;
  core: boolean;
  signOff: boolean;
  photo: boolean;
}

export const STARTER_FACTS: readonly StarterFact[] = [
  { id: 'fact.earTip', strand: 3, core: true, signOff: true, photo: true },
  { id: 'fact.litters', strand: 3, core: true, signOff: false, photo: false },
  { id: 'fact.disease', strand: 3, core: true, signOff: true, photo: false },
  { id: 'fact.backHome', strand: 3, core: true, signOff: true, photo: false },
  { id: 'fact.vacuum', strand: 3, core: false, signOff: true, photo: false },
  { id: 'fact.cost', strand: 3, core: true, signOff: true, photo: false },
  { id: 'fact.milk', strand: 4, core: true, signOff: false, photo: false },
  { id: 'fact.leftovers', strand: 4, core: true, signOff: true, photo: false },
  { id: 'fact.water', strand: 4, core: false, signOff: true, photo: false },
  { id: 'fact.hiss', strand: 4, core: false, signOff: false, photo: false },
  { id: 'fact.dontPickUp', strand: 4, core: false, signOff: false, photo: false },
  { id: 'fact.kittensAlone', strand: 5, core: true, signOff: true, photo: false },
  { id: 'fact.tortie', strand: 1, core: true, signOff: false, photo: false },
  { id: 'fact.whiteBlue', strand: 1, core: false, signOff: false, photo: false },
  { id: 'fact.slowBlink', strand: 1, core: false, signOff: false, photo: false },
  { id: 'fact.tailUp', strand: 1, core: false, signOff: false, photo: false },
  { id: 'fact.purr', strand: 1, core: false, signOff: false, photo: false },
  { id: 'fact.kittenEyes', strand: 1, core: false, signOff: false, photo: false },
  { id: 'fact.colonyFemales', strand: 2, core: false, signOff: true, photo: false },
  { id: 'fact.cantTell', strand: 6, core: true, signOff: false, photo: false },
];

export const FACT_IDS: readonly string[] = STARTER_FACTS.map((f) => f.id);

/** The fixed start after the nudge (Decision 1): the ear tip, then milk. */
export const EAR_TIP_FACT = 'fact.earTip';
export const MILK_FACT = 'fact.milk';

export function factById(id: string): StarterFact | undefined {
  return STARTER_FACTS.find((f) => f.id === id);
}

/** Words in a fact, by the spec's rule (§3.3): a space-separated piece of
 * text containing a letter or digit. NBSPs count as spaces, so French « ? »
 * and « : » aren't words; l’oignon is one word. */
export function wordCount(text: string): number {
  return text
    .split(/[\s ]+/)
    .filter((piece) => /[\p{L}\p{N}]/u.test(piece)).length;
}

/** Facts are short: 35 words or fewer in every language (§3.3). */
export const MAX_FACT_WORDS = 35;
