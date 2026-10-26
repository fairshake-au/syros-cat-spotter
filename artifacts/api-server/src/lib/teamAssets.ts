import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger";

// The dashboard's own scripts (SYC-396 plan Decision 4; Task 1.3.4). Served
// by GET /api/team/assets/:file (routes/teamAssets.ts) under a name that
// carries a hash of the file, so a browser may keep each one for a year: a
// changed file is a new name.
//
// Where the files come from, decided once at start-up:
// - **Built** (production, and `pnpm run dev`, which builds first): the
//   bundle is dist/index.mjs, and build.mjs has written dist/assets/ and
//   dist/assets/manifest.json beside it (scripts/buildAssets.mjs). Used
//   whenever that manifest exists next to the running code. Each file's hash
//   is checked against its name; a file that doesn't match is not served.
// - **Source** (tests, and anything run from src/ with no build): this file
//   is src/lib/teamAssets.ts, so there is no dist/assets beside it. The
//   files are read from artifacts/api-server/assets/ and named with the same
//   rule, worked out in memory. Nothing is written to disk.
// Either way the files are read into memory at start-up, and only an exact
// name from the manifest is ever served: a request's file name is looked up
// in a Map, never joined onto a folder path.

/** The files pages may ask for. A new one is added here and to assets/ (or VENDOR). */
export const ASSET_NAMES = [
  "dashboard-grid.js",
  "dashboard-map.js",
  "find-photo.js",
  "leaflet.js",
  "leaflet.css",
  "inter-latin.woff2",
  "inter-latin-ext.woff2",
  "inter-greek.woff2",
] as const;

/**
 * Files copied from a pinned npm package rather than kept in assets/
 * (SYC-396 PR 1.5): Leaflet 1.9.4, the island map's library. The same list
 * is in scripts/buildAssets.mjs, which copies them into dist/assets/ for
 * production; running from source they are read from node_modules here.
 */
export const VENDOR: Readonly<Record<string, string>> = {
  "leaflet.css": "leaflet/dist/leaflet.css",
  "leaflet.js": "leaflet/dist/leaflet.js",
  // Inter, the app's typeface (SYC-579), pinned at @fontsource-variable/inter
  // 5.2.8: one variable file per script, so every weight is one download.
  "inter-latin.woff2": "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  "inter-latin-ext.woff2": "@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2",
  "inter-greek.woff2": "@fontsource-variable/inter/files/inter-greek-wght-normal.woff2",
};

/** The bytes of a vendored file, from its package. Throws if it isn't installed. */
export function vendorBytes(name: string): Buffer {
  return readFileSync(createRequire(import.meta.url).resolve(VENDOR[name]!));
}
export type AssetName = (typeof ASSET_NAMES)[number];

export const ASSET_PATH = "/api/team/assets";

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

/** The same rule as scripts/buildAssets.mjs: the first 12 hex digits of the SHA-256. */
export function hashedName(name: string, bytes: Buffer): string {
  const ext = path.extname(name);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  return `${name.slice(0, -ext.length)}.${hash}${ext}`;
}

export interface AssetFile {
  bytes: Buffer;
  type: string;
}

export interface LoadedAssets {
  /** The plain name (dashboard-grid.js) to its hashed name. */
  names: Map<string, string>;
  /** The hashed name to its bytes and type: everything there is to serve. */
  files: Map<string, AssetFile>;
}

function typeOf(name: string): string | undefined {
  return Object.hasOwn(TYPES, path.extname(name)) ? TYPES[path.extname(name)] : undefined;
}

/** Reads the assets from dist/assets (with its manifest) or from the source folder. */
export function loadAssets(from: { builtDir: string } | { sourceDir: string }): LoadedAssets {
  const names = new Map<string, string>();
  const files = new Map<string, AssetFile>();
  if ("builtDir" in from) {
    const manifest = JSON.parse(readFileSync(path.join(from.builtDir, "manifest.json"), "utf8")) as Record<string, unknown>;
    for (const [name, hashed] of Object.entries(manifest)) {
      const type = typeOf(name);
      if (typeof hashed !== "string" || !type || path.basename(hashed) !== hashed) {
        logger.error({ asset: name }, "dashboard asset: bad manifest entry, not served");
        continue;
      }
      let bytes: Buffer;
      try {
        bytes = readFileSync(path.join(from.builtDir, hashed));
      } catch {
        logger.error({ asset: name }, "dashboard asset: file named in the manifest is missing, not served");
        continue;
      }
      if (hashedName(name, bytes) !== hashed) {
        logger.error({ asset: name }, "dashboard asset: file doesn't match its hash, not served");
        continue;
      }
      names.set(name, hashed);
      files.set(hashed, { bytes, type });
    }
  } else {
    for (const name of readdirSync(from.sourceDir).sort()) {
      const type = typeOf(name);
      if (!type) continue;
      const bytes = readFileSync(path.join(from.sourceDir, name));
      const hashed = hashedName(name, bytes);
      names.set(name, hashed);
      files.set(hashed, { bytes, type });
    }
    for (const name of Object.keys(VENDOR)) {
      let bytes: Buffer;
      try {
        bytes = vendorBytes(name);
      } catch {
        logger.error({ asset: name }, "dashboard asset: vendored package not installed, not served");
        continue;
      }
      names.set(name, hashedName(name, bytes));
      files.set(hashedName(name, bytes), { bytes, type: typeOf(name)! });
    }
  }
  return { names, files };
}

export interface Assets {
  assetUrl(name: AssetName): string | null;
  assetFile(hashed: string): AssetFile | undefined;
}

/**
 * The assets for code running from `codeDir`: dist/assets beside it if its
 * manifest is there, otherwise the source folder two levels up. Never
 * throws: anything unreadable is logged, and that file (or every file) is
 * left out, so its page runs as an ordinary form. Exported for the tests;
 * the server uses the one made below for this file's own folder.
 */
export function createAssets(codeDir: string): Assets {
  const builtDir = path.join(codeDir, "assets");
  let loaded: LoadedAssets;
  try {
    loaded = existsSync(path.join(builtDir, "manifest.json"))
      ? loadAssets({ builtDir })
      : loadAssets({ sourceDir: path.resolve(codeDir, "../../assets") });
  } catch (err) {
    // Every page still works without its script; say so loudly.
    logger.error({ err: { type: (err as Error)?.name } }, "dashboard assets could not be read; pages run without scripts");
    loaded = { names: new Map(), files: new Map() };
  }
  for (const name of ASSET_NAMES) {
    if (!loaded.names.has(name)) logger.error({ asset: name }, "dashboard asset missing; its page runs without it");
  }
  return {
    assetUrl: (name) => {
      const hashed = loaded.names.get(name);
      return hashed ? `${ASSET_PATH}/${hashed}` : null;
    },
    assetFile: (hashed) => loaded.files.get(hashed),
  };
}

const assets = createAssets(path.dirname(fileURLToPath(import.meta.url)));

/**
 * The address of one of our files, e.g. /api/team/assets/dashboard-grid.3f9a1c2b4d5e.js.
 * Null only if the file couldn't be read at start-up (logged); the page then
 * leaves the script out and works as an ordinary form.
 */
export function assetUrl(name: AssetName): string | null {
  return assets.assetUrl(name);
}

/** The file for exactly this hashed name, or undefined. Never touches the disk. */
export function assetFile(hashed: string): AssetFile | undefined {
  return assets.assetFile(hashed);
}
