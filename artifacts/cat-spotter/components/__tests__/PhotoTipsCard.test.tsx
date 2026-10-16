// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => new Proxy({}, { get: () => '#000' }) }));
vi.mock('../photoTips/PhotoTips', () => ({ PhotoTips: () => null }));

import { PhotoTipsCard } from '../photoTips/PhotoTipsCard';

describe('PhotoTipsCard', () => {
  afterEach(cleanup);

  it('shows the title and closes on Got it', () => {
    const onClose = vi.fn();
    const { getByText, container } = render(<PhotoTipsCard visible onClose={onClose} />);
    expect(getByText('photoTipsTitle')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-testid="photo-tips-got-it"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when not visible', () => {
    const { queryByText } = render(<PhotoTipsCard visible={false} onClose={() => {}} />);
    expect(queryByText('photoTipsTitle')).toBeNull();
  });
});
