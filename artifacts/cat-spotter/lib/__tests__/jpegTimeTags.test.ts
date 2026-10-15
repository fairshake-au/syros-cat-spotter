/**
 * SYC-166 slice 2W: the website's own time reader (spec §9 test 4, the
 * time-only variant; plan "Slice 2W" steps 1 and probes 1-4).
 *
 * The website's picker hands over the whole file as base64 and reads no tags,
 * so the app reads the photo's time itself. The reader looks at the start of
 * a JPEG only, keeps the five time tags, never reads a location tag, and
 * answers `read` (with the tags, maybe none), `notJpeg`, or `unsure`. It must
 * never throw, never hang, and never hand back part of a time.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readJpegTimeTags,
  MAX_READER_STEPS,
  HEAD_CHARS,
  type JpegTimeRead,
} from '../jpegTimeTags';
import { resolvePhotoTime, type TimeTags } from '../photoClock';
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

const IPHONE_TAGS: TimeTags = {
  DateTimeOriginal: '2026:10:03 18:42:10',
  OffsetTimeOriginal: '+03:00',
  SubSecTimeOriginal: '450',
  GPSDateStamp: '2026:10:03',
  GPSTimeStamp: '15/1:42/1:9/1',
};

const UNSURE: JpegTimeRead = { kind: 'unsure' };
const NOT_JPEG: JpegTimeRead = { kind: 'notJpeg' };

const b64 = (f: ExifFixture | null) => toBase64(buildJpeg(f));

/** The tags if the file was read; otherwise the answer itself. */
function read(input: string): TimeTags | JpegTimeRead {
  const r = readJpegTimeTags(input);
  return r.kind === 'read' ? r.tags : r;
}

/** A JPEG around a TIFF block. */
function wrap(tiff: number[]): string {
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = payload.length + 2;
  return toBase64(
    Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...payload,
      0xff, 0xda, 0, 2, 0xff, 0xd9,
    ]),
  );
}

/** Where a little-endian IFD entry with this tag and type starts. */
function entryAt(tiff: number[], tag: number, type: number): number {
  for (let i = 8; i + 4 <= tiff.length; i += 2) {
    if (
      tiff[i] === (tag & 255) &&
      tiff[i + 1] === tag >> 8 &&
      tiff[i + 2] === type &&
      tiff[i + 3] === 0
    ) {
      return i;
    }
  }
  throw new Error(`no entry for tag ${tag}`);
}

describe('readJpegTimeTags: what it reads', () => {
  it('a photo with its time and its own offset (little-endian, as iPhones write)', () => {
    expect(read(b64(IPHONE))).toEqual(IPHONE_TAGS);
  });

  it('big-endian gives the same tags', () => {
    expect(read(b64({ ...IPHONE, byteOrder: 'MM' }))).toEqual(IPHONE_TAGS);
  });

  it('own offset wins: the tags it reads resolve to the exact instant', () => {
    const tags = read(b64({ ...IPHONE, SubSecTimeOriginal: undefined })) as TimeTags;
    expect(resolvePhotoTime(tags, Date.UTC(2026, 9, 10))).toEqual({
      kind: 'ok',
      instantMs: Date.UTC(2026, 9, 3, 15, 42, 10),
      source: 'photo+offset',
    });
  });

  it('time and a GPS clock but no offset: the GPS clock fills the offset', () => {
    const tags = read(
      b64({
        DateTimeOriginal: '2026:10:03 18:42:10',
        GPSDateStamp: '2026:10:03',
        GPSTimeStamp: [
          [15, 1],
          [42, 1],
          [0, 1],
        ],
      }),
    ) as TimeTags;
    expect(tags.OffsetTimeOriginal).toBeUndefined();
    expect(resolvePhotoTime(tags, Date.UTC(2026, 9, 10))).toEqual({
      kind: 'ok',
      instantMs: Date.UTC(2026, 9, 3, 15, 42, 10),
      source: 'photo+gps-offset',
    });
  });

  it('skips an XMP block that comes before the Exif one', () => {
    expect(read(b64({ ...IPHONE, xmpFirst: true }))).toEqual(IPHONE_TAGS);
  });

  it('works with no JFIF block first', () => {
    expect(read(b64({ ...IPHONE, jfif: false }))).toEqual(IPHONE_TAGS);
  });

  it('follows a sub-IFD pointer written with the IFD type (13) as well as LONG', () => {
    const tiff = buildTiff(IPHONE);
    tiff[entryAt(tiff, 0x8769, 4) + 2] = 13;
    tiff[entryAt(tiff, 0x8825, 4) + 2] = 13;
    expect(read(wrap(tiff))).toEqual(IPHONE_TAGS);
  });

  it('a JPEG with an Exif block but no time tags: read, no time', () => {
    const tags = read(b64({})) as TimeTags;
    expect(tags).toEqual({});
    expect(resolvePhotoTime(tags, Date.UTC(2026, 9, 10))).toEqual({
      kind: 'none',
      reason: 'missing',
    });
  });

  it('a JPEG with no Exif block at all (stripped): read, no time', () => {
    expect(read(b64(null))).toEqual({});
  });

  it('accepts a data URL (any case) as well as bare base64', () => {
    expect(read(`data:image/jpeg;base64,${b64(IPHONE)}`)).toEqual(IPHONE_TAGS);
    expect(read(`DATA:image/jpeg;base64,${b64(IPHONE)}`)).toEqual(IPHONE_TAGS);
  });
});

