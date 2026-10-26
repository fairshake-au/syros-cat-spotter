import { describe, expect, it } from 'vitest';
import {
  applyServerFailure,
  classifySyncFailure,
  coverOf,
  extrasOf,
  hintOf,
  markStaleItems,
  rateLimitWaitMs,
  RATE_LIMIT_BASE_WAIT_MS,
  RATE_LIMIT_MAX_WAIT_MS,
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

function apiError(status?: number, data?: unknown): Error {
  const err = new Error(`server said ${status ?? 'nothing'}`);
  err.name = 'ApiError';
  if (status !== undefined) {
    (err as unknown as { status: number }).status = status;
  }
  if (data !== undefined) {
    (err as unknown as { data: unknown }).data = data;
  }
  return err;
}

const GATE_BODY = {
  error: 'prelaunch_pass_required',
  message: "Cat Spotters isn't open yet.",
};

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

  it('recognises the pre-launch gate 401 by its body, not by status alone', () => {
    expect(classifySyncFailure(apiError(401, GATE_BODY), 0)).toEqual({
      kind: 'needs_sign_in',
    });
    // No previous fail count, and a fresh gate 401 later — always the same.
    expect(classifySyncFailure(apiError(401, GATE_BODY), undefined)).toEqual({
      kind: 'needs_sign_in',
    });
  });

  it('does not confuse the device-secret 401/403 with the gate 401', () => {
    // verifyDeviceSecret's shapes (artifacts/api-server/src/lib/deviceAuth.ts):
    // missing header -> 401, wrong secret -> 403. Neither carries the gate's
    // `error: "prelaunch_pass_required"` body, so both keep today's handling.
    expect(
      classifySyncFailure(apiError(401, { error: 'Device secret required' }), 0),
    ).toEqual({ kind: 'server', permanent: true, failCount: 1 });
    expect(
      classifySyncFailure(
        apiError(403, { error: 'Device secret does not match' }),
        0,
      ),
    ).toEqual({ kind: 'server', permanent: true, failCount: 1 });
  });

  it('does not treat a 401 with no body, or a differently-shaped body, as the gate', () => {
    expect(classifySyncFailure(apiError(401), 0)).toEqual({
      kind: 'server',
      permanent: true,
      failCount: 1,
    });
    expect(
      classifySyncFailure(apiError(401, { error: 'something_else' }), 0),
    ).toEqual({ kind: 'server', permanent: true, failCount: 1 });
    expect(classifySyncFailure(apiError(401, 'not json'), 0)).toEqual({
      kind: 'server',
      permanent: true,
      failCount: 1,
    });
  });

  it('every other 4xx keeps today\'s handling, even at 401 status codes from other routes', () => {
    expect(classifySyncFailure(apiError(409, GATE_BODY), 0)).toEqual({
      // Right-shaped body but wrong status: not the gate's 401.
      kind: 'server',
      permanent: true,
      failCount: 1,
    });
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

describe('SYC-415: extrasOf reads stored extras safely', () => {
  it('reads a good list', () => {
    expect(
      extrasOf({ extraPhotos: [{ role: 'face', photoUri: 'f' }, { role: 'body', photoUri: 'b', photoBase64: 'B' }] }),
    ).toEqual([{ role: 'face', photoUri: 'f' }, { role: 'body', photoUri: 'b', photoBase64: 'B' }]);
  });

  it('gives [] for missing, non-array, or malformed values, and never throws', () => {
    expect(extrasOf({})).toEqual([]);
    expect(extrasOf({ extraPhotos: undefined })).toEqual([]);
    expect(extrasOf({ extraPhotos: 'face' })).toEqual([]);
    expect(extrasOf({ extraPhotos: { role: 'face', photoUri: 'p' } })).toEqual([]);
    expect(extrasOf({ extraPhotos: [{ role: 'tail', photoUri: 'p' }] })).toEqual([]);
    expect(extrasOf({ extraPhotos: [{ role: 'face' }] })).toEqual([]);
    expect(extrasOf({ extraPhotos: [{ role: 'face', photoUri: '' }] })).toEqual([]);
    expect(extrasOf({ extraPhotos: [null, 3, 'x'] })).toEqual([]);
    expect(extrasOf({ extraPhotos: [{ role: 'face', photoUri: 'p', photoBase64: 7 }] })).toEqual([
      { role: 'face', photoUri: 'p' },
    ]);
  });

  it('keeps only the first face and the first body', () => {
    expect(
      extrasOf({
        extraPhotos: [
          { role: 'face', photoUri: 'f1' },
          { role: 'face', photoUri: 'f2' },
          { role: 'body', photoUri: 'b1' },
          { role: 'body', photoUri: 'b2' },
        ],
      }),
    ).toEqual([{ role: 'face', photoUri: 'f1' }, { role: 'body', photoUri: 'b1' }]);
  });
});

describe('SYC-415: coverOf keeps the cover uri and base64 paired', () => {
  it('is the face extra when there is one, with its own base64', () => {
    const item = makeItem({
      photoUri: 'first-uri',
      photoBase64: 'FIRST',
      extraPhotos: [{ role: 'face', photoUri: 'face-uri', photoBase64: 'FACE' }],
    });
    expect(coverOf(item)).toEqual({ uri: 'face-uri', base64: 'FACE' });
  });

  it('never pairs the face uri with the first photo base64', () => {
    const item = makeItem({ photoUri: 'first-uri', photoBase64: 'FIRST', extraPhotos: [{ role: 'face', photoUri: 'face-uri' }] });
    expect(coverOf(item)).toEqual({ uri: 'face-uri', base64: undefined });
  });

  it('is the first photo with no face extra (a body extra is never the cover)', () => {
    const item = makeItem({ photoUri: 'first-uri', photoBase64: 'FIRST', extraPhotos: [{ role: 'body', photoUri: 'b' }] });
    expect(coverOf(item)).toEqual({ uri: 'first-uri', base64: 'FIRST' });
    expect(coverOf(makeItem({ photoUri: 'x', photoBase64: undefined }))).toEqual({ uri: 'x', base64: undefined });
  });
});

describe('SYC-574: hintOf, a queued item\'s hint', () => {
  it('reads a positive whole cat id', () => {
    expect(hintOf({ hintCatId: 7 })).toBe(7);
  });
  it.each([undefined, 0, -1, 2.5, '7', null])('ignores %j', (bad) => {
    expect(hintOf({ hintCatId: bad })).toBeUndefined();
  });
  it('ignores a missing item', () => {
    expect(hintOf(undefined)).toBeUndefined();
  });
});

function rateLimited(retryAfter?: string): Error {
  const err = apiError(429);
  if (retryAfter !== undefined) {
    (err as unknown as { headers: Headers }).headers = new Headers({
      'retry-after': retryAfter,
    });
  }
  return err;
}

describe('SYC-196: a 429 is "try later", not a failure', () => {
  it('is rate_limited, never a permanent or counted server failure', () => {
    expect(classifySyncFailure(rateLimited(), 2).kind).toBe('rate_limited');
  });

  it('waits the Retry-After seconds the server sent (plus up to 20% jitter)', () => {
    expect(rateLimitWaitMs(rateLimited('30'), 1, 0, 0)).toBe(30_000);
    expect(rateLimitWaitMs(rateLimited('30'), 1, 0, 1)).toBe(36_000);
  });

  it('reads an HTTP-date Retry-After', () => {
    const now = Date.parse('2026-10-26T10:00:00Z');
    const err = rateLimited('Mon, 26 Oct 2026 10:02:00 GMT');
    expect(rateLimitWaitMs(err, 1, now, 0)).toBe(120_000);
  });

  it('ignores a Retry-After it cannot read and backs off instead', () => {
    expect(rateLimitWaitMs(rateLimited('soon'), 1, 0, 0)).toBe(RATE_LIMIT_BASE_WAIT_MS);
  });

  it('backs off, doubling with each 429 in a row, when there is no Retry-After', () => {
    const waits = [1, 2, 3].map((n) => rateLimitWaitMs(rateLimited(), n, 0, 0));
    expect(waits).toEqual([60_000, 120_000, 240_000]);
  });

  it('never waits longer than the cap, even if told to (and never under a second)', () => {
    expect(rateLimitWaitMs(rateLimited('86400'), 1, 0, 0)).toBe(RATE_LIMIT_MAX_WAIT_MS);
    expect(rateLimitWaitMs(rateLimited(), 30, 0, 0)).toBe(RATE_LIMIT_MAX_WAIT_MS);
    expect(rateLimitWaitMs(rateLimited('0'), 1, 0, 0)).toBe(1000);
    expect(rateLimitWaitMs(rateLimited(), 30, 0, 1)).toBeLessThanOrEqual(
      RATE_LIMIT_MAX_WAIT_MS * 1.2,
    );
  });

  it('other 4xx answers are still permanent', () => {
    expect(classifySyncFailure(apiError(400), 0)).toMatchObject({ permanent: true });
  });
});
