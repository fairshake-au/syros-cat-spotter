/**
 * SYC-166 slice 4: how the Spot screen uses lib/mapStart.ts. `app/` is outside
 * vitest's render paths, so like spotRetake.test.ts this reads the screen's
 * source. The rules themselves are tested by value in mapStart.test.ts; the
 * browser check (docs/screenshots/syc-166-slice-4/) backs these up.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../../app/(tabs)/spot.tsx'), 'utf8');

function between(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start, `${startMarker} not found`).toBeGreaterThan(-1);
  expect(end, `${endMarker} not found after ${startMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('the Spot screen map start', () => {
  it('sets the pin only from the resolver, never straight from the phone', () => {
    expect(source).toMatch(/resolveMapStart\(\{\s*source: pickSource,/);
    expect(source).toMatch(/nextMapStart\(\s*mapStart,/);
    expect(source).not.toMatch(/setPickedCoords\(\{ latitude: coords\.latitude/);
  });

  it('tells the resolver where the photo came from, for each way in', () => {
    const pick = between('const pickPhoto = async', 'const captureLivePhoto = async');
    expect(pick).toMatch(/setPickSource\(fromCamera \? 'camera' : 'library'\)/);
    const live = between('const captureLivePhoto = async', 'const requestLiveCamera = async');
    expect(live).toMatch(/setPickSource\('live'\)/);
  });

  it('remounts the map with each new start, so the map actually moves there', () => {
    expect(source).toMatch(/<LocationPicker\s+key=\{mapStartKey\}/);
    const effect = between('const next = nextMapStart(', 'const onMapMoved = ');
    expect(effect).toMatch(/setMapStartKey\(\(k\) => k \+ 1\)/);
  });

  it('counts a move of the map as a touch, so a late fix no longer replaces the start', () => {
    expect(source).toMatch(/onChange=\{onMapMoved\}/);
    const moved = between('const onMapMoved = ', 'const resetMapStart = ');
    expect(moved).toMatch(/isSpotterMove\(mapStart\.coords, next\)/);
    expect(moved).toMatch(/setMapTouched\(true\)/);
  });

  it('passes the touch to the rule, and re-runs it when a fix, the wait or a touch arrives', () => {
    const effect = between('React.useEffect(() => {\n    if (!photo || !pickSource) return;', 'const onMapMoved = ');
    expect(effect).toMatch(
      /nextMapStart\(\s*mapStart,\s*resolveMapStart\(\{\s*source: pickSource,\s*phone: \{ coords, denied, loading: locating \},\s*waitedMs: mapWaitedMs,\s*ask: locationAsk,\s*\}\),\s*mapTouched,\s*\)/,
    );
    const deps = effect.match(/\}, \[([^\]]*)\]\);/);
    expect(deps, 'the effect has no dependency array').not.toBeNull();
    const names = deps![1].split(',').map((d) => d.trim());
    for (const dep of ['photo', 'pickSource', 'coords', 'denied', 'locating', 'mapWaitedMs', 'mapStart', 'mapTouched', 'locationAsk']) {
      expect(names, `the effect does not re-run on ${dep}`).toContain(dep);
    }
  });

  it('starts afresh on a new photo, a retake and a discard', () => {
    const reset = between('const resetMapStart = ', 'const setFirstPhoto = (');
    for (const step of [/setMapStart\(null\)/, /setMapWaitedMs\(0\)/, /setMapTouched\(false\)/, /setPickedCoords\(null\)/]) {
      expect(reset).toMatch(step);
    }
    expect(between('const setFirstPhoto = (', 'const retakeFirstPhoto = ')).toMatch(/resetMapStart\(\);/);
    expect(between('const retakeFirstPhoto = ', 'const clearPhoto = ')).toMatch(/resetMapStart\(\);/);
  });

  // SYC-524 Task 5: the red "location off" text is gone; the location card
  // (spotLocationAsk.test.ts) says what location is doing instead.
  it('shows the line for the start, and no red "location off" text', () => {
    expect(source).toMatch(/\{t\(mapStartHintKey\(mapStart\)\)\}/);
    expect(source).not.toMatch(/\{t\('confirmLocationHint'\)\}/);
    expect(source).not.toMatch(/\{denied && !pickedCoords && \(/);
  });

  it('enables "Check for matches" only once the map has a start', () => {
    expect(source).toMatch(/disabled=\{!canCheckForMatches\(mapStart\) \|\| !pickedCoords \|\| submitting \|\| !deviceId\}/);
  });

  it('gives "This cat needs help" no place while the map sits on an unmoved Ermoupoli start (review M1)', () => {
    expect(source).toMatch(/handoff=\{\{ photo, coords: needsHelpCoords\(mapStart, pickedCoords, mapTouched\) \}\}/);
  });
});
