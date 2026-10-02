/**
 * SYC-42 plan, Slice 1 item 1.11: cat reports keep their photos in the same
 * photo store as sightings. The sightings' orphan sweep only knows the
 * sighting queue, so it must never delete a report's photo (`report-*`):
 * the report queue deletes its own once the photo has been sent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { DOC_DIR, deleted, names } = vi.hoisted(() => ({
  DOC_DIR: 'file:///data/user/0/app/files/',
  deleted: [] as string[],
  names: [] as string[],
}));
const PHOTOS_DIR = `${DOC_DIR}pending-photos`;

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: DOC_DIR,
  readDirectoryAsync: vi.fn(async () => [...names]),
  // Every file is a week old: long past the sweep's grace period.
  getInfoAsync: vi.fn(async () => ({ exists: true, modificationTime: Date.now() / 1000 - 7 * 86400 })),
  deleteAsync: vi.fn(async (uri: string) => {
    deleted.push(uri);
  }),
  makeDirectoryAsync: vi.fn(async () => undefined),
}));

import { cleanupOrphanPhotos } from '../pendingPhotos';

beforeEach(() => {
  deleted.length = 0;
  names.length = 0;
});

describe('the orphan sweep and report photos', () => {
  it('keeps every report-* photo, and still sweeps an unreferenced sighting photo', async () => {
    names.push('report-1727-abc.jpg', '1727500000-orphan.jpg', '1727500001-kept.jpg');
    await cleanupOrphanPhotos([`${PHOTOS_DIR}/1727500001-kept.jpg`]);
    expect(deleted).toEqual([`${PHOTOS_DIR}/1727500000-orphan.jpg`]);
  });
});
