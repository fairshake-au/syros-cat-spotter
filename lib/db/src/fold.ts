/**
 * Cat- and colony-name folding (cat-record-data-spine.md §10.3,
 * DECISIONS.md Part 2g).
 *
 * `cats_name_lower_unique` and (before this) `colonies.normalised_name` only
 * ever folded case, letter for letter, under the database's ctype. That
 * leaves `ΜΙΜΗ` beside `Μιμή` (no accent folding), `ΣΟΦΊΑΣ` beside `Σοφίας`
 * (no final-sigma folding) and the NFD spelling of any name as a second cat
 * (no Unicode normalisation) — all pinned as "today's behaviour" in
 * `lib/db/src/migrate/dataSpine.test.ts`'s
 * `cats_name_lower_unique with Greek names` tests.
 *
 * `foldName` is the one folding function every writer and lookup uses
 * instead: SYC-101's `cats.normalised_name` column, `colonies.normalised_name`,
 * and the data spine's `name` observations (§10.3). It must agree with
 * `artifacts/cat-spotter/lib/catPicker.ts`'s `fold`, which already folds the
 * app's own "find the cat" search the same way (Part 2g) — this is that same
 * folding, promoted to the one place both the API and SYC-101's migration can
 * share it.
 */
export function foldName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // strip combining marks (accents)
    .toLowerCase()
    .replace(/ς/g, "σ") // final sigma folds to sigma
    .normalize("NFC")
    .trim();
}
