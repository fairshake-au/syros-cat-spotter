// @vitest-environment jsdom
/**
 * SYC-42 review of #55: the report queue's React wiring.
 *  - S3: "Try again" really puts a refused report back in the queue and sends it.
 *  - S7: on a phone, the 24-hour reminder is scheduled when the report is
 *    saved and cancelled the moment its text is accepted, including when the
 *    report had to be saved without its photo because storage was full.
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const storage = new Map<string, string>();
  return {
    storage,
    failWritesContaining: { value: null as string | null },
    customFetch: vi.fn(),
    schedule: vi.fn(async () => 'notif-1'),
    cancel: vi.fn(async () => undefined),
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => h.storage.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      const bad = h.failWritesContaining.value;
      if (bad && v.includes(bad)) throw new Error('QuotaExceededError');
      h.storage.set(k, v);
    }),
  },
}));
vi.mock('@react-native-community/netinfo', () => ({
  default: { addEventListener: vi.fn(() => () => {}) },
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: vi.fn(() => ({ remove: () => {} })) },
}));
vi.mock('expo-notifications', () => ({
  scheduleNotificationAsync: h.schedule,
  cancelScheduledNotificationAsync: h.cancel,
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
vi.mock('@/lib/pendingPhotos', () => ({
  savePendingPhoto: vi.fn(async () => ({ ok: false })),
  readPendingPhoto: vi.fn(async () => ({ status: 'missing' })),
  deletePendingPhoto: vi.fn(async () => undefined),
}));
vi.mock('@workspace/api-client-react', () => ({
  customFetch: (...args: unknown[]) => h.customFetch(...args),
}));
vi.mock('../DeviceContext', () => ({ useDevice: () => ({ deviceId: 'device-1' }) }));
vi.mock('../LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));

import { ReportQueueProvider, useReportQueue } from '../ReportQueueContext';
import { newPendingReport, type PendingReport } from '@/lib/reportQueue';

const KEY = 'cat-spotter/pending-reports';
type Value = ReturnType<typeof useReportQueue>;

function mount() {
  const ref: { current: Value | null } = { current: null };
  function Probe() {
    ref.current = useReportQueue();
    return null;
  }
  render(
    <ReportQueueProvider>
      <Probe />
    </ReportQueueProvider>,
  );
  return ref;
}

function stored(): PendingReport[] {
  const raw = h.storage.get(KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : (parsed.items ?? []);
}

const noSignal = () => Promise.reject(new TypeError('Network request failed'));
const accepted = () => Promise.resolve({ publicId: 'R-1' });

const input = (photo: { uri: string; base64: string } | null) => ({
  severity: 'attention' as const,
  isLitter: false,
  lat: 37.44,
  lng: 24.94,
  note: '',
  language: 'en' as const,
  clientRef: 'c-1',
  photo,
});

beforeEach(() => {
  h.storage.clear();
  h.failWritesContaining.value = null;
  h.customFetch.mockReset();
  h.schedule.mockClear();
  h.cancel.mockClear();
});

describe('ReportQueueProvider', () => {
  it('S7: schedules the 24-hour reminder on save and cancels that same reminder once the text is accepted', async () => {
    h.customFetch.mockImplementation(noSignal);
    const q = mount();
    await waitFor(() => expect(q.current?.ready).toBe(true));
    await act(async () => {
      await q.current!.submitReport(input(null));
    });
    expect(h.schedule).toHaveBeenCalledTimes(1);
    expect(stored()[0]?.nativeReminderId).toBe('notif-1');
    expect(h.cancel).not.toHaveBeenCalled();

    h.customFetch.mockImplementation(accepted);
    await act(async () => {
      await q.current!.syncNow();
    });
    await waitFor(() => expect(h.cancel).toHaveBeenCalledWith('notif-1'));
    expect(stored()).toEqual([]);
  });

  it('S7: when storage is full and the report is saved without its photo, it keeps its reminder id, so the reminder is still cancelled', async () => {
    h.customFetch.mockImplementation(noSignal);
    h.failWritesContaining.value = 'PHOTO-BYTES';
    const q = mount();
    await waitFor(() => expect(q.current?.ready).toBe(true));
    await act(async () => {
      await q.current!.submitReport(input({ uri: 'blob:x', base64: 'PHOTO-BYTES' }));
    });
    const [saved] = stored();
    expect(saved).toMatchObject({ hasPhoto: false, nativeReminderId: 'notif-1' });
    expect(JSON.stringify(saved)).not.toContain('PHOTO-BYTES');

    h.customFetch.mockImplementation(accepted);
    await act(async () => {
      await q.current!.syncNow();
    });
    await waitFor(() => expect(h.cancel).toHaveBeenCalledWith('notif-1'));
  });

  it('nit (review of #55): a report saved while a send is in flight is sent straight after, not on the next timer', async () => {
    let release!: () => void;
    const first = new Promise<{ publicId: string }>((resolve) => {
      release = () => resolve({ publicId: 'R-1' });
    });
    h.customFetch.mockImplementationOnce(() => first).mockImplementation(accepted);
    const q = mount();
    await waitFor(() => expect(q.current?.ready).toBe(true));
    await act(async () => {
      await q.current!.submitReport({ ...input(null), clientRef: 'c-a' });
    });
    await waitFor(() => expect(h.customFetch).toHaveBeenCalledTimes(1));
    await act(async () => {
      await q.current!.submitReport({ ...input(null), clientRef: 'c-b' });
    });
    expect(h.customFetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
    });
    await waitFor(() => expect(stored()).toEqual([]));
    const bodies = h.customFetch.mock.calls.map((c) => String((c[1] as { body: string }).body));
    expect(bodies.some((b) => b.includes('"c-b"'))).toBe(true);
  });

  it('S3: Try again puts a refused report back in the queue and sends it', async () => {
    const failed: PendingReport = {
      ...newPendingReport({
        severity: 'urgent',
        isLitter: false,
        lat: 37.44,
        lng: 24.94,
        note: 'by the steps',
        language: 'en',
        hasPhoto: false,
        clientRef: 'c-2',
      }),
      status: 'failed',
      serverFailures: 3,
    };
    h.storage.set(KEY, JSON.stringify([failed]));
    h.customFetch.mockImplementation(accepted);
    const q = mount();
    await waitFor(() => expect(q.current?.ready).toBe(true));
    // Loading alone never resends a refused report.
    expect(h.customFetch).not.toHaveBeenCalledWith('/api/reports', expect.anything());

    await act(async () => {
      await q.current!.retryFailed();
    });
    expect(h.customFetch).toHaveBeenCalledWith('/api/reports', expect.objectContaining({ method: 'POST' }));
    await waitFor(() => expect(stored()).toEqual([]));
  });
});
