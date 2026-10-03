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
 * and the data spine's `name` observations (§10.3).
 *
 * **What it folds, exactly** (Samuel, 3 Oct 2026, after the PR #62 review):
 * Unicode normalisation (NFD then NFC), case, accents (combining marks),
 * final sigma (`ς` → `σ`), invisible formatting characters (category `Cf` —
 * zero-width spaces, joiners, bidi marks — which a phone keyboard or a
 * paste can leave in a name invisibly), and any run of whitespace
 * (including non-breaking space) collapsed to one plain space, trimmed.
 * **What it deliberately does NOT fold:** Greek/Latin look-alike letters
 * (`Α` vs `A`, `Η` vs `H`) — a mixed-keyboard name like `ΑΓΑΘΗ` typed as
 * `AΓAΘH` is a real, separate risk, deferred to SYC-101 for Samuel to
 * decide rather than silently merged here.
 *
 * **Agreement with the app's own fold.** `artifacts/cat-spotter/lib/catPicker.ts`'s
 * `fold` folds the app's "find the cat" search the same way, for every case
 * above. The one place the two still disagree is Hangul: `foldName`
 * normalises to NFC and the app's search fold does not, so a Korean name
 * typed in a decomposed form can search-match slightly differently than it
 * would merge under this function's uniqueness index. That difference is
 * harmless for a *search* (it only ever narrows a visible list; it can
 * never merge two records), which is why it's noted here rather than fixed
 * — fixing it means adding an NFC normalise to the app's fold too, which is
 * SYC-101's call, not this PR's.
 */
export function foldName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // strip combining marks (accents)
    .replace(/\p{Cf}/gu, "") // strip invisible formatting chars (e.g. zero-width space)
    .toLowerCase()
    .replace(/ς/g, "σ") // final sigma folds to sigma
    .replace(/\s+/g, " ") // collapse any run of whitespace (incl. NBSP) to one space
    .normalize("NFC")
    .trim();
}
