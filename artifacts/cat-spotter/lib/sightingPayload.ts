/**
 * The two shapes a new sighting leaves the Spot screen in: the upload
 * request, and the saved-for-later item. Built here so a test can hold them
 * to exactly the fields they have always had (SYC-166 spec §9 tests 6a, 6b):
 * the confirmed pin and the capture time, never anything read from the photo.
 *
 * SYC-415: each may also carry the optional face and body photos, and only
 * when there are some, so a one-photo spot keeps exactly its old shape.
 */
import type { ExtraRole } from './extraPhotos';

interface Pin {
  latitude: number;
  longitude: number;
}

export function sightingRequest(input: {
  deviceId: string;
  photoBase64: string;
  pin: Pin;
  capturedAt: string;
  extraPhotos?: { role: ExtraRole; photoBase64: string }[];
}) {
  const extras = input.extraPhotos ?? [];
  return {
    deviceId: input.deviceId,
    photoBase64: input.photoBase64,
    lat: input.pin.latitude,
    lng: input.pin.longitude,
    // Capture time, not submit time, and sent on the online path too so a
    // sighting's day is decided the same way however it reached the server.
    capturedAt: input.capturedAt,
    ...(extras.length > 0
      ? { extraPhotos: extras.map((e) => ({ role: e.role, photoBase64: e.photoBase64 })) }
      : {}),
  };
}

export function queuedSighting(input: {
  localId: string;
  photo: { uri: string; base64: string };
  pin: Pin;
  capturedAt: string;
  extras?: { role: ExtraRole; uri: string; base64: string }[];
}) {
  const extras = input.extras ?? [];
  return {
    localId: input.localId,
    photoBase64: input.photo.base64,
    photoUri: input.photo.uri,
    lat: input.pin.latitude,
    lng: input.pin.longitude,
    createdAt: input.capturedAt,
    ...(extras.length > 0
      ? { extraPhotos: extras.map((e) => ({ role: e.role, photoUri: e.uri, photoBase64: e.base64 })) }
      : {}),
  };
}
