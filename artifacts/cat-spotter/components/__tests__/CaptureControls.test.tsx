// @vitest-environment jsdom
/**
 * The regression guard for the first tester's report: a viewfinder with no
 * camera button on it (SYC-72).
 *
 * This has to be a COMPONENT test. The pure `shutterKindFor` has its own unit
 * tests, but they cannot see a deleted JSX branch — an adversarial review
 * deleted the picker-shutter branch outright and the whole unit suite stayed
 * green. These tests render the real element tree and assert a shutter exists.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// @expo/vector-icons ships extensionless internal imports that vite cannot
// resolve, and the glyph is irrelevant to what these tests assert.
vi.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));

// useColors reaches for AppearanceContext, which these tests do not mount. The
// palette is irrelevant to which shutter renders.
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ secondary: '#eee', secondaryForeground: '#111' }),
}));

import { CaptureControls } from '../CaptureControls';
import { shutterKindFor, type CameraMode } from '@/lib/cameraMode';

function renderControls(overrides: Partial<React.ComponentProps<typeof CaptureControls>> = {}) {
  const props = {
    shutterKind: 'picker' as const,
    onChooseFromLibrary: vi.fn(),
    onCaptureLive: vi.fn(),
    onCaptureWithPicker: vi.fn(),
    libraryLabel: 'Choose from library',
    shutterLabel: 'Take photo',
    ...overrides,
  };
  return { ...render(<CaptureControls {...props} />), props };
}

const shutter = (c: HTMLElement) =>
  c.querySelector('[data-testid="live-camera-shutter"]') ??
  c.querySelector('[data-testid="picker-camera-shutter"]');

describe('CaptureControls', () => {
  it('renders the live shutter when the preview is up', () => {
    const { container } = renderControls({ shutterKind: 'live' });
    expect(container.querySelector('[data-testid="live-camera-shutter"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="picker-camera-shutter"]')).toBeNull();
  });

  it('renders the system-camera shutter when the preview is not up', () => {
    const { container } = renderControls({ shutterKind: 'picker' });
    expect(container.querySelector('[data-testid="picker-camera-shutter"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="live-camera-shutter"]')).toBeNull();
  });

  // The actual invariant. Anyone deleting a shutter branch fails here.
  it.each(['live', 'picker'] as const)(
    'always renders exactly one shutter (%s)',
    (shutterKind) => {
      const { container } = renderControls({ shutterKind });
      const shutters = container.querySelectorAll(
        '[data-testid="live-camera-shutter"], [data-testid="picker-camera-shutter"]',
      );
      expect(shutters).toHaveLength(1);
    },
  );

  // Walk every state the screen can actually be in, through the real decision
  // function, and confirm each one puts a working shutter on screen.
  it('puts a shutter on screen for every reachable camera state', () => {
    const modes: CameraMode[] = ['picker', 'loading', 'request', 'settings', 'ready'];
    for (const mode of modes) {
      for (const cameraFailed of [true, false]) {
        for (const cameraActive of [true, false]) {
          const { container, unmount } = renderControls({
            shutterKind: shutterKindFor(mode, cameraFailed, cameraActive),
          });
          expect(
            shutter(container),
            `no shutter for ${mode}/failed=${cameraFailed}/active=${cameraActive}`,
          ).not.toBeNull();
          unmount();
        }
      }
    }
  });

  it('routes the picker shutter to the system camera, not the library', () => {
    const { container, props } = renderControls({ shutterKind: 'picker' });
    fireEvent.click(container.querySelector('[data-testid="picker-camera-shutter"]')!);
    expect(props.onCaptureWithPicker).toHaveBeenCalledTimes(1);
    expect(props.onChooseFromLibrary).not.toHaveBeenCalled();
    expect(props.onCaptureLive).not.toHaveBeenCalled();
  });

  it('routes the live shutter to the live capture', () => {
    const { container, props } = renderControls({ shutterKind: 'live' });
    fireEvent.click(container.querySelector('[data-testid="live-camera-shutter"]')!);
    expect(props.onCaptureLive).toHaveBeenCalledTimes(1);
    expect(props.onCaptureWithPicker).not.toHaveBeenCalled();
  });

  it('keeps the library button available alongside either shutter', () => {
    for (const shutterKind of ['live', 'picker'] as const) {
      const { container, unmount } = renderControls({ shutterKind });
      expect(
        container.querySelector('[aria-label="Choose from library"]'),
        `library button missing for ${shutterKind}`,
      ).not.toBeNull();
      unmount();
    }
  });
});
