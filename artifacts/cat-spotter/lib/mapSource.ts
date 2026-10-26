/**
 * SYC-705: the one place the website learns where our self-hosted Syros map
 * lives and which version of it is current. This is the map data host, not
 * our API, so it calls fetch directly (allow-listed in noStrayApiCallers).
 */
import { useEffect, useState } from 'react';

export const MAP_HOST = 'https://tiles.catspotters.com';
/** Used until current.json answers, and whenever it can't be read. */
export const MAP_FALLBACK_VERSION = 1;

const TIMEOUT_MS = 5000;

export function mapUrls(version: number): {
  pmtilesUrl: string;
  glyphsUrl: string;
  spriteUrl: string;
} {
  return {
    // The pmtiles:// prefix is how MapLibre's pmtiles protocol is invoked.
    pmtilesUrl: `pmtiles://${MAP_HOST}/v${version}/syros.pmtiles`,
    glyphsUrl: `${MAP_HOST}/v${version}/fonts/{fontstack}/{range}.pbf`,
    spriteUrl: `${MAP_HOST}/v${version}/sprites/light`,
  };
}

let versionPromise: Promise<number> | null = null;
/** The version once current.json has answered, so later maps start on it. */
let resolvedVersion: number | null = null;

function loadVersion(): Promise<number> {
  if (!versionPromise) {
    versionPromise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${MAP_HOST}/current.json`, { signal: controller.signal });
        if (!res.ok) return MAP_FALLBACK_VERSION;
        const body = (await res.json()) as { version?: unknown };
        const v = body?.version;
        return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : MAP_FALLBACK_VERSION;
      } catch {
        return MAP_FALLBACK_VERSION;
      } finally {
        clearTimeout(timer);
      }
    })().then((v) => {
      resolvedVersion = v;
      return v;
    });
  }
  return versionPromise;
}

/**
 * The fallback at once on the first map of a page load, then the current
 * version (one fetch per page load). Maps mounted after it has answered start
 * on it, so they are never built on the fallback and then swapped.
 */
export function useMapVersion(): number {
  const [version, setVersion] = useState(resolvedVersion ?? MAP_FALLBACK_VERSION);
  useEffect(() => {
    let live = true;
    void loadVersion().then((v) => {
      if (live) setVersion(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return version;
}

/** Test-only: forget the shared fetch so each test starts fresh. */
export function _resetMapVersionForTests(): void {
  versionPromise = null;
  resolvedVersion = null;
}
