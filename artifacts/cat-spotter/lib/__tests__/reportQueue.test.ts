/**
 * SYC-42 plan, Slice 1 items 1.11–1.13, tests 20 and 25.
 *
 * The report queue saves first, then sends the text, then the photo, through
 * the same generic store as sightings (one serialised write path; an
 * unreadable list is never overwritten). "Sent" is only true once the server
 * has accepted the text.
 */
import { describe, expect, it, vi } from 'vitest';
import { createQueueStore } from '../queueStore';
import { ChallengeUnavailable } from '../challengeUnavailable';
import {
  REMINDER_AFTER_MS,
  confirmationState,
  dueReminders,
  requeueFailed,
  isPendingReport,
  newPendingReport,
  syncReports,
  type PendingReport,
  type ReportApi,
} from '../reportQueue';

class FakeApiError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

function makeStore(initial: PendingReport[] = []) {
  const state = { value: JSON.stringify(initial) as string | null };
  const store = createQueueStore<PendingReport>({
    read: async () => state.value,
    write: async (raw) => {
      state.value = raw;
    },
    publish: () => undefined,
    isItem: isPendingReport,
  });
  return { store, state };
}

function report(overrides: Partial<PendingReport> = {}): PendingReport {
  return {
    ...newPendingReport({
      severity: 'urgent',
      isLitter: false,
      lat: 37.44,
      lng: 24.94,
      note: 'by the bakery',
      language: 'en',
      hasPhoto: true,
      now: new Date('2026-10-01T10:00:00Z'),
    }),
    photoRef: 'idb:report-x',
    ...overrides,
  };
}

function api(overrides: Partial<ReportApi> = {}): ReportApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    submit: vi.fn(async (body) => {
      calls.push(`text:${body.clientRef}`);
      return { publicId: `pub-${body.clientRef}` };
    }),
    uploadPhoto: vi.fn(async (publicId) => {
      calls.push(`photo:${publicId}`);
    }),
    ...overrides,
  };
}

const photos = {
  readPhoto: vi.fn(async () => 'BASE64PHOTO'),
  deletePhoto: vi.fn(async () => undefined),
  getToken: vi.fn(async () => null as string | null),
};

