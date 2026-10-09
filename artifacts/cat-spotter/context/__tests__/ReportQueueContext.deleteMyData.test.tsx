// @vitest-environment jsdom
/**
 * SYC-234: the report queue's part in "Delete my data". "Send it, then
 * delete" must really send every waiting report (refused ones too) and say
 * truthfully whether any is left; "Delete it too" forgets them, their photos
 * and their reminders. Harness copied from ReportQueueContext.test.tsx.
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
    deleteAllReportPhotos: vi.fn(async () => undefined),
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => h.storage.get(k) ?? null),
    removeItem: vi.fn(async (k: string) => {
      h.storage.delete(k);
    }),
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
  deleteAllReportPhotos: h.deleteAllReportPhotos,
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

function seed(items: PendingReport[]) {
  h.storage.set(KEY, JSON.stringify(items));
}

function report(overrides: Partial<PendingReport> = {}): PendingReport {
  return {
    ...newPendingReport({
      severity: 'urgent',
      isLitter: false,
      lat: 37.44,
      lng: 24.94,
      note: 'Limping by the bakery',
      language: 'en',
      hasPhoto: false,
      clientRef: `c-${Math.random()}`,
    }),
    ...overrides,
  };
}

describe('sendAllNow', () => {
  it('sends a waiting report and says none is left', async () => {
    seed([report()]);
    h.customFetch.mockImplementation(noSignal);
    const q = mount();
    await waitFor(() => expect(q.current?.ready).toBe(true));
    h.customFetch.mockImplementation(accepted);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await q.current!.sendAllNow();
    });
    expect(ok).toBe(true);
    expect(stored()).toEqual([]);
  });

  it('says so when a report will not send, and keeps it', async () => {
    seed([report()]);
    h.customFetch.mockImplementation(noSignal);
    const q = mount();
    await waitFor(() => expect(q.current?.ready).toBe(true));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await q.current!.sendAllNow();
    });
    expect(ok).toBe(false);
    expect(stored()).toHaveLength(1);
  });

  it('gives a refused report another try', async () => {
    seed([report({ status: 'failed', failCount: 3 } as Partial<PendingReport>)]);
    h.customFetch.mockImplementation(accepted);
    const q = mount();
    await waitFor(() => expect(q.current?.ready).toBe(true));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await q.current!.sendAllNow();
    });
    expect(ok).toBe(true);
    expect(h.customFetch).toHaveBeenCalled();
    expect(stored()).toEqual([]);
  });
});

describe('wipeReports', () => {
  it('forgets every waiting report, its photos and its reminder', async () => {
    seed([report({ nativeReminderId: 'notif-9' } as Partial<PendingReport>)]);
    h.customFetch.mockImplementation(noSignal);
    const q = mount();
    await waitFor(() => expect(q.current?.reports).toHaveLength(1));
    await act(async () => {
      await q.current!.wipeReports();
    });
    expect(h.storage.has(KEY)).toBe(false);
    expect(q.current!.reports).toEqual([]);
    expect(h.deleteAllReportPhotos).toHaveBeenCalled();
    expect(h.cancel).toHaveBeenCalledWith('notif-9');
  });
});
