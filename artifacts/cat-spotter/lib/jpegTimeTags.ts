/**
 * The website's own reader for a photo's date and time (SYC-166 slice 2W;
 * spec photo-location-from-library.md §4.1, narrowed to time tags only).
 *
 * The website's picker hands over the chosen file as base64 and reads no
 * tags itself, so this reads them from the file. It looks only at the start
 * of a JPEG, finds the Exif block, and keeps the same five time strings that
 * `extractTimeTags` keeps on the phones. Those then go through the same
 * `resolvePhotoTime`, so the website follows the apps' clock rules exactly.
 *
 * Time only, by construction (plan, slice 2W): it never looks up the tag ids
 * for latitude, longitude, altitude or accuracy. In the GPS block it reads
 * the two clock tags and skips every other entry without touching its value.
 * A source check in the tests holds this, so reading location later needs a
 * visible change (slice 5, and only if the device check says it is worth it).
 *
 * Never throws, never hangs: it decodes at most the first 64 KB however big
 * the file, every read is bounds-checked, an IFD may hold at most 512
 * entries, a pointer to an IFD already read stops it, and every marker and
 * entry costs a step from a fixed budget. Anything it is unsure of returns
 * null, which means "no information". Pure, so it tests without React Native.
 */
import type { TimeTags } from './photoClock';

/** Base64 characters decoded: 64 KB of file, a whole number of quanta. */
export const HEAD_CHARS = 87_384;

/** Markers plus IFD entries the reader may visit before it gives up. */
export const MAX_READER_STEPS = 4096;

const MAX_IFD_ENTRIES = 512;
const MAX_TAG_CHARS = 64;

const TYPE_ASCII = 2;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;
const TYPE_IFD = 13;

/** The only tag ids this file knows. */
const TAG = {
  exifPointer: 0x8769,
  gpsPointer: 0x8825,
  dateTimeOriginal: 0x9003,
  offsetTimeOriginal: 0x9011,
  subSecTimeOriginal: 0x9291,
  gpsTimeStamp: 0x0007,
  gpsDateStamp: 0x001d,
} as const;

/** "Exif" then two zero bytes: the start of an Exif APP1 segment. */
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0];

/** Thrown inside the reader only, and always caught: "not sure, say nothing". */
const UNSURE = Symbol('unsure');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DECODE = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) DECODE[ALPHABET.charCodeAt(i)] = i;

/** The first HEAD_CHARS of the base64 (or of a data URL's payload) as bytes. */
function decodeHead(input: string): Uint8Array | null {
  let start = 0;
  if (input.startsWith('data:')) {
    const comma = input.indexOf(',');
    if (comma < 0) return null;
    start = comma + 1;
  }
  const s = input.slice(start, start + HEAD_CHARS);
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 61) end--; // '=' padding
  if (s.length - end > 2) return null;
  const whole = end - (end % 4 === 1 ? 1 : 0);
  const out = new Uint8Array(Math.floor((whole * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < whole; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? DECODE[c] : -1;
    if (v < 0) return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 255;
    }
  }
  return out;
}

interface Meter {
  steps: number;
}

function step(meter: Meter): void {
  if (meter.steps >= MAX_READER_STEPS) throw UNSURE;
  meter.steps++;
}