describe('syncReports', () => {
  it('test 20: sends the text, then the photo, then forgets the report', async () => {
    const r = report();
    const { store } = makeStore([r]);
    await store.load();
    const a = api();
    const sent: string[] = [];
    await syncReports(store, { api: a, deviceId: 'dev-1', ...photos, onTextAccepted: (id) => sent.push(id) });
    expect(a.calls).toEqual([`text:${r.clientRef}`, `photo:pub-${r.clientRef}`]);
    expect(store.items()).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(photos.deletePhoto).toHaveBeenCalledWith('idb:report-x');
  });

  it('test 20: with no signal, nothing changes and the report stays queued', async () => {
    const { store } = makeStore([report()]);
    await store.load();
    const a = api({
      submit: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
    });
    const sent: string[] = [];
    await syncReports(store, { api: a, deviceId: 'dev-1', ...photos, onTextAccepted: (id) => sent.push(id) });
    expect(store.items()).toHaveLength(1);
    expect(store.items()[0]!.status).toBe('queued');
    expect(sent).toEqual([]);
  });

  it('when the text gets through but the photo does not, the report waits for the photo only', async () => {
    const { store } = makeStore([report()]);
    await store.load();
    const a = api({
      uploadPhoto: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
    });
    await syncReports(store, { api: a, deviceId: 'dev-1', ...photos });
    const [item] = store.items();
    expect(item!.status).toBe('photo');
    expect(item!.publicId).toMatch(/^pub-/);
    // Next time, only the photo is sent.
    const b = api();
    await syncReports(store, { api: b, deviceId: 'dev-1', ...photos });
    expect(b.calls).toEqual([`photo:${item!.publicId}`]);
    expect(store.items()).toEqual([]);
  });

  it('a report with no photo is done once the text is accepted', async () => {
    const { store } = makeStore([report({ hasPhoto: false, photoRef: undefined })]);
    await store.load();
    const a = api();
    await syncReports(store, { api: a, deviceId: 'dev-1', ...photos });
    expect(a.calls).toHaveLength(1);
    expect(store.items()).toEqual([]);
  });

  it('a server that refuses the text three times marks it failed (separately counted from sightings)', async () => {
    const { store } = makeStore([report()]);
    await store.load();
    const a = api({
      submit: vi.fn(async () => {
        throw new FakeApiError(400);
      }),
    });
    for (let i = 0; i < 3; i++) await syncReports(store, { api: a, deviceId: 'dev-1', ...photos });
    expect(store.items()[0]!.status).toBe('failed');
  });

  it('a busy or gated server (429, 5xx, 401) is retried, never failed', async () => {
    for (const status of [429, 500, 503, 401]) {
      const { store } = makeStore([report()]);
      await store.load();
      const a = api({
        submit: vi.fn(async () => {
          throw new FakeApiError(status);
        }),
      });
      for (let i = 0; i < 5; i++) await syncReports(store, { api: a, deviceId: 'dev-1', ...photos });
      expect(store.items()[0]!.status, String(status)).toBe('queued');
    }
  });

  it('nit (review of #55): a 429 marks the report busy, so the screen can say so; any other failure clears it', async () => {
    const { store } = makeStore([report()]);
    await store.load();
    const busy = api({ submit: vi.fn(async () => { throw new FakeApiError(429); }) });
    await syncReports(store, { api: busy, deviceId: 'dev-1', ...photos });
    expect(store.items()[0]!.busy).toBe(true);
    const down = api({ submit: vi.fn(async () => { throw new TypeError('Network request failed'); }) });
    await syncReports(store, { api: down, deviceId: 'dev-1', ...photos });
    expect(store.items()[0]!.busy).toBeFalsy();
  });

  it('a photo the browser cleared is let go; the text already reached Syros Cats', async () => {
    const { store } = makeStore([report({ status: 'photo', publicId: 'pub-1' })]);
    await store.load();
    const a = api();
    await syncReports(store, {
      api: a,
      deviceId: 'dev-1',
      readPhoto: vi.fn(async () => null),
      deletePhoto: vi.fn(async () => undefined),
      getToken: vi.fn(async () => null),
    });
    expect(a.calls).toEqual([]);
    expect(store.items()).toEqual([]);
  });
});

