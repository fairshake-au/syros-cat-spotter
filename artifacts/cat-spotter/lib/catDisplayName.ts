/**
 * What to call a cat in a list, on the map or at the top of its page.
 * A cat Syros Cats left for spotters to name carries its SYR number as
 * `name` until someone names it (SYC-677 D); people see "No name yet".
 */
export function catDisplayName(
  cat: { name: string; namePending?: boolean },
  t: (key: string) => string,
): string {
  return cat.namePending ? t('noNameYet') : cat.name;
}

/**
 * What to call a cat inside a sentence ("I've spotted ...", "See ...'s story").
 * "No name yet" reads wrong there and its grammar differs in Greek and
 * French, so a cat nobody has named yet is called by its SYR number (its
 * stored name), which fits every language. Names that stand alone (titles,
 * cards, pins, headings) go through catDisplayName instead.
 */
export function catNameInSentence(cat: { name: string; namePending?: boolean }): string {
  return cat.name;
}

/**
 * A cat in a list or on the map: its name, or for a cat nobody has named yet
 * "No name yet" with its SYR number, so two such cats can be told apart.
 */
export function catListName(
  cat: { name: string; namePending?: boolean },
  t: (key: string) => string,
): string {
  return cat.namePending ? `${t('noNameYet')} · ${cat.name}` : cat.name;
}
