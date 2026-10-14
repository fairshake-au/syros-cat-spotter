/**
 * SYC-166 slice 2, spec §9 tests 6a and 6b (plan P4, P5, probe 11): the
 * upload and the saved-for-later item carry exactly the fields they always
 * did, with the confirmed pin and the capture time. A new field (a photo
 * position, say) fails here, and so does the Spot screen building either one
 * by hand.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { queuedSighting, sightingRequest } from '../sightingPayload';

/** The pin the spotter confirmed: deliberately not the photo fixture. */
const PIN = { latitude: 37.4501, longitude: 24.9203 };
const PHOTO_POSITION = ['37.4412345', '24.9412345'];
const CAPTURED = '2026-10-03T15:42:10.001Z';

describe('the upload request (6a)', () => {
  const body = sightingRequest({
    deviceId: 'dev-1',
    photoBase64: 'QUJD',
    pin: PIN,
    capturedAt: CAPTURED,
  });

  it('has exactly the existing keys', () => {
    expect(Object.keys(body).sort()).toEqual(
      ['capturedAt', 'deviceId', 'lat', 'lng', 'photoBase64'].sort(),
    );
  });

  it('carries the confirmed pin and the capture time, nothing photo-derived', () => {
    expect(body).toEqual({
      deviceId: 'dev-1',
      photoBase64: 'QUJD',
      lat: PIN.latitude,
      lng: PIN.longitude,
      capturedAt: CAPTURED,
    });
    const s = JSON.stringify(body);
    for (const part of PHOTO_POSITION) expect(s).not.toContain(part);
  });
});

describe('the saved-for-later item (6b)', () => {
  const item = queuedSighting({
    localId: 'L1',
    photo: { uri: 'file:///a.jpg', base64: 'QUJD' },
    pin: PIN,
    capturedAt: CAPTURED,
  });

  it('has exactly the existing keys', () => {
    expect(Object.keys(item).sort()).toEqual(
      ['localId', 'photoBase64', 'photoUri', 'lat', 'lng', 'createdAt'].sort(),
    );
  });

  it('carries the confirmed pin and the capture time', () => {
    expect(item).toEqual({
      localId: 'L1',
      photoBase64: 'QUJD',
      photoUri: 'file:///a.jpg',
      lat: PIN.latitude,
      lng: PIN.longitude,
      createdAt: CAPTURED,
    });
    const s = JSON.stringify(item);
    for (const part of PHOTO_POSITION) expect(s).not.toContain(part);
  });
});

describe('the Spot screen builds both through these', () => {
  const spot = readFileSync(
    path.resolve(__dirname, '../../app/(tabs)/spot.tsx'),
    'utf8',
  );

  it('createSighting is given sightingRequest(...)', () => {
    expect(spot).toMatch(/createSighting\(\s*sightingRequest\(/);
    expect(spot.match(/createSighting\(/g)).toHaveLength(1);
  });

  it('enqueue is given queuedSighting(...)', () => {
    expect(spot).toMatch(/enqueue\(\s*queuedSighting\(/);
    expect(spot.match(/\benqueue\(/g)).toHaveLength(1);
  });
});
