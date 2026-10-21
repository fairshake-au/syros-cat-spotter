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

/** The text between two markers, failing loudly if either is missing (so a
 * renamed marker can't make a not.toMatch pass on the wrong slice). */
function between(text: string, start: string, end: string): string {
  const i = text.indexOf(start);
  const j = text.indexOf(end, i + 1);
  expect(i, `${start} not found`).toBeGreaterThan(-1);
  expect(j, `${end} not found after ${start}`).toBeGreaterThan(i);
  return text.slice(i, j);
}

describe('the feeding nudge on the result screens', () => {
  it('is decided before any early return (hooks order) and from the screen it opened on', () => {
    const decide = source.indexOf('useResultNudge({');
    expect(decide).toBeGreaterThan(-1);
    expect(decide).toBeLessThan(source.indexOf('if (!data) {'));
    // SYC-503: a failed look-alike check is its own screen, checked first.
    expect(source).toMatch(
      /const openedOn = checkFailed\s*\? "couldntCheck"\s*: !data\?\.isCatPhoto\s*\? "notCat"\s*: data\.candidates\.length === 0\s*\? "naming"\s*: "matches"/,
    );
  });

  it('2. on the match list: after the matches, "Find the cat yourself" and "None of these", before "This cat needs help"', () => {
    const start = source.indexOf('// ----- ③ Match — have we met? -----');
    expect(start).toBeGreaterThan(-1);
    const matchList = source.slice(start);
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
    const notCat = between(source, 'if (!checkFailed && !data.isCatPhoto) {', 'if (showPicker) {');
    expect(notCat).not.toMatch(/feedNudge/);
    const reward = between(source, 'if (result) {', 'if (!checkFailed && !data.isCatPhoto) {');
    expect(reward).not.toMatch(/feedNudge/);
    // SYC-503: nor on the "couldn't check" screen.
    const couldntCheck = between(source, 'if (checkFailed && !showNewCat) {', '// ----- ④ Name');
    expect(couldntCheck).not.toMatch(/feedNudge/);
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
    expect(hook).toMatch(/if \(decided\.current \|\| !deviceId \|\| sightingId === null\) return;/);
    expect(hook).toMatch(/loadExistingWaitingRecord/);
  });

  it('the decision is never thrown away by an effect clean-up (development builds mount twice)', () => {
    // Weak kind: React in this test setup doesn't double-run effects under
    // StrictMode (checked: one run), so the case can't be rendered here. The
    // fix is that the deciding effect has no clean-up guarding setShow.
    // The effect that ends with the [deviceId, sightingId] deps, found from its end.
    const end = hook.indexOf('}, [deviceId, sightingId]);');
    expect(end).toBeGreaterThan(-1);
    const effect = hook.slice(hook.lastIndexOf('useEffect(() => {', end), end);
    expect(effect).toMatch(/decided\.current = true/);
    expect(effect).toMatch(/setShow\(out\.show\);/);
    expect(effect).not.toMatch(/let alive|isMounted|mountedRef|return \(\) =>/);
  });
});
