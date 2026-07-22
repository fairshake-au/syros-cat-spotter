import { describe, expect, it } from 'vitest';
import {
  applyServerFailure,
  classifySyncFailure,
  markStaleItems,
  resetForRetry,
  MAX_QUEUE_AGE_MS,
  MAX_SYNC_ATTEMPTS,
  type PendingSighting,
} from '../offlineQueue';

function makeItem(overrides: Partial<PendingSighting> = {}): PendingSighting {
  return {
    localId: 'local-1',
    photoBase64: 'abc',
    photoUri: 'file://photo.jpg',
    lat: 37.4,
    lng: 24.9,
    createdAt: new Date('2026-07-01T00:00:00Z').toISOString(),
    status: 'queued',
    ...overrides,
  };
}

function apiError(status?: number): Error {
  const err = new Error(`server said ${status ?? 'nothing'}`);
  err.name = 'ApiError';
  if (status !== undefined) {
    (err as unknown as { status: number }).status = status;
  }
  return err;
}

describe('classifySyncFailure', () => {
  it('flags 4xx errors as permanent immediately (first attempt)', () => {
    const decision = classifySyncFailure(apiError(422), undefined);
    expect(decision).toEqual({ kind: 'server', permanent: true, failCount: 1 });
  });

  it.each([400, 404, 413, 499])('treats %i as permanent', (status) => {
    const decision = classifySyncFailure(apiError(status), 0);
    expect(decision).toMatchObject({ kind: 'server', permanent: true });
  });

  it('keeps 5xx errors transient before MAX_SYNC_ATTEMPTS', () => {
    expect(classifySyncFailure(apiError(500), undefined)).toEqual({
      kind: 'server',
      permanent: false,
      failCount: 1,
    });
    expect(classifySyncFailure(apiError(503), 1)).toEqual({
      kind: 'server',
      permanent: false,
      failCount: 2,
    });
  });

  it(`flags 5xx errors as permanent on attempt ${MAX_SYNC_ATTEMPTS}`, () => {
    const decision = classifySyncFailure(apiError(500), MAX_SYNC_ATTEMPTS - 1);
    expect(decision).toEqual({
      kind: 'server',
      permanent: true,
      failCount: MAX_SYNC_ATTEMPTS,
    });
  });

  it('treats API errors without a numeric status like 5xx (transient then permanent)', () => {
    expect(classifySyncFailure(apiError(), 0)).toEqual({
      kind: 'server',
      permanent: false,
      failCount: 1,
    });
    expect(classifySyncFailure(apiError(), 2)).toEqual({
      kind: 'server',
      permanent: true,
      failCount: 3,
    });
  });

  it('classifies plain network errors as network (item stays queued)', () => {
    expect(classifySyncFailure(new TypeError('Network request failed'), 2)).toEqual({
      kind: 'network',
    });
    expect(classifySyncFailure('weird throw', 0)).toEqual({ kind: 'network' });
  });
});

describe('applyServerFailure', () => {
  it('marks the item as a server error when permanent', () => {
    const items = [makeItem(), makeItem({ localId: 'local-2' })];
    const next = applyServerFailure(items, 'local-1', {
      kind: 'server',
      permanent: true,
      failCount: 3,
    });
    expect(next[0]).toMatchObject({
      status: 'error',
      errorKind: 'server',
      failCount: 3,
    });
    // Other items untouched.
    expect(next[1]).toEqual(items[1]);
  });

  it('only bumps failCount and keeps the item queued when transient', () => {
    const items = [makeItem()];
    const next = applyServerFailure(items, 'local-1', {
      kind: 'server',
      permanent: false,
      failCount: 2,
    });
    expect(next[0]).toMatchObject({ status: 'queued', failCount: 2 });
    expect(next[0].errorKind).toBeUndefined();
  });
});

describe('markStaleItems', () => {
  const now = new Date('2026-07-22T00:00:00Z').getTime();

  it('flags queued items older than 30 days as stale errors', () => {
    const old = makeItem({
      createdAt: new Date(now - MAX_QUEUE_AGE_MS - 1000).toISOString(),
    });
    const { items, changed } = markStaleItems([old], now);
    expect(changed).toBe(true);
    expect(items[0]).toMatchObject({ status: 'error', errorKind: 'stale' });
  });

  it('leaves items at or under the age limit queued', () => {
    const fresh = makeItem({ createdAt: new Date(now - 1000).toISOString() });
    const boundary = makeItem({
      localId: 'local-2',
      createdAt: new Date(now - MAX_QUEUE_AGE_MS).toISOString(),
    });
    const { items, changed } = markStaleItems([fresh, boundary], now);
    expect(changed).toBe(false);
    expect(items.every((p) => p.status === 'queued')).toBe(true);
  });

  it('never touches review or error items, even if old', () => {
    const oldDate = new Date(now - MAX_QUEUE_AGE_MS * 2).toISOString();
    const review = makeItem({ createdAt: oldDate, status: 'review' });
    const errored = makeItem({
      localId: 'local-2',
      createdAt: oldDate,
      status: 'error',
      errorKind: 'server',
    });
    const { items, changed } = markStaleItems([review, errored], now);
    expect(changed).toBe(false);
    expect(items[0].status).toBe('review');
    expect(items[1]).toMatchObject({ status: 'error', errorKind: 'server' });
  });
});

describe('resetForRetry', () => {
  it('requeues the item and resets the fail count', () => {
    const failed = makeItem({
      status: 'error',
      errorKind: 'server',
      failCount: 3,
    });
    const other = makeItem({ localId: 'local-2', failCount: 1 });
    const next = resetForRetry([failed, other], 'local-1');
    expect(next[0]).toMatchObject({
      status: 'queued',
      errorKind: undefined,
      failCount: 0,
    });
    expect(next[1]).toEqual(other);
  });
});

describe('full retry cycle', () => {
  it('a retried item gets a fresh set of attempts before flagging again', () => {
    let items = [makeItem()];
    // Fail 3 times with 5xx → flagged.
    let failCount: number | undefined;
    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i++) {
      const decision = classifySyncFailure(apiError(500), failCount);
      expect(decision.kind).toBe('server');
      if (decision.kind === 'server') {
        items = applyServerFailure(items, 'local-1', decision);
        failCount = decision.failCount;
      }
    }
    expect(items[0]).toMatchObject({ status: 'error', failCount: 3 });

    // User retries → queued with failCount 0.
    items = resetForRetry(items, 'local-1');
    expect(items[0]).toMatchObject({ status: 'queued', failCount: 0 });

    // First failure after retry is transient again.
    const decision = classifySyncFailure(apiError(500), items[0].failCount);
    expect(decision).toEqual({ kind: 'server', permanent: false, failCount: 1 });
  });
});