describe('readJpegTimeTags: not a JPEG', () => {
  it.each([
    ['a PNG', toBase64(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))],
    [
      'a HEIC (ftyp heic)',
      toBase64(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0])),
    ],
  ])('%s -> notJpeg', (_label, input) => {
    expect(read(input)).toEqual(NOT_JPEG);
  });
});

describe('readJpegTimeTags: unsure (never a wrong or partial time)', () => {
  it.each([
    ['an empty string', ''],
    ['text that is not base64', 'this is not a photo, it is a sentence!'],
    ['only the start-of-image marker', toBase64(Uint8Array.from([0xff, 0xd8]))],
    ['a pointer loop (Exif IFD points back at IFD0)', b64({ ...IPHONE, loop: true })],
    ['base64 wrapped with newlines', b64(IPHONE).replace(/(.{76})/g, '$1\n')],
    ['URL-safe base64', b64(IPHONE).replace(/\+/g, '-').replace(/\//g, '_') + '-_'],
    ['"=" padding in the middle', b64(IPHONE).slice(0, 40) + '==' + b64(IPHONE).slice(42)],
    ['more than two "=" at the end', b64(IPHONE).replace(/=*$/, '') + '==='],
  ])('%s -> unsure', (_label, input) => {
    expect(read(input)).toEqual(UNSURE);
  });

  it('an offset that is there but not text (UNDEFINED type) -> unsure, not Greek time hours out', () => {
    const tiff = buildTiff({ DateTimeOriginal: '2026:10:13 05:51:00', OffsetTimeOriginal: '+10:00' });
    tiff[entryAt(tiff, 0x9011, 2) + 2] = 7;
    expect(read(wrap(tiff))).toEqual(UNSURE);
  });

  it('a time with an unprintable character -> unsure', () => {
    expect(read(b64({ DateTimeOriginal: '2026:10:13 05:51:0\u0001' }))).toEqual(UNSURE);
  });

  it('a time tag longer than any real one -> unsure', () => {
    expect(read(b64({ DateTimeOriginal: '2026:10:13 05:51:00'.padEnd(80, ' ') }))).toEqual(UNSURE);
  });

  it('a GPS clock with four parts instead of three -> unsure', () => {
    const tiff = buildTiff({
      DateTimeOriginal: '2026:10:13 05:51:00',
      GPSTimeStamp: [
        [2, 1],
        [51, 1],
        [0, 1],
      ],
    });
    tiff[entryAt(tiff, 0x0007, 5) + 4] = 4;
    expect(read(wrap(tiff))).toEqual(UNSURE);
  });

  it('cut anywhere before the last time tag ends -> unsure; cut after it -> the full answer', () => {
    const full = buildJpeg(IPHONE);
    // The Exif APP1 starts after SOI (2) and the JFIF APP0 (18); the TIFF
    // block 10 bytes later. The last time value (the GPS date, 11 bytes) is
    // followed by one pad byte and the 8-byte accuracy value, never read.
    const tiffAt = 2 + 18 + 10;
    const tiffLen = buildTiff(IPHONE).length;
    const lastTimeEnds = tiffAt + tiffLen - 8 - 1;
    for (let cut = 2 + 18 + 4; cut < tiffAt + tiffLen; cut++) {
      const r = read(toBase64(full.slice(0, cut)));
      if (cut < lastTimeEnds) expect(r, `cut at ${cut}`).toEqual(UNSURE);
      else expect(r, `cut at ${cut}`).toEqual(IPHONE_TAGS);
    }
  });

  it('an Exif block shorter than it says: nothing read beyond it -> unsure', () => {
    const tiff = buildTiff(IPHONE);
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    // Declare the segment as ending 40 bytes early; the bytes are still there.
    const len = payload.length + 2 - 40;
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...payload]);
    expect(read(toBase64(bytes))).toEqual(UNSURE);
  });

  it('corrupt: random bytes after the start-of-image marker never throw', () => {
    const rand = seeded(7);
    for (let n = 0; n < 200; n++) {
      const bytes = new Uint8Array(400);
      bytes[0] = 0xff;
      bytes[1] = 0xd8;
      for (let i = 2; i < bytes.length; i++) bytes[i] = Math.floor(rand() * 256);
      expect(() => readJpegTimeTags(toBase64(bytes))).not.toThrow();
    }
  });

  it('an IFD that claims more entries than the cap -> unsure', () => {
    const tiff = buildTiff(IPHONE);
    // IFD0 at 8 (little-endian): its entry count.
    tiff[8] = 0xff;
    tiff[9] = 0xff;
    expect(read(wrap(tiff))).toEqual(UNSURE);
  });

  it('non-string input -> unsure', () => {
    for (const v of [null, undefined, 42]) {
      expect(readJpegTimeTags(v as unknown as string)).toEqual(UNSURE);
    }
  });
});

