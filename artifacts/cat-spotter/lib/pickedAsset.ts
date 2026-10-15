/**
 * The picker's answer, turned into the photo to send and the photo's own time
 * (SYC-166 slice 2).
 *
 * The time is read first, from the tags the picker handed back, before any
 * step that re-encodes the picture (the over-15 MB shrink here, the
 * weak-connection re-encode at send time). Re-encoding drops the tags; by then
 * only the parsed time is held, so it cannot change the answer.
 *
 * Privacy (plan P2): this is the only file that reads the picker's tag object.
 * That object also holds the photo's GPS position. It goes straight into
 * `extractTimeTags`, which keeps five time strings, and is not stored,
 * returned or logged.
 *
 * The website (slice 2W): its picker reads no tags, so the time comes from the
 * file itself, through `readJpegTimeTags`, which reads time tags only. The
 * same `resolvePhotoTime` then applies, so the website follows the apps' rules.
 */
import { readJpegTimeTags } from './jpegTimeTags';
import { extractTimeTags, resolvePhotoTime, type PhotoTime } from './photoClock';
import { photoFingerprint } from './recentPhotos';

export interface PickedPhoto {
  uri: string;
  base64: string;
}

/**
 * 'unread': we did not get the photo's tags (the camera, a phone picker that
 * returned none, or a website pick with no file bytes), so there is nothing
 * honest to say about its time.
 */
export type PhotoTimeInfo = PhotoTime | { kind: 'unread' };

/**
 * Where a picked photo's time comes from: nowhere (the camera: a photo taken
 * now is dated now), the phone picker's tags, or the file itself (the website).
 */
export type TimeFrom = 'nowhere' | 'pickerTags' | 'file';

export interface PickerAssetLike {
  uri: string;
  base64?: string | null;
  exif?: unknown;
}

function timeInfoFor(asset: PickerAssetLike, timeFrom: TimeFrom, now: number): PhotoTimeInfo {
  if (timeFrom === 'nowhere') return { kind: 'unread' };
  if (timeFrom === 'file') {
    if (!asset.base64) return { kind: 'unread' };
    // We did read the file: finding no time in it is "the photo doesn't say".
    const tags = readJpegTimeTags(asset.base64);
    return tags ? resolvePhotoTime(tags, now) : { kind: 'none', reason: 'missing' };
  }
  const exif = asset.exif;
  // Android's picker can return nothing for a JPEG that does carry a time, so
  // an empty answer is "we don't know", never "the photo doesn't say".
  if (!exif || typeof exif !== 'object' || Object.keys(exif).length === 0) {
    return { kind: 'unread' };
  }
  return resolvePhotoTime(extractTimeTags(exif), now);
}

export async function readPickedAsset(
  asset: PickerAssetLike,
  options: {
    timeFrom: TimeFrom;
    now: number;
    shrink: (uri: string) => Promise<PickedPhoto>;
    maxUploadBytes: number;
  },
): Promise<{ photo: PickedPhoto; timeInfo: PhotoTimeInfo; fingerprint: string }> {
  const timeInfo = timeInfoFor(asset, options.timeFrom, options.now);
  // base64 length * 3/4 ≈ decoded byte size.
  const photo =
    asset.base64 && asset.base64.length * 0.75 <= options.maxUploadBytes
      ? { uri: asset.uri, base64: asset.base64 }
      : await options.shrink(asset.uri);
  const fingerprint = photoFingerprint(asset.base64 || photo.base64);
  return { photo, timeInfo, fingerprint };
}
