import sharp from "sharp";
import { and, eq, sql } from "drizzle-orm";
import { db, mapTileCacheTable } from "@workspace/db";
import { GRID, isTileAllowed, isViewAllowed, viewTiles, type Tile, type View } from "./geometry";

// Where the team map's pictures come from (SYC-209 PR 3.1; spec §11.4).
// Each OpenStreetMap tile is fetched once by the server, kept in
// `map_tile_cache`, and sent from the dashboard's own address, so a browser
// never talks to a map company and the security header stays as it is.
//
// OpenStreetMap's tile policy allows light, cached use with a real
// identifying User-Agent. A few team members a few times a week is light;
// the cap and the island box below keep it so. SYC-288 replaces this with
// our own island tile set, so the provider sees nothing at all.
//
// Nothing here logs a tile's z/x/y, and nothing here throws a message that
// holds one: the request logger and safeError only ever see a fixed reason.

export const OSM_TILE_URL = (t: Tile) =>
  `https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`;

/** The first outbound fetch in the repository to say who it is (OSM policy). */
export const USER_AGENT =
  "SyrosCatSpotters-TeamMap/1.0 (+https://catspotters.com; Syros Cats charity, staff map)";

export const FETCH_TIMEOUT_MS = 10_000;
/** The whole cache: oldest fetched out first above this. */
export const CACHE_CAP_BYTES = 200 * 1024 * 1024;
/** A picture older than this is fetched again (the old one is kept if that fails). */
export const REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
/** A real OSM tile is a few tens of kB; anything this big is not one. */
const MAX_TILE_BYTES = 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type Fetcher = typeof fetch;

/** Fetch one tile from OpenStreetMap, or null for any failure. */
async function fetchTile(t: Tile, fetcher: Fetcher): Promise<Buffer | null> {
  try {
    const res = await fetcher(OSM_TILE_URL(t), {
      headers: { "User-Agent": USER_AGENT, Accept: "image/png" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "error",
    });
    if (res.status !== 200) return null;
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_TILE_BYTES) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_TILE_BYTES) return null;
    if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;
    // A whole, decodable 256 px PNG, or it isn't kept for 30 days.
    const meta = await sharp(bytes, { failOn: "error" }).metadata();
    if (meta.format !== "png" || meta.width !== 256 || meta.height !== 256) return null;
    await sharp(bytes, { failOn: "error" }).raw().toBuffer();
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Drop the oldest pictures until the cache is under `cap` bytes. Newest
 * first, a running total; every row past the cap goes.
 */
export async function trimTileCache(cap = CACHE_CAP_BYTES): Promise<void> {
  await db.execute(sql`
    delete from map_tile_cache c
    using (
      select z, x, y,
             sum(size) over (order by fetched_at desc, z desc, x desc, y desc) as running
      from map_tile_cache
    ) r
    where c.z = r.z and c.x = r.x and c.y = r.y and r.running > ${cap}
  `);
}

export interface TileSource {
  fetcher?: Fetcher;
  now?: () => Date;
  cap?: number;
}

/**
 * Fetches under way, by tile. A page asks for its picture at five sizes at
 * once (one per screen-width band), so without this one new tile would be
 * fetched five times. One server process, one fetch per tile at a time.
 */
const inFlight = new Map<string, Promise<Buffer | null>>();

/** Fetch one tile and store it. Null if the provider failed. */
function fetchAndStore(t: Tile, src: TileSource): Promise<Buffer | null> {
  const key = `${t.z}/${t.x}/${t.y}`;
  const running = inFlight.get(key);
  if (running) return running;
  const job = (async () => {
    const fresh = await fetchTile(t, src.fetcher ?? fetch);
    if (!fresh) return null;
    const now = (src.now ?? (() => new Date()))();
    await db
      .insert(mapTileCacheTable)
      .values({ ...t, bytes: fresh, size: fresh.length, fetchedAt: now })
      .onConflictDoUpdate({
        target: [mapTileCacheTable.z, mapTileCacheTable.x, mapTileCacheTable.y],
        set: { bytes: fresh, size: fresh.length, fetchedAt: now },
      });
    await trimTileCache(src.cap ?? CACHE_CAP_BYTES);
    return fresh;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

/** For tests: wait for every fetch under way to finish. */
export async function tileFetchesSettled(): Promise<void> {
  await Promise.allSettled([...inFlight.values()]);
}

/**
 * The 256 px picture for one tile: from the cache, or fetched once and
 * cached. Null when it can't be had (outside Syros or zooms 12–19, which is
 * refused before anything is fetched; or the provider failed and nothing is
 * cached). A picture past its 30 days is sent as it is, and fetched again
 * behind it (kept as it is if that fails), so a slow provider never holds up
 * a picture we already have.
 */
export async function getTilePng(t: Tile, src: TileSource = {}): Promise<Buffer | null> {
  if (!isTileAllowed(t)) return null;
  const now = (src.now ?? (() => new Date()))();
  const where = and(
    eq(mapTileCacheTable.z, t.z),
    eq(mapTileCacheTable.x, t.x),
    eq(mapTileCacheTable.y, t.y),
  );
  const [cached] = await db
    .select({ bytes: mapTileCacheTable.bytes, fetchedAt: mapTileCacheTable.fetchedAt })
    .from(mapTileCacheTable)
    .where(where);
  if (cached) {
    if (now.getTime() - cached.fetchedAt.getTime() >= REFRESH_AFTER_MS) {
      void fetchAndStore(t, src).catch(() => undefined);
    }
    return cached.bytes;
  }
  return fetchAndStore(t, src);
}

const BLANK = { r: 220, g: 216, b: 204 };

/**
 * One band's map picture (plan K4: "one mosaic per width band"): the view's
 * 2×2 tiles joined into one picture at exactly the size it is drawn,
 * 2 × size square. One picture, not four, so a tap never lands on a seam
 * between pictures (where a phone browser's touch adjustment moves it).
 *
 * Null when the view isn't on Syros at zooms 12–19 (refused before anything
 * is fetched) or no tile at all could be had. A tile that can't be had is
 * left blank, so the rest of the map still shows.
 */
export async function mosaicPicture(
  view: View,
  size: number,
  src: TileSource = {},
): Promise<Buffer | null> {
  if (!isViewAllowed(view)) return null;
  const tiles = viewTiles(view);
  const pngs = await Promise.all(tiles.map((t) => getTilePng(t, src)));
  if (pngs.every((p) => !p)) return null;
  const full = 256 * GRID;
  const joined = sharp({
    create: { width: full, height: full, channels: 3, background: BLANK },
  }).composite(
    pngs.flatMap((png, i) =>
      png ? [{ input: png, left: (i % GRID) * 256, top: Math.floor(i / GRID) * 256 }] : [],
    ),
  );
  const span = size * GRID;
  if (span === full) return joined.png({ compressionLevel: 6 }).toBuffer();
  // sharp resizes after compositing only from a finished image.
  const flat = await joined.png().toBuffer();
  return sharp(flat)
    .resize(span, span, { fit: "fill", kernel: "lanczos3" })
    .png({ compressionLevel: 6 })
    .toBuffer();
}
