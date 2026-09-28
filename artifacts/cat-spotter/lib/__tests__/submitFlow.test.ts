/**
 * Honest saves (spec §3.5) and "Save and send later" (R5): what pressing
 * "Check for matches" does, whatever the connection and storage do.
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiError as RealApiError } from '@workspace/api-client-react';
import { QueueWriteError } from '../queueStore';
import {
  createSingleFlight,
  describeSaveFailure,
  submitSighting,
  type SubmitSteps,
} from '../submitFlow';

/** The error the generated client throws when the server answers with an error. */
function ApiError(status: number, data: unknown = null): RealApiError {
  const response = new Response(null, { status, statusText: 'Err' });
  return new RealApiError(response, data, { method: 'POST', url: '/api/sightings' });
}

function steps(overrides: Partial<SubmitSteps<{ sightingId: number }>> = {}) {
  return {
    isOnline: true,
    canSaveForLater: true,
    send: vi.fn(async () => ({ sightingId: 1 })),
    save: vi.fn(async () => {}),
    offerSaveForLater: vi.fn(async () => true),
    photosKeepable: vi.fn(async () => true),
    ...overrides,
  };
}

describe('offline', () => {
  it('saves the sighting on the phone', async () => {
    const s = steps({ isOnline: false });
    expect(await submitSighting(s)).toEqual({ kind: 'saved', reason: 'offline' });
    expect(s.send).not.toHaveBeenCalled();
  });

  it('says so when the save fails — it never reports "queued"', async () => {
    const s = steps({
      isOnline: false,
      save: vi.fn(async () => {
        throw new QueueWriteError('failed');
      }),
    });
    expect(await submitSighting(s)).toEqual({ kind: 'save-failed', failure: 'generic' });
  });

  it('explains a read-only queue', async () => {
    const s = steps({
      isOnline: false,
      save: vi.fn(async () => {
        throw new QueueWriteError('read-only');
      }),
    });
    expect(await submitSighting(s)).toEqual({ kind: 'save-failed', failure: 'read-only' });
  });

  it('tells someone in a browser that cannot keep photos to open the link in their main browser (R3)', async () => {
    const s = steps({
      isOnline: false,
      save: vi.fn(async () => {
        throw new QueueWriteError('failed');
      }),
      photosKeepable: vi.fn(async () => false),
    });
    expect(await submitSighting(s)).toEqual({
      kind: 'save-failed',
      failure: 'open-in-browser',
    });
  });
});

describe('online', () => {
  it('sends the sighting', async () => {
    const s = steps();
    expect(await submitSighting(s)).toEqual({ kind: 'sent', result: { sightingId: 1 } });
    expect(s.save).not.toHaveBeenCalled();
  });

  it('R5: on a network failure with a connection reported, offers "Save and send later" and queues it', async () => {
    const s = steps({
      send: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    expect(await submitSighting(s)).toEqual({ kind: 'saved', reason: 'later' });
    expect(s.offerSaveForLater).toHaveBeenCalledTimes(1);
    expect(s.save).toHaveBeenCalledTimes(1);
  });

  it('R5: declining keeps the photo and saves nothing', async () => {
    const s = steps({
      send: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
      offerSaveForLater: vi.fn(async () => false),
    });
    expect(await submitSighting(s)).toEqual({ kind: 'not-saved' });
    expect(s.save).not.toHaveBeenCalled();
  });

  it('R5: a failed "save for later" is reported honestly', async () => {
    const s = steps({
      send: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
      save: vi.fn(async () => {
        throw new QueueWriteError('failed');
      }),
    });
    expect(await submitSighting(s)).toEqual({ kind: 'save-failed', failure: 'generic' });
  });

  it('does not offer to save for later when the queue is read-only', async () => {
    const s = steps({
      canSaveForLater: false,
      send: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    expect(await submitSighting(s)).toEqual({ kind: 'send-failed' });
    expect(s.offerSaveForLater).not.toHaveBeenCalled();
  });

  it('a server error is not a network failure: no offer', async () => {
    const s = steps({
      send: vi.fn(async () => {
        throw ApiError(500);
      }),
    });
    expect(await submitSighting(s)).toEqual({ kind: 'send-failed' });
    expect(s.offerSaveForLater).not.toHaveBeenCalled();
  });

  it('a photo the server rejects is reported with its reason', async () => {
    const s = steps({
      send: vi.fn(async () => {
        throw ApiError(400, { error: 'photo too large' });
      }),
    });
    expect(await submitSighting(s)).toEqual({
      kind: 'rejected',
      rejectionKey: 'photoTooLarge',
    });
  });
});

describe('describeSaveFailure', () => {
  it('falls back to the general wording if the storage check itself fails', async () => {
    expect(
      await describeSaveFailure(new QueueWriteError('failed'), async () => {
        throw new Error('probe blew up');
      }),
    ).toBe('generic');
  });
});

describe('createSingleFlight', () => {
  it('ignores a second tap while the first is still saving', async () => {
    const run = createSingleFlight();
    let release!: () => void;
    const job = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('done');
        }),
    );
    const first = run(job);
    const second = run(job);
    expect(await second).toBeUndefined();
    release();
    expect(await first).toBe('done');
    expect(job).toHaveBeenCalledTimes(1);
    // And lets the next one through afterwards, even after a failure.
    await expect(run(async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(await run(async () => 'again')).toBe('again');
  });
});
