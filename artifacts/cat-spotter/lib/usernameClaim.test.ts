import { afterEach, describe, expect, it, vi } from 'vitest';
import type { claimUsername, getClaimedUsername } from '@workspace/api-client-react';
import { CLAIM_WAIT_MS, RECONCILE_WAIT_MS, claimAndReconcile, withDeadline, RequestTimedOut, withUpdatedUsername } from './usernameClaim';

type Dependencies = Parameters<typeof claimAndReconcile>[4];
const mockCalls = (claim: (name: string) => Promise<{ username: string | null }>, read: () => Promise<{ username: string | null }>): Dependencies => ({
  claim: ((_id: string, body: { username: string }) => claim(body.username)) as typeof claimUsername,
  read: (() => read()) as typeof getClaimedUsername,
});

afterEach(() => { vi.useRealTimers(); });

describe('username claim deadlines and reconciliation', () => {
  it('opens immediately on claim success without reading profile statistics', async () => {
    const claimed = vi.fn();
    const read = vi.fn();
    expect(await claimAndReconcile('device', 'NewName', claimed, undefined,
      mockCalls(async () => ({ username: 'NewName' }), read)))
      .toEqual({ kind: 'claimed', username: 'NewName' });
    expect(claimed).toHaveBeenCalledWith('NewName');
    expect(read).not.toHaveBeenCalled();
  });

  it('detects a committed claim when the POST response is delayed, and handles its late success', async () => {
    vi.useFakeTimers();
    let resolveClaim!: (value: { username: string }) => void;
    const slow = new Promise<{ username: string }>((resolve) => { resolveClaim = resolve; });
    const claimed = vi.fn();
    const result = claimAndReconcile('device', 'NewName', claimed, undefined,
      mockCalls(() => slow, async () => ({ username: 'NewName' })));
    await vi.advanceTimersByTimeAsync(CLAIM_WAIT_MS);
    expect(await result).toEqual({ kind: 'claimed', username: 'NewName' });
    resolveClaim({ username: 'NewName' });
    await Promise.resolve();
    expect(claimed).toHaveBeenCalledWith('NewName');
  });

  it('keeps an uncertain name locked for a same-name retry until a late success arrives', async () => {
    vi.useFakeTimers();
    let resolveClaim!: (value: { username: string }) => void;
    const slow = new Promise<{ username: string }>((resolve) => { resolveClaim = resolve; });
    const claimed = vi.fn();
    const result = claimAndReconcile('device', 'SameName', claimed, undefined,
      mockCalls(() => slow, async () => ({ username: null })));
    await vi.advanceTimersByTimeAsync(CLAIM_WAIT_MS);
    expect(await result).toEqual({ kind: 'uncertain' });
    expect(claimed).not.toHaveBeenCalled();
    resolveClaim({ username: 'SameName' });
    await Promise.resolve();
    expect(claimed).toHaveBeenCalledWith('SameName');
  });

  it('bounds unavailable reconciliation and preserves explicit rejection feedback', async () => {
    vi.useFakeTimers();
    const hung = new Promise<{ username: null }>(() => {});
    const result = claimAndReconcile('device', 'Name', vi.fn(), undefined,
      mockCalls(() => hung, () => hung));
    await vi.advanceTimersByTimeAsync(CLAIM_WAIT_MS + RECONCILE_WAIT_MS);
    expect(await result).toEqual({ kind: 'uncertain' });
    const duplicate = { status: 409 };
    expect(await claimAndReconcile('device', 'Name', vi.fn(), undefined,
      mockCalls(async () => { throw duplicate; }, async () => ({ username: null }))))
      .toEqual({ kind: 'rejected', error: duplicate });
    const offensive = { status: 400, data: { code: 'offensive_username' } };
    expect(await claimAndReconcile('device', 'Name', vi.fn(), undefined,
      mockCalls(async () => { throw offensive; }, vi.fn())))
      .toEqual({ kind: 'rejected', error: offensive });
  });

  it('bounds availability without allowing a late answer to replace a newer result', async () => {
    vi.useFakeTimers();
    let late!: (value: string) => void;
    const old = withDeadline(new Promise<string>((resolve) => { late = resolve; }), 100);
    const timedOut = expect(old).rejects.toBeInstanceOf(RequestTimedOut);
    await vi.advanceTimersByTimeAsync(100);
    await timedOut;
    expect(await withDeadline(Promise.resolve('newer'), 100)).toBe('newer');
    late('older');
  });

  it('does not mistake an editor’s old name for confirmation of its new claim', async () => {
    vi.useFakeTimers();
    const pending = new Promise<{ username: string }>(() => {});
    const claimed = vi.fn();
    const result = claimAndReconcile('device', 'NewName', claimed, undefined,
      mockCalls(() => pending, async () => ({ username: 'OldName' })),
      (name) => name === 'NewName');
    await vi.advanceTimersByTimeAsync(CLAIM_WAIT_MS);
    expect(await result).toEqual({ kind: 'uncertain' });
    expect(claimed).not.toHaveBeenCalled();
  });

  it('patches the editor cache without replacing full profile stats', () => {
    const profile = { username: 'Before', points: 42, ownedCatIds: [5], spottedCatIds: [8] };
    expect(withUpdatedUsername(profile, 'After')).toEqual({ ...profile, username: 'After' });
    expect(withUpdatedUsername(undefined, 'After')).toBeUndefined();
  });
});