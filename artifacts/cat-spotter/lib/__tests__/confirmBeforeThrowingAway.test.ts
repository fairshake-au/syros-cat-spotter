/**
 * SYC-512: three taps used to throw work away with no question: the "x" on a
 * queued spot, the Spot details back chevron ("Start again"), and Keep-safe
 * "Remove". Each now asks first. `app/` and the Keep-safe screen are outside
 * vitest's render paths, so this is a source scan, like spotCameraFailure.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8');
const spot = read('../../app/(tabs)/spot.tsx');
const keepSafe = read('../../components/keepSafe/KeepSafeSettings.tsx');

describe('SYC-512 confirm before throwing away', () => {
  it('asks before discarding a queued spot, from both buttons', () => {
    expect(spot).not.toMatch(/changeQueue\(\(\) => remove\(item\.localId\)\)/);
    expect(spot.match(/confirmDiscardQueued\(item\.localId\)/g)).toHaveLength(2);
    expect(spot).toMatch(/discardSpotTitle[\s\S]*?changeQueue\(\(\) => remove\(localId\)\)/);
  });

  it('asks before the details back chevron clears the photo and pin', () => {
    expect(spot).toMatch(/onPress=\{confirmStartAgain\}/);
    expect(spot).not.toMatch(/onPress=\{clearPhoto\}/);
    expect(spot).toMatch(/startAgainTitle[\s\S]*?if \(sure\) clearPhoto\(\)/);
  });

  it('asks before Keep-safe Remove calls the server', () => {
    const ask = keepSafe.indexOf("t('keepSafeRemoveTitle')");
    const call = keepSafe.indexOf('await removeKeepSafe(');
    expect(ask).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(ask);
  });
});
