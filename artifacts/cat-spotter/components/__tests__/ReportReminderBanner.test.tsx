// @vitest-environment jsdom
/**
 * SYC-42 review S3: the one 24-hour reminder covers reports the server
 * refused too, and offers a working "Try again" that requeues them.
 */
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ accent: '#123', accentForeground: '#fff' }) }));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS: T } = await import('@/lib/i18n');
  return { useLanguage: () => ({ t: (key: string) => T.en[key] ?? key }) };
});
const queue = vi.hoisted(() => ({
  reminderVisible: true,
  dismissReminder: vi.fn(),
  syncNow: vi.fn(async () => undefined),
  retryFailed: vi.fn(async () => undefined),
}));
vi.mock('@/context/ReportQueueContext', () => ({ useReportQueue: () => queue }));

import { TRANSLATIONS } from '@/lib/i18n';
import { ReportReminderBanner } from '../ReportReminderBanner';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ReportReminderBanner', () => {
  it('says a report has not sent, and Try again requeues refused reports and sends', async () => {
    const { getByText } = render(<ReportReminderBanner />);
    expect(getByText(TRANSLATIONS.en.reportReminder)).toBeTruthy();
    fireEvent.click(getByText(TRANSLATIONS.en.reportTryAgain));
    await Promise.resolve();
    expect(queue.retryFailed).toHaveBeenCalledTimes(1);
    expect(queue.dismissReminder).toHaveBeenCalled();
  });
});
