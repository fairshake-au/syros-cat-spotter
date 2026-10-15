/**
 * A tiny hand-assembled JPEG with an Exif block, for the website's time
 * reader tests (SYC-166 slice 2W). Built by hand so the app gains no
 * dependency: SOI, an optional JFIF APP0, an optional XMP APP1, the Exif
 * APP1 (TIFF header, IFD0, the Exif sub-IFD, the GPS sub-IFD), then a
 * stand-in scan and EOI.
 *
 * The GPS block can carry a position (latitude, longitude, altitude, the
 * accuracy tag) as well as its clock, so the privacy test can check by value
 * that none of it comes back out.
 */

export type ByteOrder = 'II' | 'MM';
type Rational = [number, number];

export interface ExifFixture {
  byteOrder?: ByteOrder;
  /** Exif sub-IFD, ASCII. */
  DateTimeOriginal?: string;
  OffsetTimeOriginal?: string;
  SubSecTimeOriginal?: string;
  /** GPS sub-IFD clock. */
  GPSDateStamp?: string;
  GPSTimeStamp?: [Rational, Rational, Rational];
  /** GPS sub-IFD position: must never be read. */
  position?: {
    latitude: [Rational, Rational, Rational];
    longitude: [Rational, Rational, Rational];
    altitude: Rational;
    accuracy: Rational;
  };
  /** Put an XMP APP1 before the Exif one (the reader must skip it). */
  xmpFirst?: boolean;
  /** Add a JFIF APP0 first, as most encoders do. */
  jfif?: boolean;
  /** Make the Exif IFD pointer point back at IFD0 (a pointer loop). */
  loop?: boolean;
  /** Bytes of padding after the image, to make a big file. */
  tailBytes?: number;
}

/** A position near Ermoupoli, with digits that can't occur by accident. */
export const FIXTURE_POSITION = {
  latitude: [
    [37, 1],
    [26, 1],
    [284441, 10000],
  ] as [Rational, Rational, Rational],
  longitude: [
    [24, 1],
    [56, 1],
    [284442, 10000],
  ] as [Rational, Rational, Rational],
  altitude: [123457, 1000] as Rational,
  accuracy: [98765, 1000] as Rational,
};

const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Raw value bytes, already in the file's byte order. */
  bytes: number[];
}

