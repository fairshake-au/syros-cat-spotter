import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

import { shouldOptimizePhoto } from '../photoUpload';

describe('shouldOptimizePhoto', () => {
  it('optimizes cellular uploads, including fast 5G', () => {
    expect(
      shouldOptimizePhoto({
        type: 'cellular',
        isConnected: true,
        details: { cellularGeneration: '5g' },
      }),
    ).toBe(true);
  });

  it('optimizes weak Wi-Fi but keeps normal Wi-Fi at full quality', () => {
    expect(
      shouldOptimizePhoto({
        type: 'wifi',
        isConnected: true,
        details: { strength: 25 },
      }),
    ).toBe(true);
    expect(
      shouldOptimizePhoto({
        type: 'wifi',
        isConnected: true,
        details: { strength: 80 },
      }),
    ).toBe(false);
  });

  it('optimizes connections marked expensive and leaves offline state alone', () => {
    expect(
      shouldOptimizePhoto({
        type: 'wifi',
        isConnected: true,
        details: { isConnectionExpensive: true },
      }),
    ).toBe(true);
    expect(shouldOptimizePhoto({ type: 'none', isConnected: false })).toBe(
      false,
    );
  });
});