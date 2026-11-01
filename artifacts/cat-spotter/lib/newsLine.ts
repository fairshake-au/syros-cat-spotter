import type { AppNotification } from '@workspace/api-client-react';
import { dateWord, weekdayWord } from './newsDay';
import type { Language } from './i18n';

/**
 * SYC-221 (news-in-your-language.md §3.2): a bell line about a cat, worded in
 * the app's language from its stored kind (`wording`), the cat's name as it is
 * now (so a merged cat shows the survivor's) and the Syros day for the two
 * "seen on..." kinds. Returns null when the entry can't be worded this way
 * (staff text, a weekly result, a row from before the label, a kind a newer
 * server adds, a missing name or day): the caller shows the stored message.
 */
const KEY: Record<string, string> = {
  sterilised: 'newsSterilised',
  spotted_again: 'newsSpottedAgain',
  seen_weekday: 'newsSeenWeekday',
  seen_date: 'newsSeenDate',
  new_cat: 'newsNewCat',
};

/** Fills a placeholder; split/join so a value holding "$&" stays as typed. */
function fill(line: string, token: string, value: string): string {
  return line.split(token).join(value);
}

export function newsLineText(
  n: Pick<AppNotification, 'wording' | 'wordingDay' | 'catName'>,
  t: (key: string) => string,
  language: Language,
): string | null {
  const key = n.wording ? KEY[n.wording] : undefined;
  if (!key || !n.catName) return null;
  let line = t(key);
  if (n.wording === 'seen_weekday' || n.wording === 'seen_date') {
    if (!n.wordingDay) return null;
    line =
      n.wording === 'seen_weekday'
        ? fill(line, '{day}', weekdayWord(n.wordingDay, language))
        : fill(line, '{date}', dateWord(n.wordingDay, language));
  }
  return fill(line, '{name}', n.catName);
}
