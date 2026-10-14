/**
 * The two shapes a new sighting leaves the Spot screen in: the upload
 * request, and the saved-for-later item. Built here so a test can hold them
 * to exactly the fields they have always had (SYC-166 spec §9 tests 6a, 6b):
 * the confirmed pin and the capture time, never anything read from the photo.
 */

interface Pin {
  latitude: number;
  longitude: number;
}

export function sightingRequest(input: {
  deviceId: string;
  photoBase64: string;
  pin: Pin;
  capturedAt: string;
}) {
  return {
    deviceId: input.deviceId,
    photoBase64: input.photoBase64,
    lat: input.pin.latitude,
    lng: input.pin.longitude,
    // Capture time, not submit time, and sent on the online path too so a
    // sighting's day is decided the same way however it reached the server.
    capturedAt: input.capturedAt,
  };
}

export function queuedSighting(input: {
  localId: string;
  photo: { uri: string; base64: string };
  pin: Pin;
  capturedAt: string;
}) {
  return {
    localId: input.localId,
    photoBase64: input.photo.base64,
    photoUri: input.photo.uri,
    lat: input.pin.latitude,
    lng: input.pin.longitude,
    createdAt: input.capturedAt,
  };
}
