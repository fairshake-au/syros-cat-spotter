// @vitest-environment jsdom
/**
 * SYC-63 plan §8.2: the confirmation screen. Offline, the button is disabled
 * with the E line; with unsent spots it shows the B line with the real count;
 * the A line is always under What stays. Real English copy, so a change to
 * the words of record fails here too.
 */
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRANSLATIONS } from '@/lib/i18n';

const en = TRANSLATIONS.en!;

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () =>
    new Proxy({}, { get: () => '#123456' }) as Record<string, string>,
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const router = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  canGoBack: vi.fn(() => true),
}));
vi.mock('expo-router', () => ({
  useRouter: () => router,
  Stack: { Screen: () => null },
}));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => en[key] ?? key }),
}));
const state = vi.hoisted(() => ({ isOnline: true, unsentCount: 0 }));
vi.mock('@/context/OfflineContext', () => ({
  useOffline: () => state,
}));
// The real Button (it honours `disabled`), without the rest of the kit, whose
// image component pulls in native-only modules.
vi.mock('@/components/purropolis', async () => ({
  Button: (await import('@/components/purropolis/Button')).Button,
}));
const reportQueue = vi.hoisted(() => ({ reports: [] as unknown[] }));
vi.mock('@/context/ReportQueueContext', () => ({
  useReportQueue: () => reportQueue,
}));
const deleteNow = vi.hoisted(() => vi.fn(async () => 'failed'));
vi.mock('@/context/DeleteMyDataContext', () => ({
  useDeleteMyData: () => ({ deleteNow }),
}));

import DeleteMyDataScreen from '@/app/delete-my-data';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.isOnline = true;
  state.unsentCount = 0;
  reportQueue.reports = [];
});

function deleteButton(utils: ReturnType<typeof render>) {
  return utils.getByLabelText(en.deleteConfirm!);
}

describe('Delete my data screen', () => {
  it('shows the copy of record and the cat-at-home line, with no unsent or offline lines', () => {
    const utils = render(<DeleteMyDataScreen />);
    expect(utils.getByText(en.deleteWhatGoesBody!)).toBeTruthy();
    expect(utils.getByText(en.deleteWhatStaysBody!)).toBeTruthy();
    expect(utils.getByTestId('delete-home-line').textContent).toBe(en.deleteWhatStaysHome);
    expect(utils.queryByTestId('delete-unsent-line')).toBeNull();
    expect(utils.queryByTestId('delete-offline-line')).toBeNull();
  });

  it('offline: disables the button and says why', () => {
    state.isOnline = false;
    const utils = render(<DeleteMyDataScreen />);
    expect(utils.getByTestId('delete-offline-line').textContent).toBe(
      en.deleteNeedsConnection,
    );
    fireEvent.click(deleteButton(utils));
    expect(deleteNow).not.toHaveBeenCalled();
  });

  it('says how many unsent spots will go', () => {
    state.unsentCount = 3;
    const utils = render(<DeleteMyDataScreen />);
    expect(utils.getByTestId('delete-unsent-line').textContent).toBe(
      'You have 3 spots that haven’t been sent yet. They’ll be deleted too.',
    );
  });

  it('a failure says nothing was deleted', async () => {
    const utils = render(<DeleteMyDataScreen />);
    fireEvent.click(deleteButton(utils));
    await waitFor(() => expect(deleteNow).toHaveBeenCalled());
    await waitFor(() => expect(utils.getByText(en.deleteFailed!)).toBeTruthy());
  });

  it('Keep my data leaves without deleting', () => {
    const utils = render(<DeleteMyDataScreen />);
    fireEvent.click(utils.getByText(en.deleteKeep!));
    expect(router.back).toHaveBeenCalled();
    expect(deleteNow).not.toHaveBeenCalled();
  });

  it('with a waiting cat report: says so and offers the two approved choices', async () => {
    reportQueue.reports = [{}];
    const utils = render(<DeleteMyDataScreen />);
    expect(utils.getByTestId('delete-reports-block').textContent).toBe(
      en.deleteReportsOne! + en.deleteReportsExplainOne!,
    );
    expect(utils.queryByLabelText(en.deleteConfirm!)).toBeNull();
    fireEvent.click(utils.getByLabelText(en.deleteSendReportsOne!));
    await waitFor(() => expect(deleteNow).toHaveBeenCalledWith('send'));
  });

  it('says nothing was deleted when a report would not send', async () => {
    reportQueue.reports = [{}, {}];
    deleteNow.mockResolvedValueOnce('reports_unsent');
    const utils = render(<DeleteMyDataScreen />);
    expect(utils.getByText('You have 2 cat reports that haven’t been sent yet.')).toBeTruthy();
    fireEvent.click(utils.getByLabelText(en.deleteSendReportsMany!));
    await waitFor(() => expect(utils.getByText(en.deleteReportsUnsentMany!)).toBeTruthy());
    fireEvent.click(utils.getByLabelText(en.deleteReportsTooMany!));
    await waitFor(() => expect(deleteNow).toHaveBeenLastCalledWith('delete'));
  });
});
