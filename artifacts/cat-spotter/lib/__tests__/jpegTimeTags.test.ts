/**
 * SYC-166 slice 2W: the website's own time reader (spec §9 test 4, the
 * time-only variant; plan "Slice 2W" steps 1 and probes 1-4).
 *
 * The website's picker hands over the whole file as base64 and reads no tags,
 * so the app reads the photo's time itself. The reader looks at the start of
 * a JPEG only, keeps the five time tags, never reads a location tag, and on
 * anything it is unsure of returns null ("no information"). It must never
 * throw and never hang, whatever the file.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJpegTimeTags, MAX_READER_STEPS, HEAD_CHARS } from '../jpegTimeTags';
import { resolvePhotoTime } from '../photoClock';
import {
  FIXTURE_POSITION,
  buildJpeg,
  buildTiff,
  seeded,
  toBase64,
  type ExifFixture,
} from './__fixtures__/exifJpeg';

const IPHONE: ExifFixture = {
  DateTimeOriginal: '2026:10:03 18:42:10',
  OffsetTimeOriginal: '+03:00',
  SubSecTimeOriginal: '450',
  GPSDateStamp: '2026:10:03',
  GPSTimeStamp: [
    [15, 1],
    [42, 1],
    [9, 1],
  ],
  position: FIXTURE_POSITION,
};

const b64 = (f: ExifFixture | null) => toBase64(buildJpeg(f));

describe('readJpegTimeTags: what it reads', () => {
  it('a photo with its time and its own offset (little-endian, as iPhones write)', () => {
    expect(readJpegTimeTags(b64(IPHONE))).toEqual({
      DateTimeOriginal: '2026:10:03 18:42:10',
      OffsetTimeOriginal: '+03:00',
      SubSecTimeOriginal: '450',
      GPSDateStamp: '2026:10:03',
      GPSTimeStamp: '15/1:42/1:9/1',
    });
  });

  it('big-endian gives the same tags', () => {
    expect(readJpegTimeTags(b64({ ...IPHONE, byteOrder: 'MM' }))).toEqual(
      readJpegTimeTags(b64({ ...IPHONE, byteOrder: 'II' })),
    );
  });

  it('own offset wins: the tags it reads resolve to the exact instant', () => {
    const tags = readJpegTimeTags(b64({ ...IPHONE, SubSecTimeOriginal: undefined }))!;
    expect(resolvePhotoTime(tags, Date.UTC(2026, 9, 10))).toEqual({
      kind: 'ok',
      instantMs: Date.UTC(2026, 9, 3, 15, 42, 10),
      source: 'photo+offset',
    });
  });

  it('time and a GPS clock but no offset: the GPS clock fills the offset', () => {
    const tags = readJpegTimeTags(
      b64({
        DateTimeOriginal: '2026:10:03 18:42:10',
        GPSDateStamp: '2026:10:03',
        GPSTimeStamp: [
          [15, 1],
          [42, 1],
          [0, 1],
        ],
      }),
    )!;
    expect(tags.OffsetTimeOriginal).toBeUndefined();
    expect(resolvePhotoTime(tags, Date.UTC(2026, 9, 10))).toEqual({
      kind: 'ok',
      instantMs: Date.UTC(2026, 9, 3, 15, 42, 10),
      source: 'photo+gps-offset',
    });
  });

  it('skips an XMP block that comes before the Exif one', () => {
    expect(readJpegTimeTags(b64({ ...IPHONE, xmpFirst: true }))?.DateTimeOriginal).toBe(
      '2026:10:03 18:42:10',
    );
  });

  it('works with no JFIF block first', () => {
    expect(readJpegTimeTags(b64({ ...IPHONE, jfif: false }))?.OffsetTimeOriginal).toBe('+03:00');
  });

  it('a JPEG with an Exif block but no time tags gives no time', () => {
    const tags = readJpegTimeTags(b64({}));
    expect(tags).toEqual({});
    expect(resolvePhotoTime(tags!, Date.UTC(2026, 9, 10))).toEqual({
      kind: 'none',
      reason: 'missing',
    });
  });

  it('accepts a data URL as well as bare base64', () => {
    expect(readJpegTimeTags(`data:image/jpeg;base64,${b64(IPHONE)}`)?.DateTimeOriginal).toBe(
      '2026:10:03 18:42:10',
    );
  });
});

describe('readJpegTimeTags: no information', () => {
  const nulls: [string, string][] = [
    ['a JPEG with no Exif block (stripped)', b64(null)],
    ['an empty string', ''],
    ['text that is not base64', 'this is not a photo, it is a sentence!'],
    ['a PNG', toBase64(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))],
    [
      'a HEIC (ftyp heic)',
      toBase64(
        Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]),
      ),
    ],
    ['only the start-of-image marker', toBase64(Uint8Array.from([0xff, 0xd8]))],
    ['a pointer loop (Exif IFD points back at IFD0)', b64({ ...IPHONE, loop: true })],
  ];
  it.each(nulls)('%s -> null', (_label, input) => {
    expect(readJpegTimeTags(input)).toBeNull();
  });

  it('truncated anywhere in the Exif block: null, or the full answer if every time tag survived, never part of it', () => {
    const full = buildJpeg(IPHONE);
    const whole = readJpegTimeTags(toBase64(full));
    // The Exif APP1 starts after SOI (2) and the JFIF APP0 (18).
    const exifStart = 2 + 18;
    const tiffLen = buildTiff(IPHONE).length;
    let nulls = 0;
    for (let cut = exifStart + 4; cut < exifStart + 10 + tiffLen; cut++) {
      const r = readJpegTimeTags(toBase64(full.slice(0, cut)));
      if (r === null) nulls++;
      else expect(r, `cut at ${cut}`).toEqual(whole);
    }
    // Cuts through the entry tables and the time values all give nothing.
    expect(nulls).toBeGreaterThan(tiffLen - 20);
  });

  it('corrupt: random bytes after the start-of-image marker -> null or tags, never a throw', () => {
    const rand = seeded(7);
    for (let n = 0; n < 200; n++) {
      const bytes = new Uint8Array(400);
      bytes[0] = 0xff;
      bytes[1] = 0xd8;
      for (let i = 2; i < bytes.length; i++) bytes[i] = Math.floor(rand() * 256);
      expect(() => readJpegTimeTags(toBase64(bytes))).not.toThrow();
    }
  });

  it('an IFD that claims more entries than the cap -> null', () => {
    const tiff = buildTiff(IPHONE);
    // IFD0 at 8 (little-endian): its entry count.
    tiff[8] = 0xff;
    tiff[9] = 0xff;
    const bytes = [0xff, 0xd8, 0xff, 0xe1, 0, 0, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, 0xff, 0xd9];
    const len = tiff.length + 8;
    bytes[4] = (len >> 8) & 0xff;
    bytes[5] = len & 0xff;
    expect(readJpegTimeTags(toBase64(Uint8Array.from(bytes)))).toBeNull();
  });
});

describe('readJpegTimeTags: never hangs', () => {
  it('a 30 MB file returns in under 50 ms, because only the start is decoded', () => {
    const head = b64({ ...IPHONE, tailBytes: 3000 });
    // Drop the last (possibly padded) quantum so the filler continues whole
    // base64 quanta, and the start still decodes as the JPEG.
    const big = head.slice(0, head.length - 4) + 'A'.repeat(30 * 1024 * 1024);
    expect(big.length).toBeGreaterThan(30 * 1024 * 1024);
    readJpegTimeTags(big); // warm up the JIT, as a second pick would be
    const t0 = performance.now();
    const r = readJpegTimeTags(big);
    const ms = performance.now() - t0;
    expect(r?.DateTimeOriginal).toBe('2026:10:03 18:42:10');
    expect(ms).toBeLessThan(50);
  });

  it('decodes at most the first 64 KB of the file', () => {
    expect(HEAD_CHARS).toBe(87_384);
    expect(HEAD_CHARS % 4).toBe(0);
    // A file whose Exif block starts past 64 KB: not read.
    const pad = new Array(70_000).fill(0);
    const late = Uint8Array.from([
      0xff, 0xd8,
      // An APP2 segment of junk (max length) twice, so Exif sits beyond 64 KB.
      0xff, 0xe2, 0xff, 0xff, ...pad.slice(0, 0xfffd),
      0xff, 0xe2, 0xff, 0xff, ...pad.slice(0, 0xfffd),
      ...buildJpeg(IPHONE).slice(2),
    ]);
    expect(readJpegTimeTags(toBase64(late))).toBeNull();
  });

  it('fuzz: 2,000 seeded single-byte mutations and truncations never throw or blow the step budget', () => {
    const rand = seeded(166);
    const base = buildJpeg({ ...IPHONE, xmpFirst: true });
    for (let n = 0; n < 2000; n++) {
      let bytes = base.slice();
      if (rand() < 0.75) {
        const at = Math.floor(rand() * bytes.length);
        bytes[at] = Math.floor(rand() * 256);
      }
      if (rand() < 0.4) bytes = bytes.slice(0, Math.floor(rand() * bytes.length));
      const meter = { steps: 0 };
      let threw: unknown = null;
      try {
        readJpegTimeTags(toBase64(bytes), meter);
      } catch (e) {
        threw = e;
      }
      expect(threw, `case ${n}`).toBeNull();
      expect(meter.steps, `case ${n}`).toBeLessThanOrEqual(MAX_READER_STEPS);
    }
  });
});

describe('readJpegTimeTags: privacy (it reads time, never location)', () => {
  it('a photo with a GPS position: the output contains no part of it (by value)', () => {
    const out = JSON.stringify(readJpegTimeTags(b64(IPHONE)));
    const parts = [
      ...FIXTURE_POSITION.latitude,
      ...FIXTURE_POSITION.longitude,
      FIXTURE_POSITION.altitude,
      FIXTURE_POSITION.accuracy,
    ];
    for (const [num, den] of parts) {
      expect(out).not.toContain(`${num}/${den}`);
    }
    for (const digits of ['284441', '284442', '123457', '98765', '37.44', '24.94']) {
      expect(out).not.toContain(digits);
    }
    expect(out).not.toMatch(/"[NE]"/);
    expect(Object.keys(JSON.parse(out)).sort()).toEqual(
      ['DateTimeOriginal', 'GPSDateStamp', 'GPSTimeStamp', 'OffsetTimeOriginal', 'SubSecTimeOriginal'],
    );
  });

  describe('source check: no location tag id appears in the reader', () => {
    const src = readFileSync(path.resolve(__dirname, '../jpegTimeTags.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

    it('no latitude, longitude, altitude or accuracy name in the code', () => {
      expect(code).not.toMatch(/latitude|longitude|altitude|positioning|accuracy|\blat\b|\blng\b|\blon\b/i);
    });

    it('every hex number in the code is a marker, a header byte, a pointer or a time tag', () => {
      const hex = (code.match(/0x[0-9a-f]+/gi) ?? []).map((h) => h.toLowerCase());
      const allowed = new Set([
        // JPEG markers.
        '0xff', '0xd8', '0xd9', '0xda', '0xe1', '0xd0', '0xd7',
        // "Exif", and the TIFF header's "II", "MM" and 42.
        '0x45', '0x78', '0x69', '0x66', '0x49', '0x4d', '0x2a',
        // Pointers: the Exif sub-IFD and the GPS sub-IFD.
        '0x8769', '0x8825',
        // The five time tags.
        '0x9003', '0x9011', '0x9291', '0x0007', '0x001d',
      ]);
      expect(hex.filter((h) => !allowed.has(h))).toEqual([]);
    });

    it('tag ids are compared only by name, never as a bare decimal', () => {
      expect(code).not.toMatch(/\btag\w*\s*(?:===?|!==?)\s*\d/i);
      expect(code).not.toMatch(/\bcase\s+\d/);
    });

    it('logs nothing and mentions no picker tag object', () => {
      expect(code).not.toMatch(/\bconsole\./);
      expect(code).not.toMatch(/\bexif\b/i);
    });
  });
});
