import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getForeground = vi.fn();
const requestForeground = vi.fn();
const getCurrentPosition = vi.fn();
let platformOS = 'ios';

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return platformOS;
    },
  },
}));
vi.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...a: unknown[]) => getForeground(...a),
  requestForegroundPermissionsAsync: (...a: unknown[]) => requestForeground(...a),
  getCurrentPositionAsync: (...a: unknown[]) => getCurrentPosition(...a),
}));

import {
  getLocationPermission,
  mapNativePermission,
  mapWebPermission,
} from '../locationPermission';

describe('mapNativePermission', () => {
  it('maps granted', () => {
    expect(mapNativePermission({ status: 'granted', canAskAgain: true })).toBe('granted');
  });
  it.each([true, false])('maps undetermined (canAskAgain %s) to not-asked', (canAskAgain) => {
    expect(mapNativePermission({ status: 'undetermined', canAskAgain })).toBe('not-asked');
  });
  it('maps denied + canAskAgain to denied-can-ask', () => {
    expect(mapNativePermission({ status: 'denied', canAskAgain: true })).toBe('denied-can-ask');
  });
  it('maps denied + !canAskAgain to denied-final', () => {
    expect(mapNativePermission({ status: 'denied', canAskAgain: false })).toBe('denied-final');
  });
});

describe('mapWebPermission', () => {
  it('maps granted, denied, prompt', () => {
    expect(mapWebPermission('granted', null)).toBe('granted');
    expect(mapWebPermission('denied', null)).toBe('denied-final');
    expect(mapWebPermission('prompt', null)).toBe('not-asked');
  });
  it('null with a shared choice is granted', () => {
    expect(mapWebPermission(null, 'shared')).toBe('granted');
  });
  it('null with map or no choice is not-asked', () => {
    expect(mapWebPermission(null, 'map')).toBe('not-asked');
    expect(mapWebPermission(null, null)).toBe('not-asked');
  });
});

describe('getLocationPermission', () => {
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });
  function setNavigator(n: unknown) {
    Object.defineProperty(globalThis, 'navigator', { value: n, configurable: true });
  }

  it('native reads the permission without prompting', async () => {
    platformOS = 'ios';
    getForeground.mockResolvedValue({ status: 'denied', canAskAgain: false });
    expect(await getLocationPermission(null)).toBe('denied-final');
    expect(requestForeground).not.toHaveBeenCalled();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('web without navigator.permissions is not-asked and never reads a position', async () => {
    platformOS = 'web';
    const geoGet = vi.fn();
    setNavigator({ geolocation: { getCurrentPosition: geoGet } });
    expect(await getLocationPermission(null)).toBe('not-asked');
    expect(geoGet).not.toHaveBeenCalled();
  });

  it('web with a rejecting query is not-asked and does not throw', async () => {
    platformOS = 'web';
    setNavigator({ permissions: { query: vi.fn().mockRejectedValue(new Error('nope')) } });
    expect(await getLocationPermission(null)).toBe('not-asked');
  });

  it('web uses the query state', async () => {
    platformOS = 'web';
    setNavigator({ permissions: { query: vi.fn().mockResolvedValue({ state: 'denied' }) } });
    expect(await getLocationPermission(null)).toBe('denied-final');
  });

  it('web with no Permissions API falls back to the stored choice', async () => {
    platformOS = 'web';
    setNavigator({});
    expect(await getLocationPermission('shared')).toBe('granted');
  });
});
