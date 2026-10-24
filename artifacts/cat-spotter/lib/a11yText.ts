/**
 * SYC-509: emoji in titles are read aloud ("Have we met? paw prints").
 * `spokenText` is what a screen reader should say instead, and `decorative`
 * hides an emoji-only element from screen readers on iOS, Android and web.
 */

const EMOJI = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}️‍]/gu;

/** The text with emoji removed and spacing tidied, for accessibilityLabel. */
export function spokenText(text: string): string {
  return text
    .replace(EMOJI, '')
    .replace(/\s+([!?.,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Spread onto a purely decorative element (an emoji, a paw). */
export const decorative = {
  'aria-hidden': true,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;
