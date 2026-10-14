/**
 * The photo's own date and time (SYC-166 slice 2; spec
 * photo-location-from-library.md §3.4, plan "The clock").
 *
 * A library photo can be days old, so the sighting is dated to when the photo
 * was taken, not when it was picked. Which clock to trust, in order:
 *  1. the photo's time with its own UTC offset (iPhones record both);
 *  2. the photo's time, with the offset worked out from the GPS clock, but
 *     only when that gives a whole-hour offset within 3 minutes (Samuel's
 *     Decision B2 with B-30 (ii)): a phone that reuses an old position fix
 *     writes a stale GPS time, and an off-grid or half-hour result is that;
 *  3. the photo's time read as Greek time, which is how streak days count.
 * The GPS clock never sets the time on its own.
 *
 * Privacy (plan P2): `extractTimeTags` is the only code that looks inside the
 * picker's tag object, and it returns these five time strings and nothing
 * else. The same object holds the photo's GPS position.
 *
 * Framework-free so it is unit-testable; Intl does the time-zone work, as in
 * campaignDates.ts, so no date library and no hard-coded +2/+3.
 */

/** A photo older than this is not accepted for a sighting (Decision 1). */
export const MAX_PHOTO_AGE_DAYS = 21;

/** The server's own tolerance for a fast clock (captureTime.ts). */
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

const GREEK_TIME_ZONE = 'Europe/Athens';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The only tags the app ever keeps from a photo. All strings. */
export interface TimeTags {
  DateTimeOriginal?: string;
  OffsetTimeOriginal?: string;
  SubSecTimeOriginal?: string;
  GPSDateStamp?: string;
  GPSTimeStamp?: string;
}

export type PhotoTimeSource = 'photo+offset' | 'photo+gps-offset' | 'photo+athens';

export type PhotoTime =
  | { kind: 'ok'; instantMs: number; source: PhotoTimeSource }
  | { kind: 'none'; reason: 'missing' | 'unreadable' | 'future' }
  | { kind: 'tooOld'; instantMs: number };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A string as is; a list of plain numbers joined with ':'; nothing else. */
function timeString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 60)
  ) {
    return value.join(':');
  }
  return undefined;
}

/**
 * The five time tags from whatever the picker returned as `exif`: the
 * Android picker's flat dictionary, or the iPhone's nested `{Exif}` / `{GPS}`
 * one. Nothing else is read out, and no value is copied unless it is a time
 * string, so the photo's position cannot leave this function.
 */
