// @vitest-environment jsdom
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// SYC-63: the deletion provider. The tap sends the id in a header, and a 410
// from any request only wipes the phone if the CURRENT identity is the
// deleted one (plan §6.4), never on a late reply about an old one.

const h = vi.hoisted(() => ({
  handler: null as null | (() => void),
  deleteRequest: vi.fn(async (_opts?: RequestInit) => undefined),
  getClaimedUsername: vi.fn(),
  offline: {
    pauseSync: vi.fn(async () => {}),
    resumeSync: vi.fn(),
    wipeQueue: vi.fn(async () => {}),
  },
  resetIdentity: vi.fn(async () => {}),
  clear: vi.fn(),
  reports: {
    sendAllNow: vi.fn(async () => true),
    wipeReports: vi.fn(async () => {}),
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  deleteMyData: h.deleteRequest,
  getClaimedUsername: h.getClaimedUsername,
  setIdentityDeletedHandler: (fn: (() => void) | null) => {
    h.handler = fn;
  },
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ clear: h.clear }),
}));
vi.mock('../DeviceContext', () => ({
  useDevice: () => ({ deviceId: 'dev-current', resetIdentity: h.resetIdentity }),
}));
vi.mock('../OfflineContext', () => ({
  useOffline: () => h.offline,
}));
vi.mock('../ReportQueueContext', () => ({
  useReportQueue: () => h.reports,
}));

import { DeleteMyDataProvider, useDeleteMyData } from '../DeleteMyDataContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DeleteMyDataProvider>{children}</DeleteMyDataProvider>
);

const gone = Object.assign(new Error('HTTP 410'), {
  status: 410,
  data: { code: 'IDENTITY_DELETED' },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DeleteMyDataProvider', () => {
  it('deletes with the id in a header, wipes, and shows Done', async () => {
    const { result } = renderHook(() => useDeleteMyData(), { wrapper });
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.deleteNow();
    });
    expect(outcome).toBe('done');
    expect(h.deleteRequest).toHaveBeenCalledWith({
      headers: { 'X-Device-Id': 'dev-current' },
    });
    expect(h.offline.wipeQueue).toHaveBeenCalled();
    expect(h.clear).toHaveBeenCalled();
    expect(h.resetIdentity).toHaveBeenCalled();
    expect(result.current.doneVisible).toBe(true);
    act(() => result.current.dismissDone());
    expect(result.current.doneVisible).toBe(false);
  });

  it('shows nothing and wipes nothing when the server call fails', async () => {
    h.deleteRequest.mockRejectedValueOnce(new TypeError('offline'));
    const { result } = renderHook(() => useDeleteMyData(), { wrapper });
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.deleteNow();
    });
    expect(outcome).toBe('failed');
    expect(h.offline.wipeQueue).not.toHaveBeenCalled();
    expect(h.resetIdentity).not.toHaveBeenCalled();
    expect(h.offline.resumeSync).toHaveBeenCalled();
    expect(result.current.doneVisible).toBe(false);
  });

  it('finishes the wipe when a 410 is about the current identity', async () => {
    h.getClaimedUsername.mockRejectedValueOnce(gone);
    const { result } = renderHook(() => useDeleteMyData(), { wrapper });
    act(() => h.handler!());
    await waitFor(() => expect(h.resetIdentity).toHaveBeenCalled());
    expect(h.getClaimedUsername).toHaveBeenCalledWith('dev-current');
    expect(h.offline.wipeQueue).toHaveBeenCalled();
    expect(result.current.doneVisible).toBe(true);
  });

  it('ignores a late 410 about an old identity', async () => {
    h.getClaimedUsername.mockResolvedValueOnce({ username: null });
    renderHook(() => useDeleteMyData(), { wrapper });
    act(() => h.handler!());
    await waitFor(() => expect(h.getClaimedUsername).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(h.offline.wipeQueue).not.toHaveBeenCalled();
    expect(h.resetIdentity).not.toHaveBeenCalled();
  });

  it('ignores a 410 that arrives while a deletion is already running', async () => {
    let finishServer!: () => void;
    h.deleteRequest.mockImplementationOnce(
      () => new Promise<undefined>((r) => (finishServer = () => r(undefined))),
    );
    const { result } = renderHook(() => useDeleteMyData(), { wrapper });
    let running!: Promise<unknown>;
    act(() => {
      running = result.current.deleteNow();
    });
    await waitFor(() => expect(h.deleteRequest).toHaveBeenCalled());
    act(() => h.handler!());
    expect(h.getClaimedUsername).not.toHaveBeenCalled();
    await act(async () => {
      finishServer();
      await running;
    });
    expect(h.resetIdentity).toHaveBeenCalledTimes(1);
  });

  it('send: sends waiting cat reports before asking the server', async () => {
    const order: string[] = [];
    h.reports.sendAllNow.mockImplementationOnce(async () => {
      order.push('reports');
      return true;
    });
    h.deleteRequest.mockImplementationOnce(async () => {
      order.push('server');
      return undefined;
    });
    const { result } = renderHook(() => useDeleteMyData(), { wrapper });
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.deleteNow('send');
    });
    expect(outcome).toBe('done');
    expect(order).toEqual(['reports', 'server']);
    expect(h.reports.wipeReports).not.toHaveBeenCalled();
  });

  it('send: deletes nothing when a report will not send', async () => {
    h.reports.sendAllNow.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useDeleteMyData(), { wrapper });
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.deleteNow('send');
    });
    expect(outcome).toBe('reports_unsent');
    expect(h.deleteRequest).not.toHaveBeenCalled();
    expect(h.offline.wipeQueue).not.toHaveBeenCalled();
  });

  it('delete: wipes the cat reports along with everything else', async () => {
    const { result } = renderHook(() => useDeleteMyData(), { wrapper });
    await act(async () => {
      await result.current.deleteNow('delete');
    });
    expect(h.reports.sendAllNow).not.toHaveBeenCalled();
    expect(h.reports.wipeReports).toHaveBeenCalled();
  });
});
