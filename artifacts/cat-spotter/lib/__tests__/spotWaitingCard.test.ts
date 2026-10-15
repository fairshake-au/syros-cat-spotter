/**
 * SYC-48 / SYC-36 (match-wait plan PR 1): where the waiting card sits on the
 * New spot screen, and when it shows. `app/` is outside vitest's render
 * paths, so like spotRetake.test.ts this reads the screen's source. These are
 * the weak kind of test (they can't see the screen); the browser-pane check
 * backs them up.
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

describe('the waiting card on the New spot screen', () => {
  it('starts only inside the send callback, never for an offline save (spec test 5, plan C7)', () => {
    // Exactly one call (the definition is `const startWaitingCard = async (`).
    expect(source.match(/startWaitingCard\(/g) ?? []).toHaveLength(1);
    const send = between('send: async () => {', 'save: () =>');
    expect(send).toMatch(/startWaitingCard\(deviceId\)/);
    const save = between('save: () =>', 'offerSaveForLater:');
    expect(save).not.toMatch(/startWaitingCard|setWaitChoice/);
  });

  it('is cleared when the submit ends, in finally', () => {
    const fin = between('} finally {', 'setSubmitting(false);');
    expect(fin).toMatch(/setWaitChoice\(null\)/);
    expect(fin).toMatch(/waitTokenRef\.current \+= 1/);
  });

  it('takes the map\'s place, above the send button (spec test 13)', () => {
    const card = source.indexOf('<WaitingCard choice={waitChoice}');
    const map = source.indexOf('<LocationPicker');
    const button = source.indexOf("t('checkForMatches')");
    expect(card).toBeGreaterThan(-1);
    expect(card).toBeLessThan(map);
    expect(map).toBeLessThan(button);
    // The same slot: the card OR the map, never both.
    expect(source.slice(card, map)).toMatch(/\) : pickedCoords && \(/);
  });

  it('settles the wait before the result screen opens', () => {
    const settle = source.indexOf('settleWait(');
    const push = source.indexOf("pathname: '/review'");
    expect(settle).toBeGreaterThan(-1);
    expect(settle).toBeLessThan(push);
  });

  it('only a sent photo with a cat in it reaches a result, and only then is the record saved (spec tests 4 and 7)', () => {
    const settle = between('const waitOutcome: WaitOutcome =', 'noteSent();');
    expect(settle).toMatch(/outcome\.kind === 'sent'/);
    expect(settle).toMatch(/isCatPhoto/);
    expect(settle).toMatch(/kind: 'notCat'/);
    expect(settle).toMatch(/kind: 'failed'/);
    expect(settle).toMatch(/waitOutcome\.kind === 'result'/);
    expect(settle).toMatch(/loadExistingWaitingRecord/);
  });

  it('the token is bumped as soon as the send returns, before anything else waits', () => {
    const after = between('const outcome = await submitSighting({', 'const waitOutcome');
    const bump = after.indexOf('waitTokenRef.current += 1');
    expect(bump).toBeGreaterThan(-1);
    expect(after.slice(after.indexOf('});'), bump)).not.toMatch(/await /);
  });

  it('7. the result screens show nothing about facts', () => {
    const review = readFileSync(path.resolve(__dirname, '../../app/review.tsx'), 'utf8');
    expect(review).not.toMatch(/WaitingCard|waitingEyebrow|starterFacts|'fact\./);
  });
});
