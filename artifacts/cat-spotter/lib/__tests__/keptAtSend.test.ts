import { describe, expect, it } from 'vitest';
import { addKept, keptSentItem, reviewNews, shouldKeepSent } from '../keptAtSend';
import { markStaleItems, type PendingSighting } from '../offlineQueue';

const answer = {
  sightingId: 7,
  isCatPhoto: true,
  candidates: [],
  matchCheck: 'done' as const,
  canRecheck: false,
};
const base = {
  localId: 'a1',
  photoUri: 'idb:a1',
  lat: 37.4,
  lng: 24.9,
  createdAt: '2026-10-26T10:00:00.000Z',
  answer,
};

describe('SYC-186 shouldKeepSent', () => {
  it('keeps a spot with a cat, and one whose check failed', () => {
    expect(shouldKeepSent({ isCatPhoto: true })).toBe(true);
  });
  it('does not keep a photo the server said has no cat', () => {
    expect(shouldKeepSent({ isCatPhoto: false })).toBe(false);
  });
});

describe('SYC-186 keptSentItem', () => {
  it('has the shape markReview gives a synced spot, plus keptAtSend', () => {
    const item = keptSentItem(base);
    expect(item).toMatchObject({
      localId: 'a1',
      status: 'review',
      keptAtSend: true,
      sightingId: 7,
      isCatPhoto: true,
      matchCheck: 'done',
    });
    expect(item.photoBase64).toBeUndefined();
  });
  it('keeps a failed check as failed and re-checkable', () => {
    const item = keptSentItem({
      ...base,
      answer: { ...answer, matchCheck: 'failed', canRecheck: true },
    });
    expect(item.matchCheck).toBe('failed');
    expect(item.canRecheck).toBe(true);
  });
  it('carries extras and the hint only when there are some', () => {
    expect('extraPhotos' in keptSentItem(base)).toBe(false);
    expect('hintCatId' in keptSentItem(base)).toBe(false);
    const item = keptSentItem({
      ...base,
      extraPhotos: [{ role: 'face', photoUri: 'idb:a1-face' }],
      hintCatId: 12,
    });
    expect(item.extraPhotos).toHaveLength(1);
    expect(item.hintCatId).toBe(12);
  });
});

describe('SYC-186 addKept', () => {
  it('adds once: the same localId replaces rather than doubles', () => {
    const item = keptSentItem(base);
    expect(addKept(addKept([], item), item)).toHaveLength(1);
  });
  it('two sends are two items', () => {
    const list = addKept(addKept([], keptSentItem(base)), keptSentItem({ ...base, localId: 'b2' }));
    expect(list.map((p) => p.localId)).toEqual(['a1', 'b2']);
  });
});

describe('SYC-186 a kept item is left alone by the queue', () => {
  const old = keptSentItem({ ...base, createdAt: '2020-01-01T00:00:00.000Z' });
  it('markStaleItems never flags a review item, however old', () => {
    const r = markStaleItems([old], Date.now());
    expect(r.changed).toBe(false);
    expect(r.items[0]!.status).toBe('review');
  });
});

describe('SYC-186 reviewNews', () => {
  const synced: PendingSighting = { ...keptSentItem({ ...base, localId: 's1' }), keptAtSend: undefined };
  it('counts a spot that just synced, not one kept at send', () => {
    const list = [keptSentItem(base), synced];
    expect(reviewNews(list).map((p) => p.localId)).toEqual(['s1']);
  });
});
