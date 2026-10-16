/**
 * SYC-415: the pure rules for a spot's optional face and body photos
 * (spec docs/specs/photo-tips-and-extra-photos.md §4.3, §5.1, §6.1).
 *
 * No React, no storage: the Spot screen and the offline queue call these.
 */

export type ExtraRole = 'face' | 'body';

/** One photo in the spot. `fingerprint` is ALWAYS of the photo as picked or captured
 *  (photoFingerprint of the original base64), never of the prepared copy, so a later
 *  "already logged" check against the same library photo matches (spec §4.3).
 *  For an extra, `uri`/`base64` are the PREPARED copy (the one that gets sent). */
export interface SpotPhoto {
  uri: string;
  base64: string;
  fingerprint: string;
  takenAtMs: number | null;
}

/** Photos in one spot must be from the same visit: within two hours (spec §4.3). */
export const SAME_VISIT_MS = 2 * 60 * 60 * 1000;

/** The whole request must stay under 18 MB of base64; the server's body limit is 25 MB (spec §6.1). */
export const REQUEST_BUDGET_BASE64_CHARS = 18 * 1024 * 1024;

/** The cover photo rule (spec §5.1): the face photo if there is one, else the first photo. */
export function coverRole(extras: Partial<Record<ExtraRole, SpotPhoto>>): 'face' | 'first' {
  return extras.face ? 'face' : 'first';
}

/** True when both times are within two hours either way, or when either is unknown. */
export function withinSameVisit(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return true;
  return Math.abs(a - b) <= SAME_VISIT_MS;
}

export type ExtraProblem =
  | { kind: 'duplicate' }
  | { kind: 'alreadyLogged' }
  | { kind: 'tooOld'; instantMs: number }
  | { kind: 'differentVisit'; takenAtMs: number }
  | { kind: 'tooLarge' };

/**
 * Checks a photo picked for an extra box, in a fixed order: the same photo used
 * twice in this spot, already logged in an earlier spot, older than 21 days,
 * then from a different visit. Returns null when the photo is fine.
 */
export function checkExtraCandidate(input: {
  candidate: SpotPhoto;
  first: SpotPhoto;
  otherExtra: SpotPhoto | undefined;
  alreadyLogged: boolean;
  tooOld: { instantMs: number } | null;
}): ExtraProblem | null {
  const { candidate, first, otherExtra, alreadyLogged, tooOld } = input;
  if (
    candidate.fingerprint === first.fingerprint ||
    (otherExtra !== undefined && candidate.fingerprint === otherExtra.fingerprint)
  ) {
    return { kind: 'duplicate' };
  }
  if (alreadyLogged) return { kind: 'alreadyLogged' };
  if (tooOld) return { kind: 'tooOld', instantMs: tooOld.instantMs };
  if (!withinSameVisit(first.takenAtMs, candidate.takenAtMs)) {
    // withinSameVisit is only false when both times are known.
    return { kind: 'differentVisit', takenAtMs: candidate.takenAtMs as number };
  }
  return null;
}

/** An extra taken out after a retake, and why (each reason has its own message). */
export interface RemovedExtra {
  role: ExtraRole;
  takenAtMs: number | null;
  reason: 'duplicate' | 'differentVisit';
}

/**
 * After the first photo is retaken, keep the extras that still fit and remove
 * the ones that are from a different visit or repeat the new first photo
 * (spec §4.3).
 */
export function recheckAfterRetake(
  first: SpotPhoto,
  extras: Partial<Record<ExtraRole, SpotPhoto>>,
): { kept: Partial<Record<ExtraRole, SpotPhoto>>; removed: RemovedExtra[] } {
  const kept: Partial<Record<ExtraRole, SpotPhoto>> = {};
  const removed: RemovedExtra[] = [];
  for (const role of ['face', 'body'] as const) {
    const extra = extras[role];
    if (!extra) continue;
    if (extra.fingerprint === first.fingerprint) {
      removed.push({ role, takenAtMs: extra.takenAtMs, reason: 'duplicate' });
    } else if (!withinSameVisit(first.takenAtMs, extra.takenAtMs)) {
      removed.push({ role, takenAtMs: extra.takenAtMs, reason: 'differentVisit' });
    } else {
      kept[role] = extra;
    }
  }
  return { kept, removed };
}

/** True when the first photo and the extras together fit the request budget (spec §6.1). */
export function fitsRequestBudget(firstBase64: string, extrasBase64: string[]): boolean {
  const total = extrasBase64.reduce((sum, b) => sum + b.length, firstBase64.length);
  return total <= REQUEST_BUDGET_BASE64_CHARS;
}

/** One extra photo actually in use in the spot. */
export interface InUseExtra {
  role: ExtraRole;
  photo: SpotPhoto;
}

/**
 * The extra photos actually in use, face first: every one held while the
 * switch is on, and none while it is off (the boxes are hidden then, and
 * nothing hidden is ever sent). The ONLY source for the payload, the queue
 * item, the cover photo and the remembered fingerprints.
 */
export function photosInUse(
  extras: Partial<Record<ExtraRole, SpotPhoto>>,
  switchOn: boolean,
): InUseExtra[] {
  if (!switchOn) return [];
  return (['face', 'body'] as const).flatMap((role) => {
    const photo = extras[role];
    return photo ? [{ role, photo }] : [];
  });
}

/** The face photo in use, which is the cover (spec §5.1); null means the first photo is. */
export function coverExtra(inUse: InUseExtra[]): SpotPhoto | null {
  return inUse.find((e) => e.role === 'face')?.photo ?? null;
}
