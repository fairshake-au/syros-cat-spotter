import { readTileToken } from "../lib/mapTiles/tileToken";

// The K13 scans (no coordinate or z/x/y in any href, action, src or
// redirect) look for digit-dash-digit runs. Two kinds of address are opaque
// by design and can contain such runs by chance: a photo's uuid, and a map
// picture's signed token (base64url, which uses "-"; SYC-425). An address is
// set aside only if it is exactly one of those, and a tile token only if this
// server's key actually signed it, so a coordinate can't hide behind the shape.
const PHOTO = /^\/api\/(team\/)?photos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TILE = /^\/api\/team\/map-tiles\/([A-Za-z0-9_-]+)$/;

export function isOpaqueAddress(v: string): boolean {
  if (PHOTO.test(v)) return true;
  const tile = TILE.exec(v);
  return tile !== null && readTileToken(tile[1]) !== null;
}
