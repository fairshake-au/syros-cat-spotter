import { readSquareToken, readTileToken } from "../lib/mapTiles/tileToken";

// The K13 scans (no coordinate or z/x/y in any href, action, src or
// redirect) look for digit-dash-digit runs. Two kinds of address are opaque
// by design and can contain such runs by chance: a photo's uuid, and a map
// picture's signed token (base64url, which uses "-"; SYC-425). An address is
// set aside only if it is exactly one of those, and a tile token only if this
// server's key actually signed it, so a coordinate can't hide behind the shape.
const PHOTO = /^\/api\/(team\/)?photos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TILE = /^\/api\/team\/map-tiles\/([A-Za-z0-9_-]+)$/;
// SYC-396 PR 1.5: one island-map square, by its own (version 2) token.
const SQUARE = /^\/api\/team\/map-square\/([A-Za-z0-9_-]+)$/;

export function isOpaqueAddress(v: string): boolean {
  if (PHOTO.test(v)) return true;
  const tile = TILE.exec(v);
  if (tile !== null) return readTileToken(tile[1]) !== null;
  const square = SQUARE.exec(v);
  return square !== null && readSquareToken(square[1]) !== null;
}
