// @vitest-environment jsdom
/**
 * SYC-772: ProgressBar gains hideValue and accessibilityText for the fact
 * progress bar. Without them the bar is unchanged.
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ primary: '#123456', accent: '#654321', muted: '#eeeeee', mutedForeground: '#666666' }),
}));

import { ProgressBar } from '@/components/purropolis/ProgressBar';

describe('ProgressBar', () => {
  afterEach(cleanup);

  it('shows value/max next to the label by default', () => {
    render(<ProgressBar label="L" value={3} max={11} />);
    expect(screen.getByText('L')).toBeTruthy();
    expect(screen.getByText('3/11')).toBeTruthy();
  });

  it('hides value/max with hideValue but keeps the label', () => {
    render(<ProgressBar label="L" value={3} max={11} hideValue />);
    expect(screen.getByText('L')).toBeTruthy();
    expect(screen.queryByText('3/11')).toBeNull();
  });

  it('uses accessibilityText as the label and the value text', () => {
    render(<ProgressBar value={3} max={11} accessibilityText="Cat fact 3 of 11" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-label')).toBe('Cat fact 3 of 11');
    expect(bar.getAttribute('aria-valuetext')).toBe('Cat fact 3 of 11');
  });
});
