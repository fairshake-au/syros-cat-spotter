import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

/** The files pages may ask for. A new one is added here and to assets/. */
export const ASSET_NAMES = ["dashboard-grid.js"] as const;
export type AssetName = (typeof ASSET_NAMES)[number];

export const ASSET_PATH = "/api/team/assets";

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
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
      const bytes = readFileSync(path.join(from.builtDir, hashed));
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
  }
  return { names, files };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const builtDir = path.join(here, "assets");

function loadAtStartup(): LoadedAssets {
  try {
    return existsSync(path.join(builtDir, "manifest.json"))
      ? loadAssets({ builtDir })
      : loadAssets({ sourceDir: path.resolve(here, "../../assets") });
  } catch (err) {
    // Every page still works without its script; say so loudly.
    logger.error({ err: { type: (err as Error)?.name } }, "dashboard assets could not be read; pages run without scripts");
    return { names: new Map(), files: new Map() };
  }
}

const loaded = loadAtStartup();

for (const name of ASSET_NAMES) {
  if (!loaded.names.has(name)) logger.error({ asset: name }, "dashboard asset missing; its page runs without it");
}

/**
 * The address of one of our files, e.g. /api/team/assets/dashboard-grid.3f9a1c2b4d5e.js.
 * Null only if the file couldn't be read at start-up (logged); the page then
 * leaves the script out and works as an ordinary form.
 */
export function assetUrl(name: AssetName): string | null {
  const hashed = loaded.names.get(name);
  return hashed ? `${ASSET_PATH}/${hashed}` : null;
}

/** The file for exactly this hashed name, or undefined. Never touches the disk. */
export function assetFile(hashed: string): AssetFile | undefined {
  return loaded.files.get(hashed);
}
