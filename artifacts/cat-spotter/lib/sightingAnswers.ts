/**
 * The questions on the reward screen, after the points (data spine PR 7;
 * cat-record-data-spine.md §4.4, §7). Pure, so the rules are tested without
 * a screen.
 *
 * Nothing here stands between a spotter and their points: the points are
 * already on screen when these are asked, every question can be skipped, and
 * skipping everything sends nothing at all.
 */
import { ApiError, type SightingAnswersRequest } from '@workspace/api-client-react';

export type EarTipChoice = 'clipped' | 'looks_whole' | 'cant_tell';
export type EarSide = 'left' | 'right' | 'unsure';
export type FoodAndWater = 'yes' | 'no' | 'cant_tell';
/** "Are these the same cat?" (SYC-59 PR 5.2): the reward screen's last, optional question. */
export type DuplicateChoice = 'same' | 'different' | 'not_sure';

export interface SightingAnswers {
  earTip: EarTipChoice | null;
  /** Asked only after "Yes, clipped". Unanswered counts as "not sure". */
  earSide: EarSide | null;
  foodAndWater: FoodAndWater | null;
  note: string;
  duplicate: DuplicateChoice | null;
}

export const NO_ANSWERS: SightingAnswers = {
  earTip: null,
  earSide: null,
  foodAndWater: null,
  note: '',
  duplicate: null,
};

/** The server refuses a longer note (§7.1). */
export const NOTE_MAX_LENGTH = 500;

/**
 * The request to send, or null when everything was skipped (nothing is
 * sent then, so a skipped set of questions costs nothing and uses up
 * nothing). A clipped tip whose ear wasn't chosen is sent as
 * "clipped_unsure": the clip is the fact that matters; the side is
 * secondary (§4.4).
 */
export function answersRequest(
  deviceId: string,
  answers: SightingAnswers,
): SightingAnswersRequest | null {
  const body: SightingAnswersRequest = { deviceId };
  if (answers.earTip === 'clipped') {
    body.earTip =
      answers.earSide === 'left'
        ? 'clipped_left'
        : answers.earSide === 'right'
          ? 'clipped_right'
          : 'clipped_unsure';
  } else if (answers.earTip) {
    body.earTip = answers.earTip;
  }
  if (answers.foodAndWater) body.foodAndWater = answers.foodAndWater;
  const note = answers.note.trim().slice(0, NOTE_MAX_LENGTH);
  if (note.length > 0) body.note = note;
  if (answers.duplicate) body.duplicate = answers.duplicate;

  return Object.keys(body).length > 1 ? body : null;
}

/**
 * What to do when sending the answers fails.
 *
 * - "done": the server already has this sighting's answers (the first send
 *   got through but its reply was lost). Nothing to retry; carry on.
 * - "closed": too late (more than 24 hours since the match) or the sighting
 *   can't take answers. Retrying won't help; carry on without them.
 * - "retry": no signal or a server hiccup. Offer to try again, or to carry
 *   on without sending. The answers aren't queued offline (plan, Conflicts
 *   C2): the match needed signal seconds earlier, so it's almost always
 *   there.
 */
export function classifyAnswersError(err: unknown): 'done' | 'closed' | 'retry' {
  if (!(err instanceof ApiError)) return 'retry';
  const code = (err.data as { code?: string } | null)?.code;
  if (code === 'ALREADY_ANSWERED') return 'done';
  if (code === 'ANSWERS_CLOSED' || code === 'NOT_RESOLVED') return 'closed';
  if (err.status >= 400 && err.status < 500) return 'closed';
  return 'retry';
}
