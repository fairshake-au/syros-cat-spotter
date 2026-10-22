// @vitest-environment jsdom
/**
 * The "Done." screen after Delete my data (email-capture.md §6.3). The line
 * for people who also emailed us (`deleteDoneEmail`) was removed on 22 Oct
 * 2026 (design-review-fixes-oct22.md §1.4): everyone read it, few needed it.
 */
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('@/components/purropolis', async () => {
  const { Button } = await import('@/components/purropolis/Button');
  return { Button };
});
vi.mock('@/context/DeleteMyDataContext', () => ({ useDeleteMyData: () => ({ dismissDone: () => {} }) }));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS } = await import('@/lib/i18n');
  return { useLanguage: () => ({ t: (k: string) => TRANSLATIONS.en[k] ?? k }) };
});

import { DeleteMyDataDone } from '../DeleteMyDataDone';
import { TRANSLATIONS } from '@/lib/i18n';

afterEach(cleanup);

describe('DeleteMyDataDone', () => {
  it('says done, what that means, and offers to carry on, with no line about email requests', () => {
    const { container } = render(<DeleteMyDataDone />);
    const text = container.textContent ?? '';
    expect(text).toContain(TRANSLATIONS.en.deleteDoneTitle);
    expect(text).toContain(TRANSLATIONS.en.deleteDoneBody);
    expect(text).toContain(TRANSLATIONS.en.deleteDoneContinue);
    expect(text).not.toMatch(/asked us by email/i);
  });

  it('the key is gone from every language', () => {
    for (const code of ['en', 'el', 'fr'] as const) {
      expect(TRANSLATIONS[code].deleteDoneEmail).toBeUndefined();
    }
  });
});
