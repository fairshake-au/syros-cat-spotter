// @vitest-environment jsdom
/**
 * The regression guard for the first tester's report: a viewfinder with no
 * camera button on it (SYC-72), now with the single "Take a photo" button
 * (SYC-575).
 *
 * This has to be a COMPONENT test: a test over a pure state function cannot
 * see a deleted JSX branch. These render the real element tree and assert the
 * button and the library link exist, are labelled, and are wired up.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// @expo/vector-icons ships extensionless internal imports that vite cannot
// resolve, and the glyph is irrelevant to what these tests assert.
vi.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));

// useColors reaches for AppearanceContext, which these tests do not mount.
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    primary: '#c93a74',
    primaryForeground: '#fff',
    secondary: '#eee',
    secondaryForeground: '#111',
  }),
}));

import { CaptureControls } from '../CaptureControls';

function renderControls() {
  const props = {
    onTakePhoto: vi.fn(),
    onChooseFromLibrary: vi.fn(),
    takePhotoLabel: 'Take a photo',
    libraryLabel: 'Choose from your photos',
  };
  return { ...render(<CaptureControls {...props} />), props };
}

describe('CaptureControls', () => {
  it('renders one labelled "Take a photo" button, with the words on screen', () => {
    const { container } = renderControls();
    const buttons = container.querySelectorAll('[data-testid="picker-camera-shutter"]');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute('aria-label')).toBe('Take a photo');
    expect(buttons[0].textContent).toContain('Take a photo');
  });

  it('has no live-view shutter or second camera button', () => {
    const { container } = renderControls();
    expect(container.querySelector('[data-testid="live-camera-shutter"]')).toBeNull();
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(1);
  });

  it('opens the phone camera from the button, and nothing else', () => {
    const { container, props } = renderControls();
    fireEvent.click(container.querySelector('[data-testid="picker-camera-shutter"]')!);
    expect(props.onTakePhoto).toHaveBeenCalledTimes(1);
    expect(props.onChooseFromLibrary).not.toHaveBeenCalled();
  });

  it('shows "Choose from your photos" as a link under the button', () => {
    const { container, props } = renderControls();
    const link = container.querySelector('[data-testid="choose-from-library"]')!;
    expect(link.getAttribute('role')).toBe('link');
    expect(link.textContent).toBe('Choose from your photos');
    fireEvent.click(link);
    expect(props.onChooseFromLibrary).toHaveBeenCalledTimes(1);
    expect(props.onTakePhoto).not.toHaveBeenCalled();
  });
});
