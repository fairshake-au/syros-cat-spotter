/**
 * Whether this phone has seen the photo tips card (SYC-415 spec §3.2).
 * "Delete my data" clears it deliberately, so a fresh start shows it again.
 */
export const PHOTO_TIPS_SEEN_KEY = 'cat-spotter/photo-tips-seen-v1';

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export async function hasSeenPhotoTips(storage: Storage): Promise<boolean> {
  try {
    return (await storage.getItem(PHOTO_TIPS_SEEN_KEY)) === '1';
  } catch {
    // A store we can't read would otherwise show the card on every visit.
    return true;
  }
}

export async function markPhotoTipsSeen(storage: Storage): Promise<void> {
  try {
    await storage.setItem(PHOTO_TIPS_SEEN_KEY, '1');
  } catch {
    // Not worth an error: the card shows once more next time.
  }
}

/**
 * Whether the first-visit tips card should open now (spec §3.2). `seenThisSession`
 * is set synchronously when the card is dismissed, so a tab-switch re-check can't
 * beat the asynchronous storage write and re-open it.
 */
export function shouldOpenPhotoTips(args: {
  seen: boolean;
  hasPhoto: boolean;
  seenThisSession: boolean;
}): boolean {
  return !args.seen && !args.hasPhoto && !args.seenThisSession;
}

export async function clearPhotoTipsSeen(storage: Storage): Promise<void> {
  await storage.removeItem(PHOTO_TIPS_SEEN_KEY);
}
