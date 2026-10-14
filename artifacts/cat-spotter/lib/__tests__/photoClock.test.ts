/**
 * SYC-166 slice 2: the photo's own date and time (spec photo-location-from-
 * library.md §3.4, §9 tests 1 (time half), 2, 3 and 13; plan "The clock").
 *
 * The clock order, the 21-day limit and the extractor's privacy line are
 * silent failures: a wrong answer still looks like a time. So every rule has a
 * named case here, and the plan's mutation probes 1-4 and 8 turn one of them
 * red.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_PHOTO_AGE_DAYS,
  athensWallClockToInstant,
  extractTimeTags,
  formatPhotoDate,
  formatPhotoTaken,
  resolvePhotoTime,
  type TimeTags,
} from '../photoClock';
import { MAX_QUEUE_AGE_MS } from '../offlineQueue';
import { TRANSLATIONS } from '../i18n';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "Now" for most cases: 10 October 2026, 12:00 UTC (15:00 in Syros). */
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);

/** The privacy fixture: the same position the slice 1 and slice 5 tests use. */
const FIXTURE_LAT = 37.4412345;
const FIXTURE_LNG = 24.9412345;

function resolve(tags: TimeTags, now = NOW) {
  return resolvePhotoTime(tags, now);
}

function instantOf(tags: TimeTags, now = NOW): number {
  const r = resolve(tags, now);
  if (r.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.instantMs;
}

describe('which clock sets the time', () => {
  it('photo time plus its own offset wins', () => {
    const r = resolve({
      DateTimeOriginal: '2026:10:03 18:42:10',
      OffsetTimeOriginal: '+03:00',
    });
    expect(r).toEqual({
      kind: 'ok',
      instantMs: Date.UTC(2026, 9, 3, 15, 42, 10),
      source: 'photo+offset',
    });
  });

  it('a photo taken elsewhere with its own offset keeps that offset, not Greek time', () => {
    expect(
      instantOf({ DateTimeOriginal: '2026:10:03 18:42:10', OffsetTimeOriginal: '-04:00' }),
    ).toBe(Date.UTC(2026, 9, 3, 22, 42, 10));
  });

  it('the GPS clock fills a missing offset', () => {
    const r = resolve({
      DateTimeOriginal: '2026:10:03 18:42:10',
      GPSDateStamp: '2026:10:03',
      GPSTimeStamp: '15:42:00',
    });
    expect(r).toEqual({
      kind: 'ok',
      instantMs: Date.UTC(2026, 9, 3, 15, 42, 10),
      source: 'photo+gps-offset',
    });
  });

  it('the GPS clock fills a missing offset for a photo taken in another whole-hour zone', () => {
    // Berlin in October is +02:00: 18:42:10 there is 16:42:10 UTC, not the
    // 15:42:10 that reading it as Greek time would give.
    expect(
      instantOf({
        DateTimeOriginal: '2026:10:03 18:42:10',
        GPSDateStamp: '2026:10:03',
        GPSTimeStamp: '16:42:05',
      }),
    ).toBe(Date.UTC(2026, 9, 3, 16, 42, 10));
  });

  it('the GPS clock in the forms the pickers give: rationals, a list, fractions, dashes', () => {
    const base = { DateTimeOriginal: '2026:10:03 18:42:10' };
    const want = Date.UTC(2026, 9, 3, 16, 42, 10);
    for (const [date, time] of [
      ['2026:10:03', '16/1,42/1,0/1'],
      ['2026:10:03', '16:42:00.00'],
      ['2026-10-03', '16:42:00'],
    ] as const) {
      expect(instantOf({ ...base, GPSDateStamp: date, GPSTimeStamp: time })).toBe(want);
    }
  });

  describe('GPS clock 30 minutes off the photo time: the photo time wins', () => {
    it('with its own offset, the own offset wins outright', () => {
      expect(
        resolve({
          DateTimeOriginal: '2026:10:03 18:42:10',
          OffsetTimeOriginal: '+03:00',
          GPSDateStamp: '2026:10:03',
          GPSTimeStamp: '15:12:10',
        }),
      ).toEqual({
        kind: 'ok',
        instantMs: Date.UTC(2026, 9, 3, 15, 42, 10),
        source: 'photo+offset',
      });
    });

    it('without one, a half-hour result is distrusted and the photo is read as Greek time', () => {
      // Derived offset 3:30 is on the spec's 15-minute grid; B-30 (ii) refuses
      // it, so the photo time is read as Greek time (+03:00 on 3 October).
      expect(
        resolve({
          DateTimeOriginal: '2026:10:03 18:42:10',
          GPSDateStamp: '2026:10:03',
          GPSTimeStamp: '15:12:10',
        }),
      ).toEqual({
        kind: 'ok',
        instantMs: Date.UTC(2026, 9, 3, 15, 42, 10),
        source: 'photo+athens',
      });
    });

    it('a half-hour result on the other side (2:30) is distrusted too', () => {
      expect(
        resolve({
          DateTimeOriginal: '2026:10:03 18:42:10',
          GPSDateStamp: '2026:10:03',
          GPSTimeStamp: '16:12:10',
        }),
      ).toMatchObject({ kind: 'ok', source: 'photo+athens' });
    });
  });

  it.each([
    ['7 minutes', '15:35:10'],
    ['11 minutes', '15:31:10'],
  ])('a GPS clock %s off the hour is distrusted (stale fix): Greek time', (_label, gps) => {
    expect(
      resolve({
        DateTimeOriginal: '2026:10:03 18:42:10',
        GPSDateStamp: '2026:10:03',
        GPSTimeStamp: gps,
      }),
    ).toEqual({
      kind: 'ok',
      instantMs: Date.UTC(2026, 9, 3, 15, 42, 10),
      source: 'photo+athens',
    });
  });

  it('within 3 minutes of a whole hour is accepted (a fix a couple of minutes old)', () => {
    const r = resolve({
      DateTimeOriginal: '2026:10:03 18:42:10',
      GPSDateStamp: '2026:10:03',
      GPSTimeStamp: '16:39:30',
    });
    expect(r).toMatchObject({ source: 'photo+gps-offset' });
  });

  it('known limit: a GPS clock exactly an hour stale is accepted, and is an hour out', () => {
    // True zone +03:00, the fix an hour old: the derived offset is +04:00.
    expect(
      resolve({
        DateTimeOriginal: '2026:10:03 18:42:10',
        GPSDateStamp: '2026:10:03',
        GPSTimeStamp: '14:42:10',
      }),
    ).toEqual({
      kind: 'ok',
      instantMs: Date.UTC(2026, 9, 3, 14, 42, 10),
      source: 'photo+gps-offset',
    });
  });

  it('a GPS clock more than a day from the photo time is ignored', () => {
    expect(
      resolve({
        DateTimeOriginal: '2026:10:03 18:42:10',
        GPSDateStamp: '2026:10:01',
        GPSTimeStamp: '15:42:10',
      }),
    ).toMatchObject({ source: 'photo+athens' });
  });

  it('a derived whole-hour offset outside -12:00..+14:00 is ignored', () => {
    expect(
      resolve({
        DateTimeOriginal: '2026:10:03 18:42:10',
        GPSDateStamp: '2026:10:04',
        GPSTimeStamp: '09:42:10',
      }),
    ).toMatchObject({ source: 'photo+athens' });
  });

  it('the GPS clock alone never sets the time', () => {
    expect(resolve({ GPSDateStamp: '2026:10:03', GPSTimeStamp: '15:42:00' })).toEqual({
      kind: 'none',
      reason: 'missing',
    });
  });

  it('no tags at all: none, missing', () => {
    expect(resolve({})).toEqual({ kind: 'none', reason: 'missing' });
  });

  it('no offset, no GPS clock: read as Greek time, summer (+03:00)', () => {
    expect(resolve({ DateTimeOriginal: '2026:10:03 18:42:10' })).toEqual({
      kind: 'ok',
      instantMs: Date.UTC(2026, 9, 3, 15, 42, 10),
      source: 'photo+athens',
    });
  });

  it('no offset, no GPS clock: read as Greek time, winter (+02:00)', () => {
    const now = Date.UTC(2026, 10, 20, 12);
    expect(instantOf({ DateTimeOriginal: '2026:11:10 18:42:10' }, now)).toBe(
      Date.UTC(2026, 10, 10, 16, 42, 10),
    );
  });

  it('sub-seconds are added as milliseconds', () => {
    expect(
      instantOf({
        DateTimeOriginal: '2026:10:03 18:42:10',
        OffsetTimeOriginal: '+03:00',
        SubSecTimeOriginal: '45',
      }),
    ).toBe(Date.UTC(2026, 9, 3, 15, 42, 10, 450));
    expect(
      instantOf({
        DateTimeOriginal: '2026:10:03 18:42:10',
        OffsetTimeOriginal: '+03:00',
        SubSecTimeOriginal: '123456',
      }),
    ).toBe(Date.UTC(2026, 9, 3, 15, 42, 10, 123));
  });

  it('nonsense sub-seconds are ignored, never thrown on', () => {
    expect(
      instantOf({
        DateTimeOriginal: '2026:10:03 18:42:10',
        OffsetTimeOriginal: '+03:00',
        SubSecTimeOriginal: 'abc',
      }),
    ).toBe(Date.UTC(2026, 9, 3, 15, 42, 10));
  });
});

describe('the two awkward nights in Greek time', () => {
  it('25 October 2026 03:30 (happens twice) is one defined instant: the earlier', () => {
    // 03:30 EEST (+03:00) = 00:30 UTC; 03:30 EET (+02:00) = 01:30 UTC.
    expect(athensWallClockToInstant(2026, 10, 25, 3, 30, 0)).toBe(
      Date.UTC(2026, 9, 25, 0, 30),
    );
    const now = Date.UTC(2026, 9, 26, 12);
    expect(instantOf({ DateTimeOriginal: '2026:10:25 03:30:00' }, now)).toBe(
      Date.UTC(2026, 9, 25, 0, 30),
    );
  });

  it('28 March 2027 03:30 (does not exist) resolves to 04:30 summer time', () => {
    // 04:30 EEST = 01:30 UTC.
    expect(athensWallClockToInstant(2027, 3, 28, 3, 30, 0)).toBe(
      Date.UTC(2027, 2, 28, 1, 30),
    );
  });

  it('either side of the nights is plain', () => {
    expect(athensWallClockToInstant(2026, 10, 25, 2, 30, 0)).toBe(
      Date.UTC(2026, 9, 24, 23, 30),
    );
    expect(athensWallClockToInstant(2026, 10, 25, 4, 30, 0)).toBe(
      Date.UTC(2026, 9, 25, 2, 30),
    );
    expect(athensWallClockToInstant(2027, 3, 28, 2, 30, 0)).toBe(
      Date.UTC(2027, 2, 28, 0, 30),
    );
    expect(athensWallClockToInstant(2027, 3, 28, 4, 30, 0)).toBe(
      Date.UTC(2027, 2, 28, 1, 30),
    );
  });
});

describe('OffsetTimeOriginal oddities: parsed like the canonical form, or treated as absent', () => {
  const photo = '2026:10:03 18:42:10';
  it('"+0300" (no colon) is the same instant as "+03:00"', () => {
    expect(instantOf({ DateTimeOriginal: photo, OffsetTimeOriginal: '+0300' })).toBe(
      instantOf({ DateTimeOriginal: photo, OffsetTimeOriginal: '+03:00' }),
    );
  });
  it('"Z" is UTC', () => {
    expect(resolve({ DateTimeOriginal: photo, OffsetTimeOriginal: 'Z' })).toEqual({
      kind: 'ok',
      instantMs: Date.UTC(2026, 9, 3, 18, 42, 10),
      source: 'photo+offset',
    });
  });
  it.each(['', '   ', '+25:00', '+03:75', 'garbage', '3'])(
    '%j is treated as absent (Greek time), never thrown on',
    (offset) => {
      expect(resolve({ DateTimeOriginal: photo, OffsetTimeOriginal: offset })).toEqual({
        kind: 'ok',
        instantMs: Date.UTC(2026, 9, 3, 15, 42, 10),
        source: 'photo+athens',
      });
    },
  );
});

describe('nonsense is ignored', () => {
  it.each([
    '0000:00:00 00:00:00',
    '2026:02:30 10:00:00',
    '2026:10:03 25:00:00',
    '2026:10:03',
    'not a date',
    '',
    '    :  :     :  :  ',
  ])('%j is unreadable', (dto) => {
    expect(resolve({ DateTimeOriginal: dto })).toEqual({ kind: 'none', reason: 'unreadable' });
  });

  it('a future time is refused', () => {
    expect(resolve({ DateTimeOriginal: '2026:10:12 18:00:00', OffsetTimeOriginal: '+03:00' })).toEqual({
      kind: 'none',
      reason: 'future',
    });
  });

  it('edge: now + 5 minutes is accepted, now + 5 minutes + 1 ms is refused', () => {
    // NOW is 12:00:00.000 UTC = 15:00:00 in Syros.
    expect(
      resolve({
        DateTimeOriginal: '2026:10:10 15:05:00',
        OffsetTimeOriginal: '+03:00',
      }).kind,
    ).toBe('ok');
    expect(
      resolve(
        { DateTimeOriginal: '2026:10:10 15:05:00', OffsetTimeOriginal: '+03:00' },
        NOW - 1,
      ),
    ).toEqual({ kind: 'none', reason: 'future' });
  });
});

describe('the 21-day edge', () => {
  it('the limit is 21 days', () => {
    expect(MAX_PHOTO_AGE_DAYS).toBe(21);
  });

  it('one minute inside is ok, one minute outside is tooOld', () => {
    const inside = NOW - 21 * DAY + MIN;
    const outside = NOW - 21 * DAY - MIN;
    const tagsAt = (ms: number): TimeTags => {
      const d = new Date(ms);
      const p = (n: number) => String(n).padStart(2, '0');
      return {
        DateTimeOriginal: `${d.getUTCFullYear()}:${p(d.getUTCMonth() + 1)}:${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`,
        OffsetTimeOriginal: '+00:00',
      };
    };
    expect(resolve(tagsAt(inside))).toMatchObject({ kind: 'ok', instantMs: inside });
    expect(resolve(tagsAt(outside))).toEqual({ kind: 'tooOld', instantMs: outside });
  });

  it('the photoTooOld text carries the right date and 21', () => {
    // 12 September 2026, 18:00 in Syros.
    const r = resolve({ DateTimeOriginal: '2026:09:12 18:00:00' });
    expect(r.kind).toBe('tooOld');
    const date = formatPhotoDate((r as { instantMs: number }).instantMs, 'en');
    const text = TRANSLATIONS.en.photoTooOld
      .replaceAll('{date}', date)
      .replaceAll('{days}', String(MAX_PHOTO_AGE_DAYS));
    expect(text).toBe(
      'This photo was taken on 12 September, more than 21 days ago. We can only record sightings from the last 21 days. Please choose a newer photo.',
    );
  });

  it('a saved-for-later photo at the limit still has at least 9 days to be sent', () => {
    // Decision 1: the queue flags an item stale 30 days after its photo date.
    expect(MAX_QUEUE_AGE_MS - MAX_PHOTO_AGE_DAYS * DAY).toBeGreaterThanOrEqual(9 * DAY);
  });
});

describe('showing the time: always Greek time', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('a phone set to Berlin still shows Greek time', () => {
    process.env.TZ = 'Europe/Berlin';
    // 18:42 in Syros on 3 October = 15:42 UTC = 17:42 in Berlin.
    const instant = Date.UTC(2026, 9, 3, 15, 42, 10);
    const when = formatPhotoTaken(instant, 'en');
    expect(when).toBe('3 October, 18:42');
    expect(TRANSLATIONS.en.photoTakenAt.replace('{when}', when)).toBe(
      'Photo taken 3 October, 18:42 (Greek time)',
    );
  });

  it('formats in Greek and French too, with the Greek wall-clock time', () => {
    const instant = Date.UTC(2026, 9, 3, 15, 42, 10);
    expect(formatPhotoTaken(instant, 'el')).toMatch(/^3 Οκτωβρίου, 18:42$/);
    expect(formatPhotoTaken(instant, 'fr')).toMatch(/^3 octobre, 18:42$/);
  });

  it('just after midnight in Syros is the Syros day, not the UTC day', () => {
    // 00:10 on 4 October in Syros = 21:10 UTC on 3 October.
    expect(formatPhotoTaken(Date.UTC(2026, 9, 3, 21, 10), 'en')).toBe('4 October, 00:10');
    expect(formatPhotoDate(Date.UTC(2026, 9, 3, 21, 10), 'en')).toBe('4 October');
  });
});

