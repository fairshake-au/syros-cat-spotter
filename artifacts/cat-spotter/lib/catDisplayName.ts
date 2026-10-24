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
