import { createHash } from "node:crypto";
import { and, desc, eq, lt } from "drizzle-orm";
import { db, mapDataFilesTable } from "@workspace/db";
import { logger } from "../logger";

// SYC-705 Phase 2, Task 2b.2: the dashboard map's files, fetched once from
// our own map host, checked against its manifest, and kept in Postgres (they
// survive a restart) and in memory (the current version only). The routes
// that serve them are Task 2b.3.

export const MAP_HOST = "https://tiles.catspotters.com";
export const MAP_FALLBACK_VERSION = 2;

export const FONT_STACKS = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"] as const;
export const FONT_RANGES = ["0-255", "256-511", "768-1023", "7936-8191", "8192-8447", "9472-9727"] as const;
export const SPRITE_FILES = ["light.json", "light.png", "light@2x.json", "light@2x.png"] as const;

export type MapSource = { fetch?: typeof fetch; now?: () => number };

const TILES_PATH = "syros.pmtiles";
const CURRENT_TTL_MS = 60 * 60 * 1000;
const FALLBACK_TTL_MS = 60 * 1000;
const CURRENT_TIMEOUT_MS = 5_000;
const FILE_TIMEOUT_MS = 30_000;

/**
 * The host path of a map file, or null for anything that isn't one of ours.
 * Callers pass URL params as they are (already decoded once); each value must
 * match the lists exactly, so traversal, other stacks, `%2F` and `.pbf`
 * suffixes are all refused.
 *   mapFilePath("tiles")                        -> "syros.pmtiles"
 *   mapFilePath("font", stack, range)           -> "fonts-app/<stack>/<range>.pbf"
 *   mapFilePath("sprite", file)                 -> "sprites/<file>"
 */
export function mapFilePath(kind: "tiles"): string;
export function mapFilePath(kind: "font", stack: string, range: string): string | null;
export function mapFilePath(kind: "sprite", file: string): string | null;
export function mapFilePath(kind: string, a?: string, b?: string): string | null {
  if (kind === "tiles") return TILES_PATH;
  if (kind === "font") {
    if (!(FONT_STACKS as readonly string[]).includes(a as string)) return null;
    if (!(FONT_RANGES as readonly string[]).includes(b as string)) return null;
    return `fonts-app/${a}/${b}.pbf`;
  }
  if (kind === "sprite") {
    if (!(SPRITE_FILES as readonly string[]).includes(a as string)) return null;
    return `sprites/${a}`;
  }
  return null;
}

const KNOWN_PATHS: ReadonlySet<string> = new Set([
  TILES_PATH,
  ...FONT_STACKS.flatMap((s) => FONT_RANGES.map((r) => `fonts-app/${s}/${r}.pbf`)),
  ...SPRITE_FILES.map((f) => `sprites/${f}`),
]);

type Manifest = Map<string, { bytes: number; sha256: string }>;

let currentCache: { version: number; expires: number } | null = null;
let memory: { version: number; files: Map<string, Buffer> } | null = null;
const manifests = new Map<number, Manifest>();
const inflight = new Map<string, Promise<Buffer | null>>();

/** Clears everything held in memory (tests only). */
export function _resetMapDataForTests(): void {
  currentCache = null;
  memory = null;
  manifests.clear();
  inflight.clear();
}

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

async function newestStoredVersion(): Promise<number | null> {
  const [row] = await db
    .select({ version: mapDataFilesTable.version })
    .from(mapDataFilesTable)
    .orderBy(desc(mapDataFilesTable.version))
    .limit(1);
  return row?.version ?? null;
}