describe('extractTimeTags: time strings only, never a position', () => {
  const iphone = {
    '{Exif}': {
      DateTimeOriginal: '2026:10:03 18:42:10',
      OffsetTimeOriginal: '+03:00',
      SubsecTimeOriginal: '450',
      LensModel: 'iPhone back camera',
    },
    '{GPS}': {
      Latitude: FIXTURE_LAT,
      LatitudeRef: 'N',
      Longitude: FIXTURE_LNG,
      LongitudeRef: 'E',
      Altitude: 12.5,
      HPositioningError: 4.2,
      DateStamp: '2026:10:03',
      TimeStamp: '15:42:00',
    },
    '{TIFF}': { Make: 'Apple' },
  };
  const android = {
    DateTimeOriginal: '2026:10:03 18:42:10',
    SubSecTimeOriginal: '45',
    GPSDateStamp: '2026:10:03',
    GPSTimeStamp: '15:42:00',
    GPSLatitude: FIXTURE_LAT,
    GPSLatitudeRef: 'N',
    GPSLongitude: FIXTURE_LNG,
    GPSLongitudeRef: 'E',
    GPSAltitude: 12.5,
    Make: 'Google',
  };

  it('reads the iPhone nested shape', () => {
    expect(extractTimeTags(iphone)).toEqual({
      DateTimeOriginal: '2026:10:03 18:42:10',
      OffsetTimeOriginal: '+03:00',
      SubSecTimeOriginal: '450',
      GPSDateStamp: '2026:10:03',
      GPSTimeStamp: '15:42:00',
    });
  });

  it('reads the Android flat shape', () => {
    expect(extractTimeTags(android)).toEqual({
      DateTimeOriginal: '2026:10:03 18:42:10',
      SubSecTimeOriginal: '45',
      GPSDateStamp: '2026:10:03',
      GPSTimeStamp: '15:42:00',
    });
  });

  it('a GPS time given as a list of numbers becomes a string', () => {
    expect(
      extractTimeTags({ DateTimeOriginal: '2026:10:03 18:42:10', GPSTimeStamp: [15, 42, 0] }),
    ).toEqual({ DateTimeOriginal: '2026:10:03 18:42:10', GPSTimeStamp: '15:42:0' });
  });

  it('only the five time keys can ever come out', () => {
    for (const input of [iphone, android]) {
      const keys = Object.keys(extractTimeTags(input));
      for (const k of keys) {
        expect([
          'DateTimeOriginal',
          'OffsetTimeOriginal',
          'SubSecTimeOriginal',
          'GPSDateStamp',
          'GPSTimeStamp',
        ]).toContain(k);
      }
    }
  });

  it('the output contains no part of the fixture position (by value)', () => {
    for (const input of [iphone, android]) {
      const out = JSON.stringify(extractTimeTags(input));
      for (const part of ['37.44', '24.94', '4412345', '9412345', '12.5', '4.2']) {
        expect(out).not.toContain(part);
      }
    }
  });

  it('a position smuggled under a time key is dropped, not copied', () => {
    const out = extractTimeTags({
      DateTimeOriginal: FIXTURE_LAT,
      GPSDateStamp: { lat: FIXTURE_LAT },
      GPSTimeStamp: [FIXTURE_LAT, FIXTURE_LNG],
      '{GPS}': { TimeStamp: { Latitude: FIXTURE_LAT } },
    });
    expect(JSON.stringify(out)).not.toMatch(/37|24\.9|4412|9412/);
  });

  it.each([undefined, null, 'string', 42, [], {}])('%j gives an empty object, never throws', (input) => {
    expect(extractTimeTags(input)).toEqual({});
  });

  it('logs nothing', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    extractTimeTags(iphone);
    extractTimeTags(android);
    resolvePhotoTime(extractTimeTags(iphone), NOW);
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });
});
