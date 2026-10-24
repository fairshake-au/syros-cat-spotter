// @vitest-environment jsdom
/**
 * SYC-44 PR 6.1 (report-an-issue.md §3): "Report an issue" is a quiet text
 * link, the same weight as "This cat needs help" or lighter, never bigger.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ mutedForeground: '#666' }) }));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS: T } = await import('@/lib/i18n');
  return { useLanguage: () => ({ t: (key: string) => T.en[key] ?? key }) };
});

import { ReportIssueLink } from '../report/ReportIssueLink';

afterEach(cleanup);

function fontSize(file: string): number {
  const src = readFileSync(join(__dirname, '..', 'report', file), 'utf8');
  const text = src.slice(src.indexOf('text: {'));
  return Number(/fontSize:\s*(\d+)/.exec(text)![1]);
}

describe('ReportIssueLink', () => {
  it('reads "Something wrong on this page?" and calls its handler', () => {
    const onPress = vi.fn();
    const { getByText } = render(<ReportIssueLink onPress={onPress} />);
    fireEvent.click(getByText('Something wrong on this page?'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is never bigger than "This cat needs help"', () => {
    expect(fontSize('ReportIssueLink.tsx')).toBeLessThanOrEqual(fontSize('NeedsHelpLink.tsx'));
  });
});
