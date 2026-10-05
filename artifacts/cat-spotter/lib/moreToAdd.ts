/**
 * Adding details to a cat later, from its page (SYC-117 part 2,
 * docs/specs/add-details-later.md). Pure, so the rules are tested without a
 * screen.
 */
import type {
  MyOpenSightingsEarTip,
  MyOpenSightingsEarTipCurrent,
  SightingAnswersRequest,
} from '@workspace/api-client-react';
import { answersRequest, type SightingAnswers } from './sightingAnswers';

/**
 * The request for answers added from the cat's page, or null when nothing
 * was answered. An ear-tip answer after an earlier one is a deliberate
 * change (Decision 3 → B), so it carries `changeEarTip`. Once Syros Cats
 * have checked the ear tip it can't be changed, so it isn't sent at all.
 */
export function addLaterRequest(
  deviceId: string,
  answers: SightingAnswers,
  earTip: MyOpenSightingsEarTip,
): SightingAnswersRequest | null {
  const usable = earTip.state === 'checked' ? { ...answers, earTip: null, earSide: null } : answers;
  const body = answersRequest(deviceId, usable);
  if (body?.earTip && earTip.state === 'answered') body.changeEarTip = true;
  return body;
}

/** "Yes, clipped · Left": the spotter's own answer, shown back to them. */
export function earTipAnswerLabel(
  answer: MyOpenSightingsEarTipCurrent,
  t: (key: string) => string,
): string {
  switch (answer) {
    case 'clipped_left':
      return `${t('earTipYes')} · ${t('earLeft')}`;
    case 'clipped_right':
      return `${t('earTipYes')} · ${t('earRight')}`;
    case 'clipped_unsure':
      return t('earTipYes');
    case 'looks_whole':
      return t('earTipNo');
    case 'cant_tell':
      return t('earTipCantTell');
  }
}

/** The card's first line: one sighting by its date, several by count. */
export function moreToAddHeadline(
  catName: string,
  takenAt: string[],
  t: (key: string) => string,
  formatDate: (d: Date) => string = (d) => d.toLocaleDateString(),
): string {
  if (takenAt.length === 1) {
    return t('moreToAddOne')
      .replace('{name}', catName)
      .replace('{date}', formatDate(new Date(takenAt[0]!)));
  }
  return t('moreToAddMany')
    .replace('{name}', catName)
    .replace('{count}', String(takenAt.length));
}
