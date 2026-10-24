// @vitest-environment jsdom
/**
 * SYC-509: the web location picker has a non-drag way to place the pin.
 * The map surface takes keyboard focus, arrow keys move the map under the
 * fixed pin (reporting the new centre), and the zoom buttons are labelled
 * in the app's language and at least 44 px.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => `t:${key}`, language: 'en' }),
}));

import { LocationPicker } from '../LocationPicker.web';

afterEach(cleanup);

const START = { latitude: 37.4448, longitude: 24.9425 };

describe('SYC-509: keyboard alternative to dragging the web map', () => {
  it('is focusable and labelled with how to use it', () => {
    render(<LocationPicker {...START} onChange={() => {}} />);
    const surface = screen.getByLabelText('t:mapPickerLabel');
    expect(surface.getAttribute('tabindex')).toBe('0');
  });

  it('arrow keys move the pin the way a drag would', () => {
    const onChange = vi.fn();
    render(<LocationPicker {...START} onChange={onChange} />);
    const surface = screen.getByLabelText('t:mapPickerLabel');

    fireEvent.keyDown(surface, { key: 'ArrowUp' });
    const north = onChange.mock.calls[0][0];
    expect(north.latitude).toBeGreaterThan(START.latitude);
    expect(north.longitude).toBeCloseTo(START.longitude, 9);

    fireEvent.keyDown(surface, { key: 'ArrowRight' });
    const east = onChange.mock.calls[1][0];
    expect(east.longitude).toBeGreaterThan(START.longitude);
  });

  it('ignores other keys', () => {
    const onChange = vi.fn();
    render(<LocationPicker {...START} onChange={onChange} />);
    fireEvent.keyDown(screen.getByLabelText('t:mapPickerLabel'), { key: 'a' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('labels the zoom buttons in the app language, at 44 px', () => {
    render(<LocationPicker {...START} onChange={() => {}} />);
    for (const label of ['t:mapZoomIn', 't:mapZoomOut']) {
      const btn = screen.getByRole('button', { name: label });
      const css = window.getComputedStyle(btn);
      expect(css.width).toBe('44px');
      expect(css.height).toBe('44px');
    }
  });
});
