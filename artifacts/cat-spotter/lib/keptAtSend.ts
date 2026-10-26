/**
 * SYC-186: a spot sent straight away is also kept in the phone's own list, so
 * leaving "Have we met?" without choosing never loses it
 * (docs/specs/unfinished-sightings.md §7).
 *
 * Pure decisions only, so they can be tested without React Native. The write
 * itself is `enqueueSent` in OfflineContext, through the queue's one write path.
 */
import type { MatchCandidate } from '@workspace/api-client-react';
import type { ExtraRef, PendingSighting } from './offlineQueue';

/** What the server answered for the spot that was just sent. */
export interface SentAnswer {
  sightingId: number;
  isCatPhoto: boolean;
  candidates: MatchCandidate[];
  matchCheck?: 'done' | 'failed';
  canRecheck?: boolean;
}

/**
 * A photo the server said has no cat is not kept (spec §5): the spotter was
 * told on screen. A check that FAILED is kept, so it can be checked again.
 */
export function shouldKeepSent(answer: Pick<SentAnswer, 'isCatPhoto'>): boolean {
  return answer.isCatPhoto !== false;
}

/**
 * The list item for a spot already sent. Status `review`, exactly the shape
 * `markReview` gives a queued spot once it syncs, plus `keptAtSend` so the
 * banner, the tab badge and the feeding nudge can tell "left on purpose" from
 * "just checked" (spec §7).
 */
export function keptSentItem(input: {
  localId: string;
  /** The stored photo's reference (never an inline copy). */
  photoUri: string;
  lat: number;
  lng: number;
  /** Capture time, as the phone recorded it. */
  createdAt: string;
  answer: SentAnswer;
  extraPhotos?: ExtraRef[];
  hintCatId?: number;
}): PendingSighting {
  const { answer } = input;
  return {
    localId: input.localId,
    photoUri: input.photoUri,
    lat: input.lat,
    lng: input.lng,
    createdAt: input.createdAt,
    status: 'review',
    keptAtSend: true,
    sightingId: answer.sightingId,
    isCatPhoto: answer.isCatPhoto,
    candidates: answer.candidates,
    matchCheck: answer.matchCheck,
    canRecheck: answer.canRecheck,
    ...(input.extraPhotos && input.extraPhotos.length > 0
      ? { extraPhotos: input.extraPhotos }
      : {}),
    ...(input.hintCatId !== undefined ? { hintCatId: input.hintCatId } : {}),
  };
}

/** Add the kept item once: the same `localId` replaces, never doubles. */
export function addKept(list: PendingSighting[], item: PendingSighting): PendingSighting[] {
  return [...list.filter((p) => p.localId !== item.localId), item];
}

/** Items that count as news for the banner and the tab badge (spec §7). */
export function reviewNews(list: PendingSighting[]): PendingSighting[] {
  return list.filter((p) => p.status === 'review' && !p.keptAtSend);
}
