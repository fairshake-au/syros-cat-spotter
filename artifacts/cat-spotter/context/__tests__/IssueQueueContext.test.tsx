// @vitest-environment jsdom
/**
 * SYC-44 PR 6.2: the "Report an issue" list's React wiring. Saved under its
 * own key before anything is sent; sent with a fresh report_issue check; the
 * server's `hidden` kept for the confirmation; the 24-hour reminder
 * scheduled on save and cancelled once the server has the report.
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  reportIssue: vi.fn(),
  getToken: vi.fn(async (_action: string, _cdata: string) => 'tok-fresh'),
  schedule: vi.fn(async () => 'notif-1'),
  cancel: vi.fn(async () => undefined),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => h.storage.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      h.storage.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      h.storage.delete(k);
    }),
  },
}));
vi.mock('@react-native-community/netinfo', () => ({ default: { addEventListener: vi.fn(() => () => {}) } }));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: vi.fn(() => ({ remove: () => {} })) },
}));
vi.mock('expo-notifications', () => ({
  scheduleNotificationAsync: h.schedule,
  cancelScheduledNotificationAsync: h.cancel,
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
vi.mock('@workspace/api-client-react', () => ({ reportIssue: (...a: unknown[]) => h.reportIssue(...a) }));
vi.mock('@/lib/turnstile', () => ({ getTurnstileToken: h.getToken }));
vi.mock('../DeviceContext', () => ({ useDevice: () => ({ deviceId: 'device-1' }) }));
vi.mock('../LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));

import { IssueQueueProvider, useIssueQueue } from '../IssueQueueContext';

const KEY = 'cat-spotter/pending-issues';
type Value = ReturnType<typeof useIssueQueue>;

function mount() {
  const ref: { current: Value | null } = { current: null };
  function Probe() {
    ref.current = useIssueQueue();
    return null;
  }
  render(
    <IssueQueueProvider>
      <Probe />
    </IssueQueueProvider>,
  );
  return ref;
}

const stored = () => {
  const raw = h.storage.get(KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : (parsed.items ?? []);
};

const input = {
  reason: 'photo_private' as const,
  catId: 7,
  photoPublicId: 'ph-abc',
  note: 'a face',
  language: 'en' as const,
};

beforeEach(() => {
  h.storage.clear();
  h.reportIssue.mockReset();
  h.getToken.mockClear();
  h.schedule.mockClear();
  h.cancel.mockClear();
});

describe('IssueQueueProvider', () => {
  it('saves under its own key with no signal, never as hidden, with the reminder scheduled', async () => {
    h.reportIssue.mockImplementation(() => Promise.reject(new TypeError('Network request failed')));
    const q = mount();
    await waitFor(() => expect(q.current?.ready).toBe(true));
    let id = '';
    await act(async () => {
      id = await q.current!.submitIssue(input);
    });
    await waitFor(() => expect(q.current!.syncing).toBe(false));
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ localId: id, reason: 'photo_private', photoPublicId: 'ph-abc', nativeReminderId: 'notif-1' });
    expect(JSON.stringify(stored())).not.toContain('tok-');
    expect(q.current!.replies.has(id)).toBe(false);
    expect(h.storage.has('cat-spotter/pending-reports')).toBe(false);
  });

  it('sends with a fresh report_issue check, keeps the server\'s hidden, and cancels the reminder', async () => {
    h.reportIssue.mockResolvedValue({ publicId: 'I-1', hidden: true });
    const q = mount();
    await waitFor(() => expect(q.current?.ready).toBe(true));
    let id = '';
    await act(async () => {
      id = await q.current!.submitIssue(input);
    });
    await waitFor(() => expect(q.current!.replies.get(id)).toEqual({ hidden: true }));
    const sentRef = h.reportIssue.mock.calls[0]![0].clientRef;
    expect(h.getToken).toHaveBeenCalledWith('report_issue', sentRef);
    expect(h.reportIssue.mock.calls[0]![0]).toMatchObject({ turnstileToken: 'tok-fresh', deviceId: 'device-1' });
    expect(stored()).toEqual([]);
    expect(h.cancel).toHaveBeenCalledWith('notif-1');
  });

  it('wipeIssues forgets every waiting report and its reminder (Delete my data)', async () => {
    h.reportIssue.mockImplementation(() => Promise.reject(new TypeError('Network request failed')));
    const q = mount();
    await waitFor(() => expect(q.current?.ready).toBe(true));
    await act(async () => {
      await q.current!.submitIssue(input);
    });
    await waitFor(() => expect(q.current!.syncing).toBe(false));
    await act(async () => {
      await q.current!.wipeIssues();
    });
    expect(stored()).toEqual([]);
    expect(h.cancel).toHaveBeenCalledWith('notif-1');
  });
});