class Writer {
  constructor(private readonly le: boolean) {}
  u16(n: number): number[] {
    return this.le ? [n & 0xff, (n >> 8) & 0xff] : [(n >> 8) & 0xff, n & 0xff];
  }
  u32(n: number): number[] {
    const b = [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    return this.le ? b.reverse() : b;
  }
  ascii(tag: number, s: string): Entry {
    const bytes = [...Array.from(s, (c) => c.charCodeAt(0) & 0xff), 0];
    return { tag, type: ASCII, count: bytes.length, bytes };
  }
  rationals(tag: number, values: Rational[]): Entry {
    return {
      tag,
      type: RATIONAL,
      count: values.length,
      bytes: values.flatMap(([n, d]) => [...this.u32(n), ...this.u32(d)]),
    };
  }
  short(tag: number, n: number): Entry {
    return { tag, type: SHORT, count: 1, bytes: [...this.u16(n), 0, 0] };
  }
  long(tag: number, n: number): Entry {
    return { tag, type: LONG, count: 1, bytes: this.u32(n) };
  }
}

/**
 * Lays out one IFD at `start` (an offset from the TIFF header), with its
 * out-of-line values straight after it. Returns the bytes.
 */
function ifd(w: Writer, start: number, entries: Entry[], next = 0): number[] {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  const head: number[] = [...w.u16(sorted.length)];
  const data: number[] = [];
  let dataAt = start + 2 + sorted.length * 12 + 4;
  for (const e of sorted) {
    head.push(...w.u16(e.tag), ...w.u16(e.type), ...w.u32(e.count));
    if (e.bytes.length <= 4) {
      head.push(...e.bytes, ...new Array(4 - e.bytes.length).fill(0));
    } else {
      head.push(...w.u32(dataAt));
      data.push(...e.bytes);
      if (e.bytes.length % 2) data.push(0);
      dataAt = start + 2 + sorted.length * 12 + 4 + data.length;
    }
  }
  head.push(...w.u32(next));
  return [...head, ...data];
}

function ifdSize(entries: Entry[]): number {
  let n = 2 + entries.length * 12 + 4;
  for (const e of entries) if (e.bytes.length > 4) n += e.bytes.length + (e.bytes.length % 2);
  return n;
}

/** The TIFF block (from the byte-order mark on). */
export function buildTiff(f: ExifFixture): number[] {
  const le = (f.byteOrder ?? 'II') === 'II';
  const w = new Writer(le);

  const exifEntries: Entry[] = [];
  if (f.DateTimeOriginal !== undefined) exifEntries.push(w.ascii(0x9003, f.DateTimeOriginal));
  if (f.OffsetTimeOriginal !== undefined) exifEntries.push(w.ascii(0x9011, f.OffsetTimeOriginal));
  if (f.SubSecTimeOriginal !== undefined) exifEntries.push(w.ascii(0x9291, f.SubSecTimeOriginal));

  const gpsEntries: Entry[] = [];
  if (f.position) {
    gpsEntries.push(
      w.ascii(0x0001, 'N'),
      w.rationals(0x0002, f.position.latitude),
      w.ascii(0x0003, 'E'),
      w.rationals(0x0004, f.position.longitude),
      { tag: 0x0005, type: 1, count: 1, bytes: [0, 0, 0, 0] },
      w.rationals(0x0006, [f.position.altitude]),
      w.rationals(0x001f, [f.position.accuracy]),
    );
  }
  if (f.GPSTimeStamp) gpsEntries.push(w.rationals(0x0007, f.GPSTimeStamp));
  if (f.GPSDateStamp !== undefined) gpsEntries.push(w.ascii(0x001d, f.GPSDateStamp));

  // IFD0: a Make string, then the two pointers (filled in below).
  const ifd0Base: Entry[] = [w.ascii(0x010f, 'FixtureCam'), w.short(0x0112, 1)];
  const ifd0At = 8;
  const ifd0Len = ifdSize([
    ...ifd0Base,
    w.long(0x8769, 0),
    ...(gpsEntries.length ? [w.long(0x8825, 0)] : []),
  ]);
  const exifAt = ifd0At + ifd0Len;
  const gpsAt = exifAt + ifdSize(exifEntries);

  const ifd0Entries = [
    ...ifd0Base,
    w.long(0x8769, f.loop ? ifd0At : exifAt),
    ...(gpsEntries.length ? [w.long(0x8825, gpsAt)] : []),
  ];

  const header = [
    ...(le ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...w.u16(42),
    ...w.u32(ifd0At),
  ];
  return [
    ...header,
    ...ifd(w, ifd0At, ifd0Entries),
    ...ifd(w, exifAt, exifEntries),
    ...(gpsEntries.length ? ifd(w, gpsAt, gpsEntries) : []),
  ];
}

function segment(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0];

/** A whole JPEG file. Pass `null` for one with no Exif block at all. */
export function buildJpeg(f: ExifFixture | null): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  if (f?.jfif ?? true) {
    out.push(...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  }
  if (f?.xmpFirst) {
    const ns = 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>';
    out.push(...segment(0xe1, Array.from(ns, (c) => c.charCodeAt(0))));
  }
  if (f) out.push(...segment(0xe1, [...EXIF_HEADER, ...buildTiff(f)]));
  // A stand-in quantisation table and scan; the reader stops at SOS.
  out.push(...segment(0xdb, new Array(65).fill(1)));
  out.push(...segment(0xda, [1, 1, 0, 0, 0x3f, 0]));
  out.push(0x12, 0x34, 0x56, 0x78);
  for (let i = 0; i < (f?.tailBytes ?? 0); i++) out.push(i & 0x7f);
  out.push(0xff, 0xd9);
  return Uint8Array.from(out);
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** A seeded PRNG (mulberry32), so a fuzz failure reproduces. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
