#!/usr/bin/env node
/**
 * SYC-705: put MapLibre's web worker where the website can load it.
 *
 * maplibre-gl 6 is ES-module only and starts its worker from a separate file,
 * maplibre-gl-worker.mjs. It finds that file from `import.meta.url`, which
 * Metro can't give it (Expo's stand-in reports the current <script>, which is
 * null by the time the map loads), so the website tells MapLibre where the
 * worker is with setWorkerUrl() (components/map/useMapLibre.web.ts, path from
 * lib/maplibreWorker.ts).
 *
 * This copies the installed worker into public/maplibre/ with the version in
 * its name. Expo serves public/ in development and copies it into dist/ on
 * `expo export`, so the file is served next to the site. The version in the
 * name matches maplibregl.getVersion(), so a page and its worker always come
 * from the same release, and a new release gets a new URL (no stale cache).
 * Older copies are removed. public/maplibre/ is git-ignored.
 *
 * Usage: node scripts/copy-maplibre-worker.js [appDir]
 * Zero dependencies, Node.js built-ins only.
 */

const fs = require('fs');
const path = require('path');

/** Must match maplibreWorkerFile() in lib/maplibreWorker.ts (a test checks). */
function workerFileName(version) {
  return `maplibre-gl-worker-${version}.mjs`;
}

/**
 * Copies the worker installed for appDir into <publicDir>/maplibre/
 * (publicDir defaults to <appDir>/public). Returns the copied file's path.
 */
function copyMaplibreWorker(appDir, publicDir = path.join(appDir, 'public')) {
  const pkgPath = require.resolve('maplibre-gl/package.json', { paths: [appDir] });
  const { version } = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const source = path.join(path.dirname(pkgPath), 'dist', 'maplibre-gl-worker.mjs');
  if (!fs.existsSync(source)) {
    throw new Error(`MapLibre worker not found at ${source}`);
  }

  const outDir = path.join(publicDir, 'maplibre');
  fs.mkdirSync(outDir, { recursive: true });
  const name = workerFileName(version);
  for (const entry of fs.readdirSync(outDir)) {
    if (entry !== name && /^maplibre-gl-worker-.*\.mjs$/.test(entry)) fs.rmSync(path.join(outDir, entry));
  }
  const dest = path.join(outDir, name);
  fs.copyFileSync(source, dest);
  return dest;
}

module.exports = { copyMaplibreWorker, workerFileName };

if (require.main === module) {
  const appDir = path.resolve(process.argv[2] || path.join(__dirname, '..'));
  try {
    const dest = copyMaplibreWorker(appDir);
    console.log(`MapLibre worker: ${path.relative(appDir, dest)}`);
  } catch (err) {
    console.error(`copy-maplibre-worker: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
