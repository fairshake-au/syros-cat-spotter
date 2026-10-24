// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));

import { Chip, CHIP_TAP_PAD } from '../purropolis/Chip';

afterEach(cleanup);

describe('Chip tap area (SYC-644)', () => {
  it('is a button that is 2 x 5px taller than the pill, with the space given back', () => {
    const onPress = vi.fn();
    const view = render(<Chip label="Near me" onPress={onPress} />);
    const button = view.getByRole('button', { name: 'Near me' });
    const style = getComputedStyle(button);
    expect(CHIP_TAP_PAD).toBe(5);
    // 35px pill + 10px = 45px tap area, so the 44pt aim is met.
    expect(style.paddingTop).toBe('5px');
    expect(style.paddingBottom).toBe('5px');
    expect(style.marginTop).toBe('-5px');
    expect(style.marginBottom).toBe('-5px');
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('ignores a tap when disabled', () => {
    const onPress = vi.fn();
    const view = render(<Chip label="All" active disabled onPress={onPress} />);
    const button = view.getByRole('button', { name: 'All' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});
