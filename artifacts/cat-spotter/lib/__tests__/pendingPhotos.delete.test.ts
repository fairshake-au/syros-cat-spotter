/**
 * Final review of PR #9, finding 5: the review screen deleted whatever photo
 * reference its route carried, and on native `FileSystem.deleteAsync` accepts
 * any path (a folder is removed with its contents). A crafted link could
 * therefore choose what got deleted. Deletion is now confined to the app's own
 * photos folder, and a review deletes only the photo derived from its own id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above top-level constants; share them through
// vi.hoisted, as the other native file tests do.
const { DOC_DIR, deleted } = vi.hoisted(() => ({
  DOC_DIR: 'file:///data/user/0/app/files/',
  deleted: [] as string[],
}));
const PHOTOS_DIR = `${DOC_DIR}pending-photos`;

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: DOC_DIR,
  deleteAsync: vi.fn(async (uri: string) => {
    deleted.push(uri);
  }),
  makeDirectoryAsync: vi.fn(async () => undefined),
}));

import { deletePendingPhoto, deleteReviewPhoto } from '../pendingPhotos';

beforeEach(() => {
  deleted.length = 0;
});

describe('deletePendingPhoto on native', () => {
  it('deletes a photo file inside the app photos folder', async () => {
    await deletePendingPhoto(`${PHOTOS_DIR}/1727500000-abc.jpg`);
    expect(deleted).toEqual([`${PHOTOS_DIR}/1727500000-abc.jpg`]);
  });

  it.each([
    ['the photos folder itself', PHOTOS_DIR],
    ['the photos folder with a trailing slash', `${PHOTOS_DIR}/`],
    ['the whole documents folder', DOC_DIR],
    ['another folder', 'file:///data/user/0/app/files/SQLite/'],
    ['a parent-directory escape', `${PHOTOS_DIR}/../SQLite/db.sqlite`],
    ['a nested path', `${PHOTOS_DIR}/sub/photo.jpg`],
    ['a picker cache file', 'file:///data/user/0/app/cache/ImagePicker/x.jpg'],
  ])('refuses %s', async (_label, ref) => {
    await deletePendingPhoto(ref);
    expect(deleted).toEqual([]);
  });
});

// On web the folder guard does not apply (photos are IndexedDB records), so
// the protection is that the review screen never lets its route choose what is
// deleted. `app/` is outside vitest's render paths, so this is a source scan,
// like the route-builder check in reviewRoutes.test.ts.
describe('the review screen', () => {
  it('deletes a resolved review photo by the sighting id, never by the route', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(__dirname, '../../app/review.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/deletePendingPhoto\s*\(/);
    expect(source).not.toMatch(/delete\w*\(\s*data\.photoRef/);
    expect(source).toMatch(/deleteReviewPhoto\(\s*data\.sightingId\s*\)/);
  });
});

describe('deleteReviewPhoto', () => {
  it('deletes exactly the review photo for that sighting', async () => {
    await deleteReviewPhoto(42);
    expect(deleted).toEqual([`${PHOTOS_DIR}/review-42.jpg`]);
  });

  it('does nothing for an id that is not a real sighting id', async () => {
    for (const id of [0, -1, 1.5, Number.NaN]) {
      await deleteReviewPhoto(id);
    }
    expect(deleted).toEqual([]);
  });
});
