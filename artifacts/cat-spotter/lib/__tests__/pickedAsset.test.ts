/**
 * SYC-166 slice 2: turning the picker's answer into a photo and its time
 * (spec §9 test 7; plan Steps 3, P2, P8; probes 8 and 9).
 *
 * The tags are read from the picker's answer before any re-encode, so the
 * over-15 MB path and the weak-connection path can't change the time. The
 * picker's `exif` object holds the photo's GPS position, so this file also
 * checks the source: it is read in exactly one place and never kept.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readPickedAsset } from '../pickedAsset';
import { photoFingerprint } from '../recentPhotos';

const NOW = Date.UTC(2026, 9, 10, 12);
const MAX = 15 * 1024 * 1024;
const exif = {
  DateTimeOriginal: '2026:10:03 18:42:10',
  OffsetTimeOriginal: '+03:00',
  GPSLatitude: 37.4412345,
  GPSLongitude: 24.9412345,
};

const shrunk = { uri: 'file:///shrunk.jpg', base64: 'U0hSVU5L' };

function opts(readTime = true) {
  return { readTime, now: NOW, shrink: vi.fn(async () => shrunk), maxUploadBytes: MAX };
}

describe('readPickedAsset', () => {
  it('reads the time from the picker before anything else', async () => {
    const r = await readPickedAsset({ uri: 'file:///a.heic', base64: 'QUJD', exif }, opts());
    expect(r.timeInfo).toEqual({
      kind: 'ok',
      instantMs: Date.UTC(2026, 9, 3, 15, 42, 10),
      source: 'photo+offset',
    });
    expect(r.photo).toEqual({ uri: 'file:///a.heic', base64: 'QUJD' });
    expect(r.fingerprint).toBe(photoFingerprint('QUJD'));
  });

  it('the over-15 MB path gives the same time as the plain path', async () => {
    const plain = await readPickedAsset({ uri: 'u', base64: 'QUJD', exif }, opts());
    const big = 'A'.repeat(Math.ceil((MAX / 3) * 4) + 8);
    const o = opts();
    const viaShrink = await readPickedAsset({ uri: 'u', base64: big, exif }, o);
    expect(o.shrink).toHaveBeenCalledWith('u');
    expect(viaShrink.photo).toEqual(shrunk);
    expect(viaShrink.timeInfo).toEqual(plain.timeInfo);
  });

  it('no base64 from the picker (shrink path) gives the same time, and a fingerprint of what is sent', async () => {
    const plain = await readPickedAsset({ uri: 'u', base64: 'QUJD', exif }, opts());
    const r = await readPickedAsset({ uri: 'u', base64: null, exif }, opts());
    expect(r.timeInfo).toEqual(plain.timeInfo);
    expect(r.fingerprint).toBe(photoFingerprint(shrunk.base64));
  });

  it('a re-encode that drops the tags (the weak-connection path) cannot change the time: it is read first', async () => {
    const o = opts();
    o.shrink.mockImplementation(async () => {
      // Whatever the re-encode does to the photo, the time is already parsed.
      return { uri: 'file:///re-encoded.jpg', base64: 'UkU=' };
    });
    const r = await readPickedAsset({ uri: 'u', base64: undefined, exif }, o);
    expect(r.timeInfo).toMatchObject({ kind: 'ok', instantMs: Date.UTC(2026, 9, 3, 15, 42, 10) });
  });

  describe("'unread': no line, recorded as now", () => {
    it.each([
      ['empty exif object', {}],
      ['null exif', null],
      ['absent exif', undefined],
      ['not an object', 'exif'],
    ])('%s -> unread', async (_label, value) => {
      const r = await readPickedAsset({ uri: 'u', base64: 'QUJD', exif: value }, opts());
      expect(r.timeInfo).toEqual({ kind: 'unread' });
    });

    it('the website (no tags read) -> unread, even if the picker returned some', async () => {
      const r = await readPickedAsset({ uri: 'u', base64: 'QUJD', exif }, opts(false));
      expect(r.timeInfo).toEqual({ kind: 'unread' });
    });
  });

  it('exif with only GPS keys and no time -> none, and the line is shown', async () => {
    const r = await readPickedAsset(
      { uri: 'u', base64: 'QUJD', exif: { GPSLatitude: 37.44, GPSDateStamp: '2026:10:03', GPSTimeStamp: '15:42:00' } },
      opts(),
    );
    expect(r.timeInfo).toEqual({ kind: 'none', reason: 'missing' });
  });

  it('a too-old photo comes back as tooOld', async () => {
    const r = await readPickedAsset(
      { uri: 'u', base64: 'QUJD', exif: { DateTimeOriginal: '2026:09:12 18:00:00' } },
      opts(),
    );
    expect(r.timeInfo.kind).toBe('tooOld');
  });

  it('the result carries no part of the photo position, and nothing is logged', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const r = await readPickedAsset({ uri: 'u', base64: 'QUJD', exif }, opts());
    expect(JSON.stringify(r)).not.toMatch(/37\.44|24\.94|4412345|9412345/);
    expect(Object.keys(r).sort()).toEqual(['fingerprint', 'photo', 'timeInfo']);
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });
});

describe('source check: the picker tags are read in one place and never kept (P2)', () => {
  const APP_ROOT = path.resolve(__dirname, '../..');
  const DIRS = ['app', 'components', 'context', 'hooks', 'lib'];

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '__tests__') continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }

  const files = DIRS.flatMap((d) => sourceFiles(path.join(APP_ROOT, d))).map((f) => ({
    rel: path.relative(APP_ROOT, f),
    src: readFileSync(f, 'utf8'),
  }));

  it('`.exif` (or ["exif"], or a destructured exif) is read only in lib/pickedAsset.ts', () => {
    const readers = files
      .filter(({ src }) =>
        /\.exif\b|\[\s*['"]exif['"]\s*\]|\{[^}]*\bexif\b[^}]*\}\s*=/.test(
          src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''),
        ),
      )
      .map((f) => f.rel);
    expect(readers).toEqual(['lib/pickedAsset.ts']);
  });

  it('the Spot screen asks for tags only from the library picker, once', () => {
    const spot = files.find((f) => f.rel === path.join('app', '(tabs)', 'spot.tsx'))!;
    const asks = spot.src.match(/\bexif\s*:/g) ?? [];
    expect(asks).toHaveLength(1);
    const at = spot.src.indexOf('exif:');
    const library = spot.src.lastIndexOf('launchImageLibraryAsync', at);
    const camera = spot.src.lastIndexOf('launchCameraAsync', at);
    expect(library).toBeGreaterThan(camera);
  });

  it('no other file mentions exif at all', () => {
    const mentions = files
      .filter(({ src }) => /\bexif\b/i.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')))
      .map((f) => f.rel)
      .sort();
    expect(mentions).toEqual(
      [path.join('app', '(tabs)', 'spot.tsx'), 'lib/pickedAsset.ts', 'lib/photoClock.ts'].sort(),
    );
  });

  it('the new files log nothing (P8)', () => {
    for (const rel of ['lib/pickedAsset.ts', 'lib/photoClock.ts', 'lib/recentPhotos.ts']) {
      const src = files.find((f) => f.rel === rel)!.src;
      expect(src).not.toMatch(/\bconsole\./);
    }
  });
});

describe('the website keeps today\'s behaviour (slice 2W is its own reader)', () => {
  const spot = readFileSync(path.resolve(__dirname, '../../app/(tabs)/spot.tsx'), 'utf8');

  it('the 21-day card and the same-photo check run for library photos on the phone apps only', () => {
    expect(spot).toMatch(/const libraryOnPhone = !fromCamera && Platform\.OS !== 'web';/);
    const at = spot.indexOf('const libraryOnPhone');
    const guarded = spot.indexOf('if (libraryOnPhone) {', at);
    expect(guarded).toBeGreaterThan(at);
    // Both checks sit inside that guard, before the photo is set.
    const setPhotoAt = spot.indexOf('setPhoto(next);', guarded);
    for (const check of ["timeInfo.kind === 'tooOld'", 'findAlreadyLogged(']) {
      const i = spot.indexOf(check, guarded);
      expect(i).toBeGreaterThan(guarded);
      expect(i).toBeLessThan(setPhotoAt);
    }
    expect(spot).toMatch(/photoFingerprintRef\.current = libraryOnPhone \? fingerprint : undefined;/);
  });

  it('the recent-photos list is read and written in the phone apps only', () => {
    expect(spot).toMatch(/const recentPhotosOn = Platform\.OS !== 'web';/);
    expect(spot).toMatch(/recentPhotosOn\s*\?\s*uniqueCaptureTime\(/);
    expect(spot).toMatch(/if \(recentPhotosOn && remembered\) \{\s*await recordRecentPhoto\(/);
    expect(spot.match(/\brecordRecentPhoto\(/g)).toHaveLength(1);
    expect(spot.match(/\buniqueCaptureTime\(/g)).toHaveLength(1);
  });

  it('tags are read only off the website', () => {
    expect(spot).toMatch(/readTime: !fromCamera && Platform\.OS !== 'web'/);
    expect(spot).toMatch(/exif: Platform\.OS !== 'web'/);
  });
});
