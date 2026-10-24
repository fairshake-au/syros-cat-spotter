/**
 * SYC-575: the Spot screen has one "Take a photo" button that opens the phone's
 * camera, and a "Choose from your photos" link. The in-app live view was
 * removed, so this guards that it doesn't creep back as a second path.
 *
 * `app/` is outside vitest's render paths, so this is a source scan, like the
 * route check in reviewRoutes.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.resolve(__dirname, '../../app/(tabs)/spot.tsx'),
  'utf8',
);

/** The source of one `const name = async (...) => { ... }` handler. */
function handler(name: string, next: string): string {
  const start = source.indexOf(`const ${name} = async`);
  const end = source.indexOf(`const ${next} = `, start);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  expect(end, `${next} not found after ${name}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('the Spot screen has one way to take a photo (SYC-575)', () => {
  it('has no live view: no in-app camera, permission prompt or live shutter', () => {
    expect(source).not.toMatch(/\bCameraView\b/);
    expect(source).not.toMatch(/useCameraPermissions/);
    expect(source).not.toMatch(/captureLivePhoto|requestLiveCamera|retryLiveCamera/);
    expect(source).not.toMatch(/live-camera|showLiveView/);
  });

  it('wires the button to the phone camera and the link to the library', () => {
    expect(source).toMatch(/onTakePhoto=\{\(\) => pickPhoto\(true\)\}/);
    expect(source).toMatch(/onChooseFromLibrary=\{\(\) => pickPhoto\(false\)\}/);
  });

  it('hides the Photo tips lightbulb glyph from screen readers', () => {
    expect(source).toMatch(
      /<MaterialCommunityIcons[\s\S]*?name="lightbulb-on-outline"[\s\S]*?aria-hidden[\s\S]*?\/>/,
    );
  });
});

describe('when Settings cannot be opened', () => {
  it('explains how to turn camera access on, not to use the camera button', () => {
    // Only reached when access is off for good; the camera button needs the
    // same permission, so pointing at it would send the user round in a loop.
    const settings = handler('openCameraSettings', 'reportSaveFailure');
    expect(settings).toMatch(/catch \{[\s\S]*t\('cameraDeniedHint'\)/);
    expect(settings).not.toMatch(/cameraUnavailableHint/);
  });
});
