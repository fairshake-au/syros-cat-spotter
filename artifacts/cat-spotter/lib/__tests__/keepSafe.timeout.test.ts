/**
 * SYC-524 review I1: the onboarding email request has a transport timeout
 * (Android's fetch has none), passed through addKeepSafe's optional options.
 * Other callers keep the client's default.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({
  ApiError: class ApiError extends Error {},
  customFetch: (...a: unknown[]) => h.fetch(...a),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

import { addKeepSafe } from '../keepSafe';

beforeEach(() => { h.fetch.mockReset(); h.fetch.mockResolvedValue({ status: 'pending', addressMask: 'x' }); });

describe('addKeepSafe timeout (SYC-524)', () => {
  it('passes timeoutMs to the client when given', async () => {
    await addKeepSafe('dev-1', { email: 'a@b.co', language: 'en', surface: 'onboarding' }, { timeoutMs: 15_000 });
    expect(h.fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', timeoutMs: 15_000 });
  });

  it('sets no timeout of its own otherwise', async () => {
    await addKeepSafe('dev-1', { email: 'a@b.co', language: 'en', surface: 'settings' });
    expect(h.fetch.mock.calls[0][1]).not.toHaveProperty('timeoutMs');
  });
});
