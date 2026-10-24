/**
 * SYC-664 T5: the "this phone is waiting for a code" memory, and the code helpers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@workspace/api-client-react', () => ({
  ApiError: class ApiError extends Error {
    data: unknown;
    constructor(data: unknown) { super('api'); this.data = data; }
  },
  customFetch: vi.fn(),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

import { ApiError, customFetch } from '@workspace/api-client-react';
import {
  PENDING_MOVE_MS, RESTORE_WAITING_MINUTES, clearPendingMove, clearWaiting, notePendingMove, noteRequest, noteWrongTry,
  readPendingMove, readWaiting, setMovingHandle,
} from '../restoreWaiting';
import { exchangeRestoreCode, isCodeNotValid, isTooManyTries, normaliseCode } from '../keepSafe';

const MIN = 60_000;
const T0 = 1_800_000_000_000;

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

beforeEach(() => { vi.stubGlobal('window', { localStorage: fakeStorage() }); vi.stubGlobal('localStorage', (globalThis as any).window.localStorage); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('restoreWaiting', () => {
  it('is 15 minutes', () => { expect(RESTORE_WAITING_MINUTES).toBe(15); });

  it('is there at 14:59 and gone at 15:01', () => {
    noteRequest(T0);
    expect(readWaiting(T0 + 14 * MIN + 59_000)).not.toBeNull();
    expect(readWaiting(T0 + 15 * MIN + 1_000)).toBeNull();
    expect(readWaiting(T0 + 1_000)).toBeNull(); // cleared on expiry
  });

  it('T5 clamp: a note stamped more than a minute in the future (clock moved back) is expired', () => {
    noteRequest(T0 + 2 * MIN);
    expect(readWaiting(T0)).toBeNull();
    noteRequest(T0 + 30_000);
    expect(readWaiting(T0)).not.toBeNull();
  });

  it('counts four requests within the window', () => {
    let w = noteRequest(T0);
    for (let i = 1; i < 4; i++) w = noteRequest(T0 + i * MIN);
    expect(w.requests).toBe(4);
    expect(readWaiting(T0 + 4 * MIN)?.requests).toBe(4);
  });

  it('starts again at 1 after the window, and a new request resets wrong tries', () => {
    noteRequest(T0);
    noteWrongTry(T0);
    expect(readWaiting(T0)?.wrongTries).toBe(1);
    expect(noteRequest(T0 + MIN).wrongTries).toBe(0);
    expect(noteRequest(T0 + 30 * MIN).requests).toBe(1);
  });

  it('keeps and clears the moving handle', () => {
    noteRequest(T0);
    setMovingHandle('h1', T0);
    expect(readWaiting(T0)?.movingHandle).toBe('h1');
    setMovingHandle(null, T0);
    expect(readWaiting(T0)?.movingHandle).toBeUndefined();
    clearWaiting();
    expect(readWaiting(T0)).toBeNull();
  });

  it('setMovingHandle with nothing stored starts a note; null with nothing stored does nothing', () => {
    setMovingHandle(null, T0);
    expect(readWaiting(T0)).toBeNull();
    setMovingHandle('h2', T0);
    expect(readWaiting(T0)).toEqual({ askedAt: T0, requests: 0, wrongTries: 0, movingHandle: 'h2' });
  });

  it('noteWrongTry with nothing stored starts a note at one wrong try (on purpose)', () => {
    expect(noteWrongTry(T0)).toEqual({ askedAt: T0, requests: 0, wrongTries: 1 });
    expect(readWaiting(T0)?.wrongTries).toBe(1);
  });

  it('survives storage that throws on every call', () => {
    const boom = () => { throw new Error('blocked'); };
    vi.stubGlobal('window', { localStorage: { getItem: boom, setItem: boom, removeItem: boom } });
    vi.stubGlobal('localStorage', (globalThis as any).window.localStorage);
    expect(readWaiting(T0)).toBeNull();
    expect(() => noteRequest(T0)).not.toThrow();
    expect(noteRequest(T0).requests).toBe(1);
    expect(() => noteWrongTry()).not.toThrow();
    expect(() => setMovingHandle('x')).not.toThrow();
    expect(() => clearWaiting()).not.toThrow();
  });

  it('treats junk in storage as nothing stored', () => {
    (globalThis as any).window.localStorage.setItem('cat-spotter/restore-waiting', '{nope');
    expect(readWaiting(T0)).toBeNull();
  });
});

describe('pending move (SYC-664 final I1)', () => {
  const move = { handle: 'h1', choice: 'c1', abandonCurrent: true, deleteCurrent: true };

  it('SYC-664 ship F2: is kept for 15 minutes (it survives 14), then cleared', () => {
    expect(PENDING_MOVE_MS).toBe(15 * MIN);
    notePendingMove(move, T0);
    expect(readPendingMove(T0 + 14 * MIN)).toEqual({ ...move, at: T0 });
    expect(readPendingMove(T0 + 15 * MIN)).toEqual({ ...move, at: T0 });
    expect(readPendingMove(T0 + 15 * MIN + 1_000)).toBeNull();
    expect(readPendingMove(T0 + 1_000)).toBeNull(); // cleared on expiry
  });

  it('a move stamped further in the future than its own life (clock moved back) is not trusted', () => {
    notePendingMove(move, T0 + 16 * MIN);
    expect(readPendingMove(T0)).toBeNull();
    // Within the clamp it is kept, so at most about 30 minutes in all.
    notePendingMove(move, T0 + 14 * MIN);
    expect(readPendingMove(T0)).not.toBeNull();
  });

  it('is its own key: it outlives the waiting note and clearWaiting clears it too', () => {
    noteRequest(T0 - 15 * MIN + 1_000);
    notePendingMove(move, T0);
    expect(readWaiting(T0 + 2_000)).toBeNull();
    expect(readPendingMove(T0 + 2_000)).not.toBeNull();
    clearWaiting();
    expect(readPendingMove(T0 + 2_000)).toBeNull();
    notePendingMove(move, T0);
    clearPendingMove();
    expect(readPendingMove(T0)).toBeNull();
  });

  it('treats junk as nothing stored', () => {
    (globalThis as any).window.localStorage.setItem('cat-spotter/restore-pending-move', '{"handle":1}');
    expect(readPendingMove(T0)).toBeNull();
  });
});

describe('keepSafe code helpers', () => {
  it('normaliseCode strips all whitespace', () => {
    expect(normaliseCode(' 4829 1376\n')).toBe('48291376');
  });

  it('exchangeRestoreCode posts the device id and code', async () => {
    (customFetch as any).mockResolvedValue({ handle: 'hh' });
    await expect(exchangeRestoreCode('dev-1', '48291376')).resolves.toEqual({ handle: 'hh' });
    const [url, opts] = (customFetch as any).mock.calls[0];
    expect(url).toBe('/api/restore/code');
    expect(opts).toMatchObject({ method: 'POST', body: JSON.stringify({ deviceId: 'dev-1', code: '48291376' }) });
  });

  it('recognises the two refusals', () => {
    const E = ApiError as any;
    expect(isCodeNotValid(new E({ error: 'code_not_valid' }))).toBe(true);
    expect(isCodeNotValid(new E({ error: 'too_many_tries' }))).toBe(false);
    expect(isTooManyTries(new E({ error: 'too_many_tries' }))).toBe(true);
    expect(isTooManyTries(new Error('x'))).toBe(false);
  });
});
