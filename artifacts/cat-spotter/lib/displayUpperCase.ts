/**
 * SYC-143: uppercase text for display, following Greek typesetting rules.
 *
 * Greek written in capitals drops its accents: "Διακρίσεις" becomes
 * "ΔΙΑΚΡΙΣΕΙΣ", not "ΔΙΑΚΡΊΣΕΙΣ". Plain `toUpperCase()` keeps them, and
 * `toLocaleUpperCase('el')` only drops them on some JavaScript engines, so
 * the rule is applied here explicitly:
 *
 * - accents (tonos/acute, grave, circumflex, breathings) come off Greek
 *   letters; a diaeresis stays;
 * - where the dropped accent was the only thing splitting a vowel pair
 *   ("τσάι" is two syllables), the second vowel gets a diaeresis instead
 *   ("ΤΣΑΪ"), so the capitals still read the same way;
 * - the one-letter word "ή" ("or") keeps its accent ("Ή"), so it isn't
 *   mistaken for the article "η".
 *
 * Accents on non-Greek letters are untouched: French capitals keep theirs
 * ("DÉCOUVERTES"). Use this instead of `toUpperCase()` or the style
 * `textTransform: 'uppercase'` (which on web has the same problem) for any
 * label that may be Greek.
 */

const ACCENT_MARKS = new Set([
  '̀', // grave (varia)
  '́', // acute / tonos (oxia)
  '͂', // circumflex (perispomeni)
  '̓', // smooth breathing (psili)
  '̔', // rough breathing (dasia)
]);
const DIAERESIS = '̈';

const isGreek = (ch: string) => /[Ͱ-Ͽἀ-῿]/.test(ch);
const isCombining = (ch: string) => /[̀-ͯ]/.test(ch);

/** Vowel pairs that read as one sound unless something splits them. */
const DIPHTHONGS = new Set(['αι', 'ει', 'οι', 'υι', 'αυ', 'ευ', 'ηυ', 'ου']);

function upperGreekWord(word: string): string {
  if (word === 'ή' || word === 'Ή') return 'Ή';
  const chars = [...word.normalize('NFD')];
  const out: string[] = [];
  let pendingDiaeresis = -1; // index into chars of a vowel that needs one
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ACCENT_MARKS.has(ch)) {
      // Find this mark's base letter (the last non-combining char before it).
      let b = i - 1;
      while (b >= 0 && isCombining(chars[b]!)) b--;
      const base = b >= 0 ? chars[b]! : '';
      if (!isGreek(base)) {
        out.push(ch);
        continue;
      }
      // Next base letter after this letter's marks.
      let n = i + 1;
      while (n < chars.length && isCombining(chars[n]!)) n++;
      const next = chars[n];
      const nextHasMark = n + 1 < chars.length && isCombining(chars[n + 1]!);
      if (
        next &&
        !nextHasMark &&
        DIPHTHONGS.has((base + next).toLowerCase())
      ) {
        pendingDiaeresis = n;
      }
      continue; // drop the accent
    }
    out.push(ch);
    if (i === pendingDiaeresis) {
      out.push(DIAERESIS);
      pendingDiaeresis = -1;
    }
  }
  return out.join('').toUpperCase().normalize('NFC');
}

/**
 * Word separators: whitespace and common punctuation. Deliberately not a
 * `\p{L}` Unicode property escape, which not every native engine supports.
 */
const SEPARATORS = /([\s.,;:!?()[\]{}«»"'‘’“”–—/-]+)/;

export function displayUpperCase(text: string): string {
  // Without String.prototype.normalize (some native engines), fall back to
  // plain capitals rather than fail to render the label at all.
  if (typeof text.normalize !== 'function') return text.toUpperCase();
  // Split into words and separators, so "ή" can be recognised as a whole word.
  return text
    .split(SEPARATORS)
    .map((part) => ([...part].some(isGreek) ? upperGreekWord(part) : part.toUpperCase()))
    .join('')
    .normalize('NFC');
}
