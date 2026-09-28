/**
 * The ONLY way to build the review screen's route (spec §3.4).
 *
 * expo-router carries params in the browser address and history, and the app
 * used to put the photograph there — in three places. That is the likely cause
 * of the Chrome crash at "check for matches" (SYC-76), established by
 * elimination rather than observed: at 640×480 a capture is about half a
 * million characters, under Chrome's 2 MiB URL cap, so the precise mechanism is
 * not known. Whatever it is, the route now carries only short names: a queued
 * item's `localId` (the review screen finds its photo through the queue), or an
 * online submission's `photoRef` (`review-<sightingId>` in the phone's own
 * photo store).
 *
 * The builder never throws: it runs after the sighting already exists on the
 * server, so a throw would leave a sighting that can never be reviewed. It
 * trims each candidate's `reasoning` (model text, otherwise unbounded) and
 * drops any value that is a data URL or photo-sized.
 *
 * A test fails if any `/review` navigation bypasses this builder.
 */
import type { MatchCandidate } from '@workspace/api-client-react';

export interface ReviewRouteData {
  sightingId: number;
  isCatPhoto: boolean;
  candidates: MatchCandidate[];
  /** A queued sighting: its photo is found through the queue. */
  localId?: string;
  /** An online submission: its photo, saved as `review-<sightingId>`. */
  photoRef?: string;
}

export interface ReviewRouteInput {
  sightingId?: number | null;
  isCatPhoto?: boolean | null;
  candidates?: readonly MatchCandidate[] | null;
  localId?: string | null;
  photoRef?: string | null;
}

export const REASONING_MAX_LENGTH = 280;
/** Anything longer than this is not a name or a path — it is photo-sized. */
const MAX_VALUE_LENGTH = 2048;

/**
 * A value that IS a data URL — one that starts with `data:`. Anything photo-
 * sized is already caught by the length limit, so this only needs to catch
 * short data URLs (`data:,` from an empty canvas). Matching `data:` anywhere
 * used to blank match reasoning that merely mentioned the word.
 */
function isDataUrl(value: string): boolean {
  return /^\s*data:/i.test(value);
}

/** A short, non-photo string, or undefined. */
function safeText(value: unknown, max = MAX_VALUE_LENGTH): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length > max || isDataUrl(value)) return undefined;
  return value;
}

function trimReasoning(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed =
    value.length > REASONING_MAX_LENGTH
      ? `${value.slice(0, REASONING_MAX_LENGTH - 1)}…`
      : value;
  return isDataUrl(trimmed) ? '' : trimmed;
}

function safeCandidate(candidate: unknown): MatchCandidate | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const c = candidate as Partial<MatchCandidate>;
  if (typeof c.catId !== 'number') return null;
  return {
    catId: c.catId,
    name: safeText(c.name) ?? '',
    photoUrl: safeText(c.photoUrl) ?? '',
    confidence: typeof c.confidence === 'number' ? c.confidence : 0,
    reasoning: trimReasoning(c.reasoning),
  };
}

export function buildReviewParams(input: ReviewRouteInput): { data: string } {
  const sightingId = Number(input.sightingId) || 0;
  const isCatPhoto = input.isCatPhoto !== false;
  try {
    const candidates = Array.isArray(input.candidates)
      ? input.candidates
          .map(safeCandidate)
          .filter((c): c is MatchCandidate => c !== null)
      : [];
    const data: ReviewRouteData = { sightingId, isCatPhoto, candidates };
    const localId = safeText(input.localId, 200);
    if (localId) data.localId = localId;
    const photoRef = safeText(input.photoRef, 500);
    if (photoRef) data.photoRef = photoRef;
    return { data: JSON.stringify(data) };
  } catch {
    // Never throw: a route to review the sighting, even without candidates,
    // beats a sighting that can never be reviewed.
    return { data: JSON.stringify({ sightingId, isCatPhoto, candidates: [] }) };
  }
}

/** Read the review route back; null if it is missing or malformed. */
export function parseReviewParams(raw: string | undefined): ReviewRouteData | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ReviewRouteData>;
    if (typeof value !== 'object' || value === null) return null;
    if (typeof value.sightingId !== 'number') return null;
    return {
      sightingId: value.sightingId,
      isCatPhoto: value.isCatPhoto !== false,
      candidates: Array.isArray(value.candidates) ? value.candidates : [],
      localId: typeof value.localId === 'string' ? value.localId : undefined,
      photoRef: typeof value.photoRef === 'string' ? value.photoRef : undefined,
    };
  } catch {
    return null;
  }
}
