/**
 * SYC-44 PR 6.2 (plan T6-5, T6-6, T6-7; spec §13 tests 6, 14 and 16).
 *
 * The "Report an issue" saved list: saved first, sent with a fresh safety
 * check every time, a 428 never a strike, and the words shown chosen from the
 * server's `hidden`, never from the reason.
 */
import { describe, expect, it, vi } from 'vitest';
import { createQueueStore } from '../queueStore';
import { ChallengeUnavailable } from '../challengeUnavailable';
import {
  CAT_REASONS,
  HIDING_REASONS,
  PHOTO_REASONS,
  isPendingIssue,
  issueConfirmation,
  newPendingIssue,
  photoPublicIdFromUrl,
  syncIssues,
  type IssueApi,
  type IssueReason,
  type PendingIssue,
} from '../issueQueue';
import { dueReminders, REMINDER_AFTER_MS, requeueFailed } from '../reportQueue';
import { isPermanentRefusal } from '../checkedSend';

class FakeApiError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

function makeStore(initial: PendingIssue[] = []) {
  const state = { value: JSON.stringify(initial) as string | null };
  const store = createQueueStore<PendingIssue>({
    read: async () => state.value,
    write: async (raw) => {
      state.value = raw;
    },
    publish: () => undefined,
    isItem: isPendingIssue,
  });
  return { store, state };
}

function issue(overrides: Partial<PendingIssue> = {}, reason: IssueReason = 'photo_private'): PendingIssue {
  return {
    ...newPendingIssue({
      reason,
      catId: 7,
      photoPublicId: 'ph-abc',
      note: 'a face by the door',
      language: 'en',
      now: new Date('2026-10-20T10:00:00Z'),
    }),
    ...overrides,
  };
}

function api(reply: { hidden: boolean } = { hidden: true }, overrides: Partial<IssueApi> = {}) {
  const bodies: Parameters<IssueApi['submit']>[0][] = [];
  const a: IssueApi & { bodies: typeof bodies } = {
    bodies,
    submit: vi.fn(async (body) => {
      bodies.push(body);
      return { publicId: `iss-${body.clientRef}`, hidden: reply.hidden };
    }),
    ...overrides,
  };
  return a;
}

let tokenN = 0;
const freshToken = vi.fn(async () => `tok-${++tokenN}`);

describe('newPendingIssue', () => {
  it('keeps the photo id only for a reason that may name a photo (the server refuses it otherwise)', () => {
    expect(issue({}, 'photo_private').photoPublicId).toBe('ph-abc');
    expect(issue({}, 'wrong_cat').photoPublicId).toBe('ph-abc');
    // SYC-487: "Something else" from a photo names it; from the cat page there is no photo to name.
    expect(issue({}, 'other').photoPublicId).toBe('ph-abc');
    expect(newPendingIssue({ reason: 'other', catId: 7, photoPublicId: null, note: '', language: 'en' }).photoPublicId).toBeUndefined();
    expect(issue({}, 'wrong_name').photoPublicId).toBeUndefined();
  });

  it('reads the public id out of a photo address', () => {
    expect(photoPublicIdFromUrl('/api/photos/abc123')).toBe('abc123');
    expect(photoPublicIdFromUrl('https://apptest.catspotters.com/api/photos/abc123?x=1')).toBe('abc123');
    expect(photoPublicIdFromUrl(null)).toBeNull();
    expect(photoPublicIdFromUrl('/something/else')).toBeNull();
  });

  it('the reason lists match the spec (§3.1 and §3.2), and only two reasons hide', () => {
    expect(CAT_REASONS).toEqual(['wrong_name', 'wrong_info', 'location_revealing', 'cat_died', 'wrong_cat', 'other']);
    expect(PHOTO_REASONS).toEqual(['photo_private', 'photo_inappropriate', 'photo_not_cat', 'wrong_cat', 'other']);
    expect([...HIDING_REASONS].sort()).toEqual(['photo_inappropriate', 'photo_private']);
  });
});

