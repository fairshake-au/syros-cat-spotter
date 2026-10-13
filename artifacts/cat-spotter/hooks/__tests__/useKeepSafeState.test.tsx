// @vitest-environment jsdom
/**
 * SYC-274 review of #109: the shared keep-safe lookup needs a device id and a
 * connection, never a username, so Settings works for a spotter restored
 * without one; callers narrow it with `enabled`.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ device: {} as Record<string, unknown>, online: true }));
vi.mock('@/context/DeviceContext', () => ({ useDevice: () => h.device }));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: h.online }) }));
vi.mock('@/lib/keepSafe', () => ({ getKeepSafe: vi.fn(async () => ({ status: 'none' })) }));

import { useKeepSafeState } from '../useKeepSafeState';
import { getKeepSafe } from '@/lib/keepSafe';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.mocked(getKeepSafe).mockClear();
  h.online = true;
});

describe('useKeepSafeState', () => {
  it('fetches for a phone with no username (M)', async () => {
    h.device = { deviceId: 'dev-1', username: null };
    const { result } = renderHook(() => useKeepSafeState(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ status: 'none' }));
    expect(getKeepSafe).toHaveBeenCalledWith('dev-1');
  });

  it('does not fetch offline, or when the caller says not to', async () => {
    h.device = { deviceId: 'dev-1', username: 'Lili' };
    h.online = false;
    renderHook(() => useKeepSafeState(), { wrapper });
    h.online = true;
    renderHook(() => useKeepSafeState({ enabled: false }), { wrapper });
    await new Promise((r) => setTimeout(r, 50));
    expect(getKeepSafe).not.toHaveBeenCalled();
  });
});