export function extractTimeTags(exif: unknown): TimeTags {
  const flat = asRecord(exif);
  if (!flat) return {};
  const nestedExif = asRecord(flat['{Exif}']);
  const nestedGps = asRecord(flat['{GPS}']);
  const out: TimeTags = {};
  const pick = (key: keyof TimeTags, ...candidates: unknown[]) => {
    for (const c of candidates) {
      const s = key === 'GPSTimeStamp' ? timeString(c) : typeof c === 'string' ? c : undefined;
      if (s !== undefined) {
        out[key] = s;
        return;
      }
    }
  };
  pick('DateTimeOriginal', flat.DateTimeOriginal, nestedExif?.DateTimeOriginal);
  pick('OffsetTimeOriginal', flat.OffsetTimeOriginal, nestedExif?.OffsetTimeOriginal);
  pick(
    'SubSecTimeOriginal',
    flat.SubSecTimeOriginal,
    nestedExif?.SubsecTimeOriginal,
    nestedExif?.SubSecTimeOriginal,
  );
  pick('GPSDateStamp', flat.GPSDateStamp, nestedGps?.DateStamp);
  pick('GPSTimeStamp', flat.GPSTimeStamp, nestedGps?.TimeStamp);
  return out;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock reading as if it were UTC, or NaN if it is not a real time. */
function wallAsUtc(w: WallClock): number {
  const ms = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const d = new Date(ms);
  if (
    w.year < 1970 ||
    d.getUTCFullYear() !== w.year ||
    d.getUTCMonth() !== w.month - 1 ||
    d.getUTCDate() !== w.day ||
    d.getUTCHours() !== w.hour ||
    d.getUTCMinutes() !== w.minute ||
    d.getUTCSeconds() !== w.second
  ) {
    return Number.NaN;
  }
  return ms;
}

function parseDateTimeOriginal(value: string): WallClock | null {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  const w = { year, month, day, hour, minute, second };
  return Number.isNaN(wallAsUtc(w)) ? null : w;
}

/** An offset in ms, or null when absent, out of range or unreadable. */
function parseOffset(value: string | undefined): number | null {
  if (value === undefined) return null;
  const v = value.trim();
  if (v === 'Z') return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(v);
  if (!m) return null;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  if (minutes >= 60) return null;
  const ms = (m[1] === '-' ? -1 : 1) * (hours * HOUR + minutes * MINUTE);
  if (ms < -12 * HOUR || ms > 14 * HOUR) return null;
  return ms;
}

/** One GPS time component: "15", "15.00" or the rational "15/1". */
function gpsNumber(part: string): number {
  const p = part.trim();
  const r = /^(\d+)\/(\d+)$/.exec(p);
  if (r) return Number(r[2]) === 0 ? Number.NaN : Number(r[1]) / Number(r[2]);
  return /^\d+(\.\d+)?$/.test(p) ? Number(p) : Number.NaN;
}

/** The GPS clock as a UTC instant, or NaN. */
function parseGpsClock(date: string | undefined, time: string | undefined): number {
  if (!date || !time) return Number.NaN;
  const d = /^(\d{4})[:-](\d{2})[:-](\d{2})$/.exec(date.trim());
  if (!d) return Number.NaN;
  const parts = time.split(/[:,]/);
  if (parts.length !== 3) return Number.NaN;
  const [h, m, s] = parts.map(gpsNumber);
  if (![h, m, s].every(Number.isFinite) || h >= 24 || m >= 60 || s >= 61) return Number.NaN;
  const midnight = wallAsUtc({
    year: Number(d[1]),
    month: Number(d[2]),
    day: Number(d[3]),
    hour: 0,
    minute: 0,
    second: 0,
  });
  return midnight + Math.round((h * 3600 + m * 60 + s) * 1000);
}

/** "45" -> 450 ms, "123456" -> 123 ms; anything else adds nothing. */
function subSecondMs(value: string | undefined): number {
  const v = value?.trim();
  if (!v || !/^\d+$/.test(v)) return 0;
  return Number(v.slice(0, 3).padEnd(3, '0'));
}

const greekParts = new Intl.DateTimeFormat('en-US', {
  timeZone: GREEK_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** Greek time's UTC offset at an instant, in ms. */
function greekOffsetAt(instantMs: number): number {
  const seconds = Math.floor(instantMs / 1000) * 1000;
  const get = (type: string) =>
    Number(greekParts.formatToParts(new Date(seconds)).find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - seconds;
}

/**
 * A Greek wall-clock reading (month 1-12) as a UTC instant. On the night the
 * clocks go back, a time that happens twice is the earlier instant; on the
 * night they go forward, a time that never happens is read with the winter
 * offset (03:30 becomes 04:30 summer time).
 */
export function athensWallClockToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const before = greekOffsetAt(wall - 12 * HOUR);
  const after = greekOffsetAt(wall + 12 * HOUR);
  const fits = [before, after]
    .filter((offset) => greekOffsetAt(wall - offset) === offset)
    .map((offset) => wall - offset);
  if (fits.length) return Math.min(...fits);
  return wall - before;
}

/**
 * The capture instant for a photo's time tags, or why there isn't one.
 * `now` is epoch ms.
 */
export function resolvePhotoTime(tags: TimeTags, now: number): PhotoTime {
  if (tags.DateTimeOriginal === undefined) return { kind: 'none', reason: 'missing' };
  const wall = parseDateTimeOriginal(tags.DateTimeOriginal);
  if (!wall) return { kind: 'none', reason: 'unreadable' };
  const wallMs = wallAsUtc(wall);

  let instantMs: number;
  let source: PhotoTimeSource;
  const ownOffset = parseOffset(tags.OffsetTimeOriginal);
  const gpsMs = parseGpsClock(tags.GPSDateStamp, tags.GPSTimeStamp);
  const derived = Number.isFinite(gpsMs) ? wallMs - gpsMs : Number.NaN;
  const wholeHour = Math.round(derived / HOUR) * HOUR;
  if (ownOffset !== null) {
    instantMs = wallMs - ownOffset;
    source = 'photo+offset';
  } else if (
    Number.isFinite(derived) &&
    Math.abs(derived) <= DAY &&
    Math.abs(derived - wholeHour) <= 3 * MINUTE &&
    wholeHour >= -12 * HOUR &&
    wholeHour <= 14 * HOUR
  ) {
    instantMs = wallMs - wholeHour;
    source = 'photo+gps-offset';
  } else {
    instantMs = athensWallClockToInstant(
      wall.year,
      wall.month,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    );
    source = 'photo+athens';
  }
  instantMs += subSecondMs(tags.SubSecTimeOriginal);

  if (instantMs > now + MAX_FUTURE_SKEW_MS) return { kind: 'none', reason: 'future' };
  if (now - instantMs > MAX_PHOTO_AGE_DAYS * DAY) return { kind: 'tooOld', instantMs };
  return { kind: 'ok', instantMs, source };
}

const LOCALES: Record<string, string> = { en: 'en-GB', el: 'el-GR', fr: 'fr-FR' };

/** "3 October" in Greek time, in the app's language. */
export function formatPhotoDate(instantMs: number, language: string): string {
  return new Intl.DateTimeFormat(LOCALES[language] ?? 'en-GB', {
    timeZone: GREEK_TIME_ZONE,
    day: 'numeric',
    month: 'long',
  }).format(new Date(instantMs));
}

/** "3 October, 18:42" in Greek time, for photoTakenAt's {when}. */
export function formatPhotoTaken(instantMs: number, language: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: GREEK_TIME_ZONE,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(instantMs));
  const hh = String(Number(parts.find((p) => p.type === 'hour')?.value) % 24).padStart(2, '0');
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${formatPhotoDate(instantMs, language)}, ${hh}:${mm}`;
}
