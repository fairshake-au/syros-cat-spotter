/**
 * SYC-36 (match-wait plan PR 2; feeding-nudge.md §3.3, §9.1 tests 2, 3, 15):
 * where the nudge sits on the result screens. `app/` is outside vitest's
 * render paths, so this reads the screen's source: the weak kind of test,
 * backed by the browser-pane check. The rules themselves are tested as pure
 * functions in waitingCard.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../../app/review.tsx'), 'utf8');
const hook = readFileSync(path.resolve(__dirname, '../../hooks/useResultNudge.ts'), 'utf8');

describe('the feeding nudge on the result screens', () => {
  it('is decided before any early return (hooks order) and from the screen it opened on', () => {
    const decide = source.indexOf('useResultNudge({');
    expect(decide).toBeGreaterThan(-1);
    expect(decide).toBeLessThan(source.indexOf('if (!data) {'));
    expect(source).toMatch(/const openedOn = !data\?\.isCatPhoto \? "notCat" : data\.candidates\.length === 0 \? "naming" : "matches"/);
  });

  it('2. on the match list: after the matches, "Find the cat yourself" and "None of these", before "This cat needs help"', () => {
    const matchList = source.slice(source.indexOf('// ----- ③ Match — have we met? -----'));
    const findCat = matchList.indexOf('testID="find-the-cat-card"');
    const noneOfThese = matchList.indexOf('t("newCatCardTitle")');
    const nudge = matchList.indexOf('{feedNudge}');
    const needsHelp = matchList.indexOf('<NeedsHelpLink');
    expect(findCat).toBeGreaterThan(-1);
    expect(findCat).toBeLessThan(nudge);
    expect(noneOfThese).toBeLessThan(nudge);
    expect(nudge).toBeLessThan(needsHelp);
  });

  it('2. on naming: after the name field and its button, only when naming is where it opened', () => {
    const add = source.indexOf('t("addToCatalogButton")');
    const nudge = source.indexOf('{openedOn === "naming" ? feedNudge : null}');
    expect(add).toBeGreaterThan(-1);
    expect(nudge).toBeGreaterThan(add);
  });

  it('3. never on the no-cat screen or the reward screen', () => {
    const notCat = source.slice(source.indexOf('if (!data.isCatPhoto) {'), source.indexOf('if (showPicker) {'));
    expect(notCat).not.toMatch(/feedNudge/);
    const reward = source.slice(source.indexOf('if (result) {'), source.indexOf('if (!data.isCatPhoto) {'));
    expect(reward).not.toMatch(/feedNudge/);
  });

  it('15. a queued sighting is passed through as such (its localId), so it never shows', () => {
    expect(source).toMatch(/localId: data\?\.localId/);
    expect(hook).toMatch(/\{ sightingId, localId, screen \}/);
  });

  it('Help feed a cat opens the counting address in the phone\'s own browser, and marks the tap', () => {
    expect(hook).toMatch(/Linking\.openURL\(feedLinkUrl\(\)\)/);
    expect(hook).toMatch(/\$\{apiOrigin\(\)\}\/api\/go\/feed/);
    expect(hook).toMatch(/markTapped\(record\)/);
    expect(hook).not.toMatch(/WebBrowser|openBrowserAsync/);
  });

  it('decides once, from a stored record only (a wiped record is not brought back)', () => {
    expect(hook).toMatch(/if \(decided\.current\) return;/);
    expect(hook).toMatch(/loadExistingWaitingRecord/);
  });
});
