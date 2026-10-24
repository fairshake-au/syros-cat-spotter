/**
 * SYC-524 Task 5: how the Spot screen uses lib/locationAsk.ts and the card.
 * `app/` is outside vitest's render paths, so like spotMapStart.test.ts this
 * reads the screen's source. The rules themselves are tested by value in
 * locationAsk.test.ts and mapStart.test.ts, the card in LocationAskCard.test.tsx.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRANSLATIONS } from '../i18n';

const source = readFileSync(path.resolve(__dirname, '../../app/(tabs)/spot.tsx'), 'utf8');

function between(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start, `${startMarker} not found`).toBeGreaterThan(-1);
  expect(end, `${endMarker} not found after ${startMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

/** Every useEffect body with its dependency list. */
function effects(): { body: string; deps: string[] }[] {
  const out: { body: string; deps: string[] }[] = [];
  const re = /(?:React\.)?useEffect\(\(\) => \{([\s\S]*?)\n\s*\}, \[([^\]]*)\]\);/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    out.push({ body: m[1], deps: m[2].split(',').map((d) => d.trim()).filter(Boolean) });
  }
  return out;
}

describe('the Spot screen location card', () => {
  it('never asks from a mount effect', () => {
    for (const e of effects()) {
      if (e.deps.length === 0) expect(e.body).not.toMatch(/askAndLocate\(\)/);
    }
  });

  it('has no orange "Location permission is needed" line, and the key is retired', () => {
    expect(source).not.toMatch(/t\('locationDenied'\)/);
    for (const lang of ['en', 'el', 'fr'] as const) {
      expect((TRANSLATIONS as any)[lang].locationDenied, lang).toBeUndefined();
    }
  });

  it('works out what to show from the shared state and this photo\'s answer', () => {
    const call = between('locationAskView({', '})');
    for (const field of [
      /source: pickSource/,
      /hasPhoto: !!photo/,
      /permission/,
      /choice/,
      /platform: Platform\.OS === 'web' \? 'web' : 'native'/,
      /answeredThisPhoto/,
      /checked/,
    ]) {
      expect(call).toMatch(field);
    }
  });

  it("asks straight away for a spotter who shared before ('auto-ask'), once per photo", () => {
    const auto = effects().find((e) => /shouldAutoAsk\(/.test(e.body));
    expect(auto, 'no effect calls shouldAutoAsk').toBeDefined();
    expect(auto!.body).toMatch(/shouldAutoAsk\(rawLocationAsk, photo, autoAskedPhotoRef\.current\)/);
    expect(auto!.body).toMatch(/askAndLocate\(\)/);
    // F4: tracked as the automatic ask, so the map holds while the phone's box is up.
    expect(auto!.body).toMatch(/trackAsk\('auto', askAndLocate\(\)\)/);
    expect(auto!.body).toMatch(/autoAskedPhotoRef\.current = photo/);
    expect(auto!.body).toMatch(/setAnsweredThisPhoto\(true\)/);
    expect(auto!.deps).toContain('photo');
  });

  it('holds the view through the helper, for the map start and the card alike (F1)', () => {
    expect(source).toMatch(
      /const locationAsk = effectiveLocationAsk\(\{\s*raw: rawLocationAsk,\s*askFrom,\s*hasCoords: !!coords,\s*\}\);/,
    );
    expect(source).toMatch(/view=\{locationAsk\}/);
  });

  it('hides the map and its pin while the card shows (F3)', () => {
    expect(source).toMatch(/\) : pickedCoords && locationAsk !== 'card' && \(\s*<LocationPicker/);
  });

  it('shows no card UI during the automatic ask: the phone\'s box is the UI (F4)', () => {
    const where = between("{t('whereDidYouSeeIt')}", '<LocationAskCard');
    expect(where).toMatch(/askFrom !== 'auto'/);
  });

  it('tells the map start what the screen shows', () => {
    expect(between('resolveMapStart({', '}),')).toMatch(/ask: locationAsk,/);
  });

  it('forgets this photo\'s answer with each new photo', () => {
    const reset = between('const resetMapStart = ', 'const setFirstPhoto = (');
    expect(reset).toMatch(/setAnsweredThisPhoto\(false\)/);
  });

  it('both card buttons answer for this photo; only the map one remembers the map', () => {
    const use = between('const onUseWhereIAm = ', 'const onPutPinOnMap = ');
    expect(use).toMatch(/setAnsweredThisPhoto\(true\)/);
    expect(use).toMatch(/askAndLocate\(\)/);
    const map = between('const onPutPinOnMap = ', '};');
    expect(map).toMatch(/chooseMap\(\)/);
    expect(map).toMatch(/setAnsweredThisPhoto\(true\)/);
  });

  it('shows the card under "Where did you see it?", above the map', () => {
    const where = between("{t('whereDidYouSeeIt')}", '<LocationPicker');
    expect(where).toMatch(/<LocationAskCard\s/);
    expect(where).toMatch(/onUse=\{onUseWhereIAm\}/);
    expect(where).toMatch(/onMap=\{onPutPinOnMap\}/);
    expect(where).toMatch(/onOpenSettings=\{/);
  });
});