/** Reads the time tags from the TIFF block at [base, limit). */
function readTiff(b: Uint8Array, base: number, limit: number, meter: Meter): TimeTags {
  const need = (at: number, size: number) => {
    if (!Number.isInteger(at) || at < base || at + size > limit) throw UNSURE;
  };
  let le: boolean;
  need(base, 8);
  if (b[base] === 0x49 && b[base + 1] === 0x49) le = true;
  else if (b[base] === 0x4d && b[base + 1] === 0x4d) le = false;
  else throw UNSURE;
  const u16 = (at: number) => {
    need(at, 2);
    return le ? b[at] | (b[at + 1] << 8) : (b[at] << 8) | b[at + 1];
  };
  const u32 = (at: number) => {
    need(at, 4);
    const v = le
      ? b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)
      : (b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3];
    return v >>> 0;
  };
  if (u16(base + 2) !== 0x2a) throw UNSURE;

  interface Entry {
    tag: number;
    type: number;
    count: number;
    /** Where the 4-byte value-or-offset field sits. */
    field: number;
  }
  const visited = new Set<number>();
  const entriesAt = (offset: number): Entry[] => {
    const at = base + offset;
    if (visited.has(at)) throw UNSURE;
    visited.add(at);
    const n = u16(at);
    if (n > MAX_IFD_ENTRIES) throw UNSURE;
    const out: Entry[] = [];
    for (let k = 0; k < n; k++) {
      step(meter);
      const e = at + 2 + k * 12;
      out.push({ tag: u16(e), type: u16(e + 2), count: u32(e + 4), field: e + 8 });
    }
    return out;
  };
  /** Where an entry's value lives: in the field if it fits, else at an offset. */
  const valueAt = (e: Entry, size: number) => (size <= 4 ? e.field : base + u32(e.field));

  const ascii = (e: Entry): string | undefined => {
    if (e.type !== TYPE_ASCII || e.count === 0 || e.count > MAX_TAG_CHARS) return undefined;
    const at = valueAt(e, e.count);
    need(at, e.count);
    let s = '';
    for (let k = 0; k < e.count; k++) {
      const c = b[at + k];
      if (c === 0) break;
      if (c < 32 || c > 126) return undefined;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const clock = (e: Entry): string | undefined => {
    if (e.type !== TYPE_RATIONAL || e.count !== 3) return undefined;
    const at = valueAt(e, 24);
    need(at, 24);
    const parts: string[] = [];
    for (let k = 0; k < 3; k++) parts.push(`${u32(at + k * 8)}/${u32(at + k * 8 + 4)}`);
    return parts.join(':');
  };
  const pointer = (e: Entry): number => {
    if ((e.type !== TYPE_LONG && e.type !== TYPE_IFD) || e.count !== 1) throw UNSURE;
    return u32(e.field);
  };

  let exifIfd: number | undefined;
  let gpsIfd: number | undefined;
  for (const e of entriesAt(u32(base + 4))) {
    if (e.tag === TAG.exifPointer) exifIfd = pointer(e);
    else if (e.tag === TAG.gpsPointer) gpsIfd = pointer(e);
  }

  const tags: TimeTags = {};
  const keep = (key: keyof TimeTags, value: string | undefined) => {
    if (value !== undefined) tags[key] = value;
  };
  if (exifIfd !== undefined) {
    for (const e of entriesAt(exifIfd)) {
      if (e.tag === TAG.dateTimeOriginal) keep('DateTimeOriginal', ascii(e));
      else if (e.tag === TAG.offsetTimeOriginal) keep('OffsetTimeOriginal', ascii(e));
      else if (e.tag === TAG.subSecTimeOriginal) keep('SubSecTimeOriginal', ascii(e));
    }
  }
  if (gpsIfd !== undefined) {
    // The clock tags only; every other GPS entry is passed over unread.
    for (const e of entriesAt(gpsIfd)) {
      if (e.tag === TAG.gpsDateStamp) keep('GPSDateStamp', ascii(e));
      else if (e.tag === TAG.gpsTimeStamp) keep('GPSTimeStamp', clock(e));
    }
  }
  return tags;
}

function readJpeg(b: Uint8Array, meter: Meter): TimeTags | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  for (;;) {
    step(meter);
    if (i + 1 >= b.length || b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    // End of image, or the scan: no Exif block came first.
    if (marker === 0xd9 || marker === 0xda) return null;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 1) {
      i += 2; // markers with no length
      continue;
    }
    if (i + 3 >= b.length) return null;
    const length = (b[i + 2] << 8) | b[i + 3];
    if (length < 2) return null;
    const start = i + 4;
    const end = i + 2 + length;
    if (marker === 0xe1 && EXIF_HEADER.every((byte, k) => b[start + k] === byte)) {
      // A big Exif block can run past the 64 KB read; what is past it is
      // usually the thumbnail. Any read beyond what we hold is "unsure".
      return readTiff(b, start + EXIF_HEADER.length, Math.min(end, b.length), meter);
    }
    i = end;
  }
}

/**
 * The photo's five time tags from a JPEG's base64 (or a data URL), or null
 * when there is no Exif block or anything about it is unsure. An empty object
 * means the block was read and holds no time. `meter` is for the tests.
 */
export function readJpegTimeTags(
  base64: string,
  meter: Meter = { steps: 0 },
): TimeTags | null {
  try {
    if (typeof base64 !== 'string') return null;
    const bytes = decodeHead(base64);
    return bytes ? readJpeg(bytes, meter) : null;
  } catch {
    return null;
  }
}
