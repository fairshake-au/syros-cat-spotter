// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => new Proxy({}, { get: () => '#000' }) }));
vi.mock('../photoTips/PhotoTips', () => ({ PhotoTips: () => null }));

import { BackHandler } from 'react-native';
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

  it('closes on Escape (web) while visible, and stops listening when hidden', () => {
    const onClose = vi.fn();
    const { rerender } = render(<PhotoTipsCard visible onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<PhotoTipsCard visible={false} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Android hardware back while visible, consuming the press', () => {
    const remove = vi.fn();
    const spy = vi.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove } as any);
    const onClose = vi.fn();
    const { unmount } = render(<PhotoTipsCard visible onClose={onClose} />);
    expect(spy).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function));
    const handler = spy.mock.calls[0][1] as () => boolean;
    expect(handler()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(remove).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('is exposed on the web as a modal dialog', () => {
    const { container } = render(<PhotoTipsCard visible onClose={() => {}} />);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
  });

  it('renders nothing when not visible', () => {
    const { queryByText } = render(<PhotoTipsCard visible={false} onClose={() => {}} />);
    expect(queryByText('photoTipsTitle')).toBeNull();
  });
});