describe('syncIssues', () => {
  it('sends the report with a fresh token for report_issue and its clientRef, then forgets it', async () => {
    const item = issue();
    const { store } = makeStore([item]);
    await store.load();
    const a = api({ hidden: true });
    const getToken = vi.fn(async () => 'tok-1');
    const onAccepted = vi.fn();
    await syncIssues(store, { api: a, deviceId: 'dev-1', getToken, onAccepted });
    expect(getToken).toHaveBeenCalledWith('report_issue', item.clientRef);
    expect(a.bodies[0]).toEqual({
      deviceId: 'dev-1',
      clientRef: item.clientRef,
      reason: 'photo_private',
      catId: 7,
      photoPublicId: 'ph-abc',
      note: 'a face by the door',
      language: 'en',
      turnstileToken: 'tok-1',
    });
    expect(onAccepted).toHaveBeenCalledWith(item.localId, { publicId: `iss-${item.clientRef}`, hidden: true });
    expect(store.items()).toEqual([]);
  });

  it('an empty note sends no note field', async () => {
    const { store } = makeStore([issue({ note: '   ' }, 'cat_died')]);
    await store.load();
    const a = api({ hidden: false });
    await syncIssues(store, { api: a, deviceId: 'dev-1', getToken: freshToken });
    expect(a.bodies[0]).not.toHaveProperty('note');
    expect(a.bodies[0]).not.toHaveProperty('photoPublicId');
  });

  it('T6-6: with no signal nothing is sent, the report stays saved and is never called hidden', async () => {
    const item = issue();
    const { store } = makeStore([item]);
    await store.load();
    const offline = api(undefined, {
      submit: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
    });
    const onAccepted = vi.fn();
    await syncIssues(store, { api: offline, deviceId: 'dev-1', getToken: freshToken, onAccepted });
    expect(onAccepted).not.toHaveBeenCalled();
    expect(store.items()).toHaveLength(1);
    expect(store.items()[0]!.status).toBe('queued');
    const shown = issueConfirmation(item.localId, item.reason, store.items(), new Map(), false);
    expect(shown).toBe('queued');
    expect(shown).not.toBe('hidden');
  });

  it('T6-6: a resend from the saved list fetches a fresh token every time, and never stores one', async () => {
    const item = issue();
    const { store, state } = makeStore([item]);
    await store.load();
    let n = 0;
    const a = api(undefined, {
      submit: vi.fn(async () => {
        n += 1;
        if (n === 1) throw new TypeError('Network request failed');
        return { publicId: 'iss-1', hidden: true };
      }),
    });
    const getToken = vi.fn(async () => `tok-${n + 1}`);
    await syncIssues(store, { api: a, deviceId: 'dev-1', getToken });
    expect(state.value).not.toContain('tok-');
    await syncIssues(store, { api: a, deviceId: 'dev-1', getToken });
    expect(getToken).toHaveBeenCalledTimes(2);
    const tokens = (a.submit as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].turnstileToken);
    expect(new Set(tokens).size).toBe(2);
    expect(store.items()).toEqual([]);
  });

  it('T6-7: a 428 is not a strike; the report is kept and resent at once with a new token', async () => {
    const { store } = makeStore([issue()]);
    await store.load();
    let calls = 0;
    const a = api(undefined, {
      submit: vi.fn(async (body) => {
        calls += 1;
        if (calls === 1) throw new FakeApiError(428);
        return { publicId: `iss-${body.clientRef}`, hidden: false };
      }),
    });
    const getToken = vi.fn(async () => `tok-${calls + 1}`);
    await syncIssues(store, { api: a, deviceId: 'dev-1', getToken });
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(store.items()).toEqual([]);
  });

  it('T6-7: a 428 that keeps coming never reaches three strikes; the report stays queued', async () => {
    const { store } = makeStore([issue()]);
    await store.load();
    const a = api(undefined, {
      submit: vi.fn(async () => {
        throw new FakeApiError(428);
      }),
    });
    let clock = Date.parse('2026-10-20T10:00:00Z');
    for (let i = 0; i < 6; i++) {
      await syncIssues(store, { api: a, deviceId: 'dev-1', getToken: freshToken, now: () => clock });
      clock += 60 * 60 * 1000; // past every back-off
    }
    const [kept] = store.items();
    expect(kept!.status).toBe('queued');
    expect(kept!.serverFailures).toBe(0);
    expect(kept!.checkUnavailable).toBe(true);
    // A real refusal is still counted, so the rule is only for 428.
    const b = api(undefined, { submit: vi.fn(async () => { throw new FakeApiError(404); }) });
    for (let i = 0; i < 3; i++) {
      await syncIssues(store, { api: b, deviceId: 'dev-1', getToken: freshToken, now: () => clock });
      clock += 60 * 60 * 1000;
    }
    expect(store.items()[0]!.status).toBe('failed');
  });

  it('T6-7: the shared rule itself says a 428 is never a refusal (its own guard, probed directly)', () => {
    expect(isPermanentRefusal(new FakeApiError(428))).toBe(false);
    expect(isPermanentRefusal(new FakeApiError(404))).toBe(true);
  });

  it('ChallengeUnavailable keeps the report with no strike, and the screen gives the safety-check message', async () => {
    const item = issue();
    const { store } = makeStore([item]);
    await store.load();
    const a = api();
    await syncIssues(store, {
      api: a,
      deviceId: 'dev-1',
      getToken: async () => {
        throw new ChallengeUnavailable('timeout');
      },
    });
    expect(a.submit).not.toHaveBeenCalled();
    const [kept] = store.items();
    expect(kept!.serverFailures).toBe(0);
    expect(issueConfirmation(item.localId, item.reason, store.items(), new Map(), false)).toBe('check');
  });

  it('a 429 marks the report busy and is retried, never failed; 5xx too', async () => {
    const item = issue();
    const { store } = makeStore([item]);
    await store.load();
    await syncIssues(store, { api: api(undefined, { submit: vi.fn(async () => { throw new FakeApiError(429); }) }), deviceId: 'd', getToken: freshToken });
    expect(store.items()[0]!.busy).toBe(true);
    expect(issueConfirmation(item.localId, item.reason, store.items(), new Map(), false)).toBe('busy');
    await syncIssues(store, { api: api(undefined, { submit: vi.fn(async () => { throw new FakeApiError(503); }) }), deviceId: 'd', getToken: freshToken });
    expect(store.items()[0]!.busy).toBe(false);
    expect(store.items()[0]!.serverFailures).toBe(0);
  });

  it('a report taken off the list while another is sending is not sent (review finding 6)', async () => {
    const first = issue({}, 'wrong_name');
    const second = issue({}, 'cat_died');
    const { store } = makeStore([first, second]);
    await store.load();
    const a = api({ hidden: false }, {
      submit: vi.fn(async (body) => {
        // "Delete my data", or another tab, empties the list mid-send.
        if (body.clientRef === first.clientRef) {
          await store.mutate((list) => list.filter((r) => r.localId !== second.localId), 'system');
        }
        return { publicId: 'x', hidden: false };
      }),
    });
    await syncIssues(store, { api: a, deviceId: 'd', getToken: freshToken });
    expect((a.submit as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].reason)).toEqual(['wrong_name']);
  });

  it('one report under a check wait never holds back the next', async () => {
    const resting = issue({ checkDeclinedAt: new Date('2026-10-20T10:00:00Z').toISOString() });
    const next = issue({}, 'wrong_name');
    const { store } = makeStore([resting, next]);
    await store.load();
    const a = api({ hidden: false });
    await syncIssues(store, { api: a, deviceId: 'd', getToken: freshToken, now: () => Date.parse('2026-10-20T10:01:00Z') });
    expect(a.bodies.map((b) => b.reason)).toEqual(['wrong_name']);
    expect(store.items().map((r) => r.localId)).toEqual([resting.localId]);
  });

  it('reminds once, 24 hours on, and Try again puts a refused report back', () => {
    const old = issue({ createdAt: new Date(Date.parse('2026-10-20T10:00:00Z')).toISOString() });
    const later = new Date(Date.parse(old.createdAt) + REMINDER_AFTER_MS);
    expect(dueReminders([old], later)).toEqual([old]);
    expect(dueReminders([{ ...old, remindedAt: later.toISOString() }], later)).toEqual([]);
    const failed = { ...old, status: 'failed' as const, serverFailures: 3 };
    expect(requeueFailed([failed])[0]).toMatchObject({ status: 'queued', serverFailures: 0 });
  });
});