describe('SYC-170 PR 1.2: the anti-bot check (spec §9.5, tests 16 and 17)', () => {
  /** A token source that hands out a new token each time. */
  function freshTokens() {
    let n = 0;
    return vi.fn(async (_action: string, _cdata: string) => `tok-${++n}`);
  }

  it('T1-9: a 428 is not a strike; the item is kept and resent at once with a new token', async () => {
    const { store } = makeStore([report({ hasPhoto: false, photoRef: undefined })]);
    await store.load();
    const getToken = freshTokens();
    const seen: Array<string | undefined> = [];
    let first = true;
    const a = api({
      submit: vi.fn(async (body) => {
        seen.push(body.turnstileToken);
        if (first) {
          first = false;
          throw new FakeApiError(428);
        }
        return { publicId: 'pub-1' };
      }),
    });
    await syncReports(store, { api: a, deviceId: 'dev-1', ...photos, getToken });
    // One 428, then one resend with a different token, in the same pass.
    expect(seen).toEqual(['tok-1', 'tok-2']);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(store.items()).toEqual([]);
  });

  it('T1-9: a 428 that keeps coming never reaches three strikes; the report stays queued', async () => {
    const { store } = makeStore([report()]);
    await store.load();
    const a = api({
      submit: vi.fn(async () => {
        throw new FakeApiError(428);
      }),
    });
    for (let i = 0; i < 6; i++) {
      await syncReports(store, { api: a, deviceId: 'dev-1', ...photos, getToken: freshTokens() });
    }
    const [item] = store.items();
    expect(item!.status).toBe('queued');
    expect(item!.serverFailures).toBe(0);
    // A real refusal is still counted, so the rule is only for 428.
    const refuse = api({ submit: vi.fn(async () => { throw new FakeApiError(400); }) });
    await syncReports(store, { api: refuse, deviceId: 'dev-1', ...photos, getToken: freshTokens() });
    expect(store.items()[0]!.serverFailures).toBe(1);
  });

  it('503 (try again, or our key not set) stays retryable with no strike', async () => {
    const { store } = makeStore([report()]);
    await store.load();
    const a = api({ submit: vi.fn(async () => { throw new FakeApiError(503); }) });
    for (let i = 0; i < 5; i++) {
      await syncReports(store, { api: a, deviceId: 'dev-1', ...photos, getToken: freshTokens() });
    }
    expect(store.items()[0]!.status).toBe('queued');
    expect(store.items()[0]!.serverFailures).toBe(0);
  });

  it('T1-10: ChallengeUnavailable keeps the item queued with no strike, and the screen says so', async () => {
    const { store } = makeStore([report()]);
    await store.load();
    const a = api();
    const getToken = vi.fn(async (): Promise<string | null> => {
      throw new ChallengeUnavailable('timeout');
    });
    for (let i = 0; i < 5; i++) {
      await syncReports(store, { api: a, deviceId: 'dev-1', ...photos, getToken });
    }
    const [item] = store.items();
    expect(item!.status).toBe('queued');
    expect(item!.serverFailures).toBe(0);
    expect(a.submit).not.toHaveBeenCalled(); // nothing was sent without a check
    expect(confirmationState(item!.localId, [item!], new Set(), false)).toBe('check');
    // While it is actually trying, it says "sending", not the check message.
    expect(confirmationState(item!.localId, [item!], new Set(), true)).toBe('sending');
    // Next time the check works: it goes through and the message is gone.
    const photoDown = api({
      uploadPhoto: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
    });
    await syncReports(store, { api: photoDown, deviceId: 'dev-1', ...photos, getToken: freshTokens() });
    expect(store.items()[0]!.status).toBe('photo');
    expect(store.items()[0]!.checkUnavailable).toBeFalsy();
  });

  it('T1-11: a fresh token for every send, asked for with the report action and its clientRef', async () => {
    const r = report({ hasPhoto: false, photoRef: undefined });
    const { store } = makeStore([r]);
    await store.load();
    const getToken = freshTokens();
    const tokens: Array<string | undefined> = [];
    const a = api({
      submit: vi.fn(async (body) => {
        tokens.push(body.turnstileToken);
        throw new FakeApiError(503); // keep it queued, so it is sent again
      }),
    });
    for (let i = 0; i < 3; i++) {
      await syncReports(store, { api: a, deviceId: 'dev-1', ...photos, getToken });
    }
    expect(tokens).toEqual(['tok-1', 'tok-2', 'tok-3']);
    expect(getToken).toHaveBeenCalledWith('welfare_report', r.clientRef);
  });

  it('T1-11: the token is never stored in the saved list', async () => {
    const { store, state } = makeStore([report()]);
    await store.load();
    const a = api({
      submit: vi.fn(async () => {
        throw new FakeApiError(428);
      }),
    });
    await syncReports(store, { api: a, deviceId: 'dev-1', ...photos, getToken: freshTokens() });
    expect(state.value).not.toContain('tok-');
    expect(state.value).not.toMatch(/token/i);
    expect(JSON.stringify(store.items())).not.toMatch(/token/i);
    // And the saved shape has no field to hold one.
    expect(Object.keys(report()).filter((k) => /token/i.test(k))).toEqual([]);
    expect(isPendingReport(report())).toBe(true);
  });

  it('a build with no check yet (the phone apps until PR 1.3) sends no token field at all', async () => {
    const { store } = makeStore([report({ hasPhoto: false, photoRef: undefined })]);
    await store.load();
    const a = api();
    await syncReports(store, { api: a, deviceId: 'dev-1', ...photos, getToken: async () => null });
    const body = (a.submit as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect('turnstileToken' in body).toBe(false);
  });
});

describe('confirmationState (item 1.12)', () => {
  it('test 20: "sent" only once the server has accepted the text', () => {
    const r = report();
    expect(confirmationState(r.localId, [r], new Set(), false)).toBe('queued');
    expect(confirmationState(r.localId, [r], new Set(), true)).toBe('sending');
    expect(confirmationState(r.localId, [{ ...r, status: 'photo' }], new Set(), false)).toBe('sent');
    expect(confirmationState(r.localId, [], new Set([r.localId]), false)).toBe('sent');
    expect(confirmationState(r.localId, [{ ...r, status: 'failed' }], new Set(), false)).toBe('failed');
  });

  it('nit (review of #55): a report held back by a 429 is "busy", not "no signal"', () => {
    const r = report({ busy: true });
    expect(confirmationState(r.localId, [r], new Set(), false)).toBe('busy');
    expect(confirmationState(r.localId, [r], new Set(), true)).toBe('sending');
  });

  it('a report that vanished without being accepted is never shown as sent', () => {
    expect(confirmationState('gone', [], new Set(), false)).toBe('queued');
  });
});

describe('dueReminders (item 1.13, test 25)', () => {
  it('fires once per unsent report after 24 hours', () => {
    const created = new Date('2026-10-01T10:00:00Z');
    const r = report({ createdAt: created.toISOString() });
    const before = new Date(created.getTime() + REMINDER_AFTER_MS - 1000);
    const after = new Date(created.getTime() + REMINDER_AFTER_MS + 1000);
    expect(dueReminders([r], before)).toEqual([]);
    expect(dueReminders([r], after).map((x) => x.localId)).toEqual([r.localId]);
    const reminded = { ...r, remindedAt: after.toISOString() };
    expect(dueReminders([reminded], new Date(after.getTime() + 86_400_000))).toEqual([]);
  });

  it('S3 (review of #55): a report the server refused (failed) is reminded about too, once', () => {
    const r = report({ createdAt: '2026-09-01T00:00:00Z', status: 'failed', serverFailures: 3 });
    expect(dueReminders([r], new Date('2026-10-01T00:00:00Z')).map((x) => x.localId)).toEqual([r.localId]);
    expect(dueReminders([{ ...r, remindedAt: '2026-10-01T00:00:00Z' }], new Date('2026-10-02T00:00:00Z'))).toEqual([]);
  });

  it('S3: Try again puts failed reports back in the queue with a fresh count, and leaves others alone', () => {
    const failed = report({ status: 'failed', serverFailures: 3 });
    const queued = report({ status: 'queued', serverFailures: 1 });
    const out = requeueFailed([failed, queued]);
    expect(out[0]).toMatchObject({ localId: failed.localId, status: 'queued', serverFailures: 0 });
    expect(out[1]).toBe(queued);
    // Nothing failed: the same list back, so the store skips the write.
    const none = [queued];
    expect(requeueFailed(none)).toBe(none);
  });

  it('a report whose text was accepted (waiting only on its photo) gets no reminder', () => {
    const r = report({ createdAt: '2026-09-01T00:00:00Z', status: 'photo', publicId: 'p' });
    expect(dueReminders([r], new Date('2026-10-01T00:00:00Z'))).toEqual([]);
  });
});

describe('isPendingReport', () => {
  it('accepts a saved report and refuses a sighting-shaped item', () => {
    expect(isPendingReport(report())).toBe(true);
    expect(isPendingReport({ localId: 'x', photoUri: 'y', status: 'queued' })).toBe(false);
  });
});
