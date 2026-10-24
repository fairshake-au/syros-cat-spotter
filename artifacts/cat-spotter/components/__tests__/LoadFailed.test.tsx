// @vitest-environment jsdom
/**
 * SYC-508 (couldnt-load-try-again.md §2): the shared "Couldn't load" state.
 */
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    primary: '#00f',
    primaryForeground: '#fff',
    foreground: '#000',
    mutedForeground: '#666',
  }),
}));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS: T } = await import('@/lib/i18n');
  return { useLanguage: () => ({ t: (key: string) => T.en[key] ?? key }) };
});

import { TRANSLATIONS } from '@/lib/i18n';
import { LoadFailed } from '../LoadFailed';

const en = TRANSLATIONS.en;

afterEach(cleanup);

describe('LoadFailed', () => {
  it('full size: title, line and Try again', () => {
    const { getByText } = render(<LoadFailed size="full" onRetry={() => {}} />);
    expect(getByText(en.loadFailedTitle)).toBeTruthy();
    expect(getByText(en.loadFailedBody)).toBeTruthy();
    expect(getByText(en.tryAgain)).toBeTruthy();
  });

  it('line size: the standard words, or its own message, and no body line', () => {
    const { getByText, queryByText, rerender } = render(
      <LoadFailed size="line" onRetry={() => {}} />,
    );
    expect(getByText(en.loadFailedTitle)).toBeTruthy();
    expect(queryByText(en.loadFailedBody)).toBeNull();
    rerender(<LoadFailed size="line" onRetry={() => {}} message={en.statsUnavailable} />);
    expect(getByText(en.statsUnavailable)).toBeTruthy();
  });

  it('a second press while trying does nothing; it can be pressed again once it ends', async () => {
    let finish: () => void = () => {};
    const onRetry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { getByText } = render(<LoadFailed size="full" onRetry={onRetry} />);
    fireEvent.click(getByText(en.tryAgain));
    fireEvent.click(getByText(en.tryAgain));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    fireEvent.click(getByText(en.tryAgain));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('a retry that fails ends the busy state too', async () => {
    const onRetry = vi.fn(() => Promise.reject(new Error('still offline')));
    const { getByText } = render(<LoadFailed size="line" onRetry={onRetry} />);
    await act(async () => {
      fireEvent.click(getByText(en.tryAgain));
    });
    await act(async () => {
      fireEvent.click(getByText(en.tryAgain));
    });
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});

describe('LoadFailed for screen readers (SYC-509 rules; no alert role, per its review)', () => {
  it('announces politely (never an interrupting alert) and names what Try again reloads', () => {
    const { container, queryByRole, getByLabelText } = render(
      <LoadFailed size="line" onRetry={() => {}} retryLabel="Try again: your stats" />,
    );
    expect(queryByRole('alert')).toBeNull();
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(getByLabelText('Try again: your stats')).toBeTruthy();
  });

  it('full size: the title is a heading', () => {
    const { getByRole } = render(<LoadFailed size="full" onRetry={() => {}} />);
    expect(getByRole('heading').textContent).toBe(en.loadFailedTitle);
  });
});
