// SYC-396 PR 1.3.4: the dashboard's own scripts and styles, for production.
//
// Copies every file in artifacts/api-server/assets/ into dist/assets/ under a
// name that carries the first 12 hex digits of its SHA-256
// (dashboard-grid.js -> dashboard-grid.3f9a1c2b4d5e.js), and writes
// dist/assets/manifest.json: { "dashboard-grid.js": "dashboard-grid.3f9a1c2b4d5e.js" }.
// A changed file gets a new name, so the server can tell browsers to keep
// each one for a year (GET /api/team/assets/:file).
//
// The same naming rule is in src/lib/teamAssets.ts, which works it out in
// memory when there is no dist/ (tests, and running from source).
// teamAssets.test.ts runs this script and checks the two agree.
//
// Vendored files (SYC-396 PR 1.5): Leaflet 1.9.4, the island map's library,
// is copied the same way from the pinned npm package (api-server's
// devDependency), never from another website. VENDOR names each one; the
// same list is in src/lib/teamAssets.ts.
//
// Run by build.mjs, or on its own: node scripts/buildAssets.mjs <src> <out>.

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The kinds of file the dashboard serves. Anything else in assets/ fails the build. */
export const ASSET_EXTENSIONS = [".js", ".mjs", ".css"];

/** Files copied from npm packages: the served name to the package file. */
export const VENDOR = {
  "leaflet.css": "leaflet/dist/leaflet.css",
  "leaflet.js": "leaflet/dist/leaflet.js",
  // SYC-705 Task 2b.4: the dashboard's maps, MapLibre GL JS 6.15.0 (an ES
  // module; MapLibre starts its worker from the same folder) and PMTiles 4.3.2
  // (a classic script that defines the global `pmtiles`).
  "maplibre-gl.mjs": "maplibre-gl/dist/maplibre-gl.mjs",
  "maplibre-gl-worker.mjs": "maplibre-gl/dist/maplibre-gl-worker.mjs",
  "maplibre-gl.css": "maplibre-gl/dist/maplibre-gl.css",
  "pmtiles.js": "pmtiles/dist/pmtiles.js",
  "inter-latin.woff2": "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  "inter-latin-ext.woff2": "@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2",
  "inter-greek.woff2": "@fontsource-variable/inter/files/inter-greek-wght-normal.woff2",
};

const require = createRequire(import.meta.url);

/**
 * The file on disk for a "package/path/inside" spec. A package whose
 * "exports" map hides the path (pmtiles) is found through its package.json
 * instead, which every package exports. Same rule as src/lib/teamAssets.ts.
 */
function resolveVendor(spec) {
  try {
    return require.resolve(spec);
  } catch (err) {
    if (err?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw err;
    const parts = spec.split("/");
    const n = spec.startsWith("@") ? 2 : 1;
    const pkgDir = path.dirname(require.resolve(`${parts.slice(0, n).join("/")}/package.json`));
    return path.join(pkgDir, ...parts.slice(n));
  }
}

/** A plain file name: letters, digits, dot, dash, underscore; no folder. */
const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

export function hashedName(name, bytes) {
  const ext = path.extname(name);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  return `${name.slice(0, -ext.length)}.${hash}${ext}`;
}

export async function buildAssets(srcDir, outDir) {
  const entries = (await readdir(srcDir, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  await mkdir(outDir, { recursive: true });
  const manifest = {};
  for (const e of entries) {
    // Deliberately fails the whole build: loud is safer than shipping a file nobody reviewed.
    if (!e.isFile() || !NAME_RE.test(e.name) || !ASSET_EXTENSIONS.includes(path.extname(e.name))) {
      throw new Error(`assets/: ${e.name} is not a .js, .mjs or .css file with a plain name`);
    }
    const bytes = await readFile(path.join(srcDir, e.name));
    const out = hashedName(e.name, bytes);
    await writeFile(path.join(outDir, out), bytes);
    manifest[e.name] = out;
  }
  for (const [name, spec] of Object.entries(VENDOR)) {
    if (Object.hasOwn(manifest, name)) throw new Error(`assets/: ${name} is vendored; remove the copy in assets/`);
    const bytes = await readFile(resolveVendor(spec));
    const out = hashedName(name, bytes);
    await writeFile(path.join(outDir, out), bytes);
    manifest[name] = out;
  }
  await writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) {
    console.error("usage: node scripts/buildAssets.mjs <src> <out>");
    process.exit(2);
  }
  buildAssets(src, out).then(
    (m) => console.log(JSON.stringify(m)),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