describe('readJpegTimeTags: never hangs', () => {
  it('a 30 MB file returns in under 50 ms, because only the start is decoded', () => {
    const head = b64({ ...IPHONE, tailBytes: 3000 });
    // Drop the last (possibly padded) quantum so the filler continues whole
    // base64 quanta, and the start still decodes as the JPEG.
    const big = head.slice(0, head.length - 4) + 'A'.repeat(30 * 1024 * 1024);
    expect(big.length).toBeGreaterThan(30 * 1024 * 1024);
    read(big); // warm up the JIT, as a second pick would be
    const t0 = performance.now();
    const r = read(big);
    const ms = performance.now() - t0;
    expect(r).toEqual(IPHONE_TAGS);
    expect(ms).toBeLessThan(50);
  });

  it('decodes at most the first 64 KB: an Exif block that starts later is not reached -> unsure', () => {
    expect(HEAD_CHARS).toBe(87_384);
    expect(HEAD_CHARS % 4).toBe(0);
    const pad = new Array(0xfffd).fill(0);
    const late = Uint8Array.from([
      0xff, 0xd8,
      // Two maximum-length APP2 segments, so the Exif block sits past 64 KB.
      0xff, 0xe2, 0xff, 0xff, ...pad,
      0xff, 0xe2, 0xff, 0xff, ...pad,
      ...buildJpeg(IPHONE).slice(2),
    ]);
    expect(read(toBase64(late))).toEqual(UNSURE);
  });

  it('more fill bytes than the step budget -> unsure, within the budget', () => {
    const fill = new Array(MAX_READER_STEPS + 100).fill(0xff);
    const bytes = Uint8Array.from([0xff, 0xd8, ...fill, ...buildJpeg(IPHONE).slice(2)]);
    const meter = { steps: 0 };
    expect(readJpegTimeTags(toBase64(bytes), meter)).toEqual(UNSURE);
    expect(meter.steps).toBe(MAX_READER_STEPS);
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
    const parsed = JSON.parse(out);
    expect(Object.keys(parsed)).toEqual(['kind', 'tags']);
    expect(Object.keys(parsed.tags).sort()).toEqual(
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

    it('the only tag ids are the named list of seven, exactly', () => {
      const block = /const TAG = \{([\s\S]*?)\} as const;/.exec(code)?.[1] ?? '';
      const ids = [...block.matchAll(/(\w+):\s*([^,\s]+),/g)].map(([, k, v]) => `${k}=${v}`);
      expect(ids).toEqual([
        'exifPointer=0x8769',
        'gpsPointer=0x8825',
        'dateTimeOriginal=0x9003',
        'offsetTimeOriginal=0x9011',
        'subSecTimeOriginal=0x9291',
        'gpsTimeStamp=0x0007',
        'gpsDateStamp=0x001d',
      ]);
    });

    it('a tag is only ever compared with a name from that list (no decimal, no other constant)', () => {
      // Every use of the word `tag` is one of: the Entry field's type, the
      // place it is read, or `e.tag === TAG.<name>`.
      const uses = code.match(/\btag\b[^\n]{0,40}/g) ?? [];
      const allowedUse = /^tag: number;|^tag: u16\(e\)|^tag === TAG\.\w+\)/;
      expect(uses.filter((u) => !allowedUse.test(u))).toEqual([]);
      expect(code).not.toMatch(/\bcase\s+\d/);
    });

    it('logs nothing and mentions no picker tag object', () => {
      expect(code).not.toMatch(/\bconsole\./);
      expect(code).not.toMatch(/\bexif\b/i);
    });
  });
});