export async function currentMapVersion(src: MapSource = {}): Promise<number> {
  const now = (src.now ?? Date.now)();
  if (currentCache && now < currentCache.expires) return currentCache.version;
  const doFetch = src.fetch ?? fetch;
  try {
    const res = await doFetch(`${MAP_HOST}/current.json`, { signal: AbortSignal.timeout(CURRENT_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = (await res.json()) as { version?: unknown };
    const v = body.version;
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) throw new Error("bad version");
    currentCache = { version: v, expires: now + CURRENT_TTL_MS };
    return v;
  } catch (err) {
    logger.warn({ reason: err instanceof Error ? err.message : "failed" }, "map current.json unavailable");
    let v = MAP_FALLBACK_VERSION;
    try {
      v = (await newestStoredVersion()) ?? MAP_FALLBACK_VERSION;
    } catch {
      /* keep the fallback */
    }
    // Remember the fallback briefly so a dead host doesn't cost 5 s a request.
    currentCache = { version: v, expires: now + FALLBACK_TTL_MS };
    return v;
  }
}

async function loadManifest(version: number, doFetch: typeof fetch): Promise<Manifest | null> {
  const known = manifests.get(version);
  if (known) return known;
  const res = await doFetch(`${MAP_HOST}/v${version}/manifest.json`, {
    signal: AbortSignal.timeout(CURRENT_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { files?: Record<string, { bytes?: unknown; sha256?: unknown }> };
  const m: Manifest = new Map();
  for (const [p, e] of Object.entries(body.files ?? {})) {
    if (typeof e?.bytes === "number" && typeof e.sha256 === "string") {
      m.set(p, { bytes: e.bytes, sha256: e.sha256.toLowerCase() });
    }
  }
  manifests.set(version, m);
  // Only a few versions are ever asked for; don't let the map grow.
  while (manifests.size > 4) manifests.delete(manifests.keys().next().value as number);
  return m;
}

async function fetchAndStore(version: number, path: string, current: number, doFetch: typeof fetch): Promise<Buffer | null> {
  const manifest = await loadManifest(version, doFetch);
  const want = manifest?.get(path);
  if (!want) {
    logger.warn({ version, path }, "map file not in manifest");
    return null;
  }
  const res = await doFetch(`${MAP_HOST}/v${version}/${encodePath(path)}`, {
    signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
  });
  if (!res.ok) {
    logger.warn({ version, path, status: res.status }, "map file fetch failed");
    return null;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== want.bytes || sha256 !== want.sha256) {
    logger.warn({ version, path }, "map file failed its manifest check");
    return null;
  }
  // Older than current - 1 is served but never kept.
  if (version < current - 1) return bytes;
  await db
    .insert(mapDataFilesTable)
    .values({ version, path, bytes, sha256, size: bytes.length })
    .onConflictDoNothing();
  await db
    .delete(mapDataFilesTable)
    .where(lt(mapDataFilesTable.version, current - 1));
  return bytes;
}

export async function getMapFile(version: number, path: string, src: MapSource = {}): Promise<Buffer | null> {
  if (!Number.isInteger(version) || version <= 0 || !KNOWN_PATHS.has(path)) return null;
  try {
    const doFetch = src.fetch ?? fetch;
    const current = await currentMapVersion(src);
    if (version > current) return null;

    if (memory && memory.version !== current) memory = null;
    if (version === current) {
      const hit = memory?.files.get(path);
      if (hit) return hit;
    }

    const [row] = await db
      .select({ bytes: mapDataFilesTable.bytes })
      .from(mapDataFilesTable)
      .where(and(eq(mapDataFilesTable.version, version), eq(mapDataFilesTable.path, path)));
    if (row) {
      if (version === current) remember(current, path, row.bytes);
      return row.bytes;
    }

    const key = `${version}/${path}`;
    let p = inflight.get(key);
    if (!p) {
      p = fetchAndStore(version, path, current, doFetch)
        .catch((err) => {
          logger.warn({ version, path, reason: err instanceof Error ? err.message : "failed" }, "map file unavailable");
          return null;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const bytes = await p;
    if (bytes && version === current) remember(current, path, bytes);
    return bytes;
  } catch (err) {
    logger.warn({ version, path, reason: err instanceof Error ? err.message : "failed" }, "map file lookup failed");
    return null;
  }
}

function remember(version: number, path: string, bytes: Buffer): void {
  if (!memory || memory.version !== version) memory = { version, files: new Map() };
  memory.files.set(path, bytes);
}
