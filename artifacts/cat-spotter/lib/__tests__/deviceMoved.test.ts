import { describe, expect, it } from 'vitest';
import { ApiError } from '@workspace/api-client-react';
import { isDeviceMovedError } from '../deviceMoved';
import { classifySyncFailure } from '../offlineQueue';

// SYC-3: a queued sighting that meets `device_moved` stays queued, untouched,
// and goes under the new spotter after "Start again" (plan test 17).

const apiError = (status: number, data: unknown) =>
  new ApiError(new Response(null, { status }), data, { method: 'POST', url: '/api/sightings' });

describe('device_moved', () => {
  it('is recognised only for 403 {"error":"device_moved"}', () => {
    expect(isDeviceMovedError(apiError(403, { error: 'device_moved' }))).toBe(true);
    expect(isDeviceMovedError(apiError(403, { error: 'Device secret does not match' }))).toBe(false);
    expect(isDeviceMovedError(apiError(401, { error: 'device_moved' }))).toBe(false);
    expect(isDeviceMovedError(new Error('device_moved'))).toBe(false);
  });

  it('pauses the queue rather than failing the sighting', () => {
    expect(classifySyncFailure(apiError(403, { error: 'device_moved' }), 0)).toEqual({ kind: 'moved' });
    // An ordinary 403 is still a permanent server failure.
    expect(classifySyncFailure(apiError(403, { error: 'Device secret does not match' }), 0)).toMatchObject({
      kind: 'server',
      permanent: true,
    });
  });
});
