import { splitDataUrl } from './cameraMode';
import { readPendingPhotoBase64 } from './pendingPhotos';

/**
 * Hands a photo and a place to the report flow (SYC-42 plan item 1.8: "in
 * the spot flow after a photo is taken, which reuses that photo"). A photo is
 * far too big for a route parameter, so the screen that opens the flow leaves
 * it here, and the flow takes it once. In memory only: nothing is kept.
 */
export interface ReportHandoff {
  photo?: { uri: string; base64: string };
  coords?: { latitude: number; longitude: number };
}

let pending: ReportHandoff | null = null;

export function setReportHandoff(handoff: ReportHandoff): void {
  pending = handoff;
}

/** Returns what was left, and forgets it. */
export function takeReportHandoff(): ReportHandoff | null {
  const h = pending;
  pending = null;
  return h;
}

/**
 * The review screen's handoff (Samuel, 2 Oct 2026): the sighting's own photo
 * (inline for a queued sighting, else read from its stored ref) and the place
 * it was taken. With both, the report opens on screen 2, like from Spot. A
 * photo that can't be read is left out; the place still goes.
 */
export async function reviewReportHandoff(
  source: { photoRef?: string; photoBase64?: string; lat?: number | null; lng?: number | null },
  read: (ref: string) => Promise<string | null> = readPendingPhotoBase64,
): Promise<ReportHandoff> {
  let base64: string | null = null;
  if (source.photoBase64) base64 = splitDataUrl(source.photoBase64).base64;
  else if (source.photoRef) base64 = await read(source.photoRef).catch(() => null);
  const handoff: ReportHandoff = {};
  if (base64) handoff.photo = { uri: `data:image/jpeg;base64,${base64}`, base64 };
  if (typeof source.lat === 'number' && typeof source.lng === 'number') {
    handoff.coords = { latitude: source.lat, longitude: source.lng };
  }
  return handoff;
}