describe('T6-5: the confirmation is chosen from the server\'s `hidden`, never from the reason', () => {
  const sent = (hidden: boolean) => new Map([['L1', { hidden }]]);

  it.each(['photo_private', 'photo_inappropriate'] as const)(
    '%s with hidden: false says "not hidden yet", never the hidden text',
    (reason) => {
      expect(issueConfirmation('L1', reason, [], sent(false), false)).toBe('notHidden');
    },
  );

  it.each(['photo_private', 'photo_inappropriate'] as const)('%s with hidden: true says hidden', (reason) => {
    expect(issueConfirmation('L1', reason, [], sent(true), false)).toBe('hidden');
  });

  it('a reason that never hides gets the plain thank-you; "this cat has died" its gentle line', () => {
    for (const reason of ['photo_not_cat', 'wrong_cat', 'wrong_name', 'wrong_info', 'location_revealing', 'other'] as const) {
      expect(issueConfirmation('L1', reason, [], sent(false), false)).toBe('thanks');
    }
    expect(issueConfirmation('L1', 'cat_died', [], sent(false), false)).toBe('died');
  });

  it('a report still on the phone is never called hidden, whatever its reason', () => {
    const item = issue({ localId: 'L1' });
    for (const syncing of [true, false]) {
      expect(['sending', 'queued']).toContain(issueConfirmation('L1', 'photo_private', [item], new Map(), syncing));
    }
  });

  it('a report sent by another tab (no answer here) claims nothing about the photo', () => {
    expect(issueConfirmation('L1', 'photo_private', [], new Map(), false)).toBe('thanks');
  });
});
