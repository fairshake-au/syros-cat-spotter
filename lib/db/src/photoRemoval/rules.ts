// SYC-462 (spec §5, §5.5): the pure rules of hand removal.

/**
 * The only request references accepted (spec §5): an SYC ticket, or an inbox
 * reference. Never free text, so a name, a phone number or a street can't
 * reach the public workflow log or the database.
 */
export const PHOTO_REF_RE = /^(SYC-[0-9]{1,5}|hello [0-9]{4}-[0-9]{2}-[0-9]{2} #[0-9]{1,3})$/;

export function isPhotoRef(s: string): boolean {
  return PHOTO_REF_RE.test(s);
}

/** A photo's public id: the UUID in its web address. */
export const PUBLIC_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A people id. */
export const PERSON_ID_RE = PUBLIC_ID_RE;

export interface Fingerprint {
  /** 64 characters of the stored base64. */
  text: string;
  /** The same bytes, decoded, for bytea columns. */
  bytes: Buffer;
}

/**
 * A 64-character slice of the picture's base64 from the middle, never the
 * start: the first bytes are a JPEG/EXIF header that many photos from one
 * phone share, and would match them falsely (review 2, finding 5). Aligned to
 * 4 characters, so it decodes to the same bytes wherever they're stored.
 */
export function fingerprint(base64: string): Fingerprint {
  if (base64.length <= 64) return { text: base64, bytes: Buffer.from(base64, "base64") };
  const start = Math.floor((base64.length - 64) / 2 / 4) * 4;
  const text = base64.slice(start, start + 64);
  return { text, bytes: Buffer.from(text, "base64") };
}
