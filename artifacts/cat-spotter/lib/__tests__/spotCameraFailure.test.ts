/**
 * Final review of PR #9, finding 6: when a live capture fails, the Spot screen
 * must switch to the failed state — which swaps in the phone-camera shutter
 * (`shutterKindFor`, covered in cameraMode.test.ts) and shows one message in
 * the centre panel. Putting back an alert on its own would leave a dead live
 * shutter, and the whole suite stayed green when that was tried.
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

describe('a failed live capture on the Spot screen', () => {
  const capture = handler('captureLivePhoto', 'requestLiveCamera');

  it('switches to the failed state on both the fallback and the error path', () => {
    expect(capture.match(/setCameraFailed\(true\)/g)).toHaveLength(2);
  });

  it('does not put an alert over the failed state', () => {
    expect(capture).not.toMatch(/\bnotify\(/);
  });

  it('shows one message: the bottom hint is hidden while the camera has failed', () => {
    // The failed state builds the centre panel, and the hint only renders
    // when there is no panel.
    expect(source).toMatch(/const cameraPanel = cameraFailed \? \(/);
    expect(source).toMatch(/\{!cameraPanel && \(\s*<Text style=\{styles\.captureHint\}/);
  });

  it('hides the bottom hint while asking for camera access, too', () => {
    // "Tap the button to open your camera" contradicted the "Show live view"
    // prompt and the two stacked on top of each other (seen 30 Sep).
    expect(source).toMatch(/cameraState === 'request' \|\| cameraState === 'settings' \? \(/);
  });
});

describe('when Settings cannot be opened', () => {
  it('explains how to turn camera access on, not to use the camera button', () => {
    // Only reached when access is off for good; the camera button needs the
    // same permission, so pointing at it would send the user round in a loop.
    const settings = handler('openCameraSettings', 'retryLiveCamera');
    expect(settings).toMatch(/catch \{[\s\S]*t\('cameraDeniedHint'\)/);
    expect(settings).not.toMatch(/cameraUnavailableHint/);
  });
});
