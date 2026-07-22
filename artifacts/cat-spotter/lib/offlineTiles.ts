import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Offline map tiles for Syros.
 *
 * On first launch (while online) the app downloads OpenStreetMap tiles
 * covering the whole island at zoom 11-15, plus zoom 16 detail around
 * Ermoupoli / Ano Syros. Once ready, all maps render from local files —
 * fast and fully usable with no signal.
 */

const READY_KEY = 'cat-spotter/offline-tiles-ready-v1';
const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// Whole island of Syros
const ISLAND = { minLat: 37.36, maxLat: 37.53, minLon: 24.85, maxLon: 25.01 };
// Ermoupoli + Ano Syros — where most cats (and people) are
const TOWN = { minLat: 37.42, maxLat: 37.47, minLon: 24.91, maxLon: 24.97 };

const ISLAND_ZOOMS = [11, 12, 13, 14, 15];
const TOWN_ZOOMS = [16];

export const TILES_DIR = `${FileSystem.documentDirectory ?? ''}tiles`;
export const LOCAL_TILE_TEMPLATE = `${TILES_DIR}/{z}/{x}/{y}.png`;
export const ONLINE_TILE_TEMPLATE = OSM_URL;
export const MAX_TILE_ZOOM = 16;

interface Tile {
  z: number;
  x: number;
  y: number;
}

function lonToX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

function latToY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z,
  );
}

function tilesForBbox(
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number },
  zooms: number[],
): Tile[] {
  const tiles: Tile[] = [];
  for (const z of zooms) {
    const x0 = lonToX(bbox.minLon, z);
    const x1 = lonToX(bbox.maxLon, z);
    const y0 = latToY(bbox.maxLat, z); // note: y grows southwards
    const y1 = latToY(bbox.minLat, z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

function allTiles(): Tile[] {
  const seen = new Set<string>();
  const result: Tile[] = [];
  for (const t of [
    ...tilesForBbox(ISLAND, ISLAND_ZOOMS),
    ...tilesForBbox(TOWN, TOWN_ZOOMS),
  ]) {
    const key = `${t.z}/${t.x}/${t.y}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(t);
    }
  }
  return result;
}

export interface TilesState {
  /** All tiles downloaded — maps can render fully offline. */
  ready: boolean;
  downloading: boolean;
  /** 0..1 while downloading. */
  progress: number;
}

type Listener = (state: TilesState) => void;

let state: TilesState = { ready: false, downloading: false, progress: 0 };
const listeners = new Set<Listener>();
let inFlight: Promise<void> | null = null;

function setState(next: Partial<TilesState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l(state));
}

async function downloadTiles(): Promise<void> {
  const tiles = allTiles();
  setState({ downloading: true, progress: 0 });
  let done = 0;
  let failed = 0;

  const dirs = new Set(tiles.map((t) => `${TILES_DIR}/${t.z}/${t.x}`));
  for (const dir of dirs) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(
      () => {},
    );
  }

  const queue = [...tiles];
  const worker = async () => {
    for (;;) {
      const tile = queue.shift();
      if (!tile) return;
      const path = `${TILES_DIR}/${tile.z}/${tile.x}/${tile.y}.png`;
      try {
        const info = await FileSystem.getInfoAsync(path);
        if (!info.exists || info.size === 0) {
          await FileSystem.downloadAsync(
            OSM_URL.replace('{z}', String(tile.z))
              .replace('{x}', String(tile.x))
              .replace('{y}', String(tile.y)),
            path,
          );
        }
      } catch {
        failed += 1;
      }
      done += 1;
      if (done % 10 === 0 || done === tiles.length) {
        setState({ progress: done / tiles.length });
      }
    }
  };

  // Modest concurrency to be polite to the OSM tile servers.
  await Promise.all([worker(), worker(), worker(), worker()]);

  if (failed === 0) {
    await AsyncStorage.setItem(READY_KEY, 'yes');
    setState({ ready: true, downloading: false, progress: 1 });
  } else {
    // Leave what we have on disk; retry completes the rest next launch.
    setState({ downloading: false });
  }
}

/**
 * Kick off the tile download if it has not completed yet. Safe to call often
 * (e.g. on every reconnect): a single in-flight run is shared, and a failed
 * or partial run can be re-attempted by calling again.
 */
export function ensureOfflineTiles(): Promise<void> {
  if (Platform.OS === 'web' || state.ready) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const flag = await AsyncStorage.getItem(READY_KEY);
      if (flag === 'yes') {
        setState({ ready: true, progress: 1 });
        return;
      }
      await downloadTiles();
    } catch {
      setState({ downloading: false });
    } finally {
      // Allow future calls to retry unless we finished successfully.
      inFlight = null;
    }
  })();
  return inFlight;
}

export function useOfflineTiles(): TilesState {
  const [current, setCurrent] = useState(state);
  useEffect(() => {
    const listener: Listener = (s) => setCurrent(s);
    listeners.add(listener);
    setCurrent(state);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return current;
}
