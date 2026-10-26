/**
 * SYC-705: maplibre-gl 6 loads its worker from a file the site serves.
 * scripts/copy-maplibre-worker.js puts it there and lib/maplibreWorker.ts
 * tells MapLibre where; the two must agree on the name, or every map on the
 * website stays blank.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { maplibreWorkerFile, maplibreWorkerUrl } from '../maplibreWorker';

const require = createRequire(import.meta.url);
const { copyMaplibreWorker, workerFileName } = require('../../scripts/copy-maplibre-worker.js');
const APP_DIR = path.resolve(__dirname, '../..');
const installed = require(require.resolve('maplibre-gl/package.json', { paths: [APP_DIR] })) as {
  version: string;
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpPublic(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maplibre-worker-'));
  dirs.push(dir);
  return dir;
}

describe('MapLibre worker file', () => {
  it('the copy script and the page use the same file name', () => {
    expect(workerFileName('6.15.0')).toBe(maplibreWorkerFile('6.15.0'));
    expect(maplibreWorkerUrl('6.15.0')).toBe('/maplibre/maplibre-gl-worker-6.15.0.mjs');
  });

  it('copies the installed worker under the name the page asks for', () => {
    const publicDir = tmpPublic();
    const dest = copyMaplibreWorker(APP_DIR, publicDir);
    expect(dest).toBe(path.join(publicDir, maplibreWorkerUrl(installed.version)));
    const source = path.join(
      path.dirname(require.resolve('maplibre-gl/package.json', { paths: [APP_DIR] })),
      'dist',
      'maplibre-gl-worker.mjs',
    );
    expect(fs.readFileSync(dest).equals(fs.readFileSync(source))).toBe(true);
  });

  it('removes a copy left from an older version, and nothing else', () => {
    const publicDir = tmpPublic();
    fs.mkdirSync(path.join(publicDir, 'maplibre'));
    fs.writeFileSync(path.join(publicDir, 'maplibre', 'maplibre-gl-worker-0.0.1.mjs'), 'old');
    fs.writeFileSync(path.join(publicDir, 'maplibre', 'notes.txt'), 'keep');
    copyMaplibreWorker(APP_DIR, publicDir);
    expect(fs.readdirSync(path.join(publicDir, 'maplibre')).sort()).toEqual(
      [maplibreWorkerFile(installed.version), 'notes.txt'].sort(),
    );
  });
});
