import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
} from "node:crypto";
import { sessionKeys } from "../teamAuth/config";
import { isTileSize, type Tile, type TileSize } from "./geometry";

// Map picture addresses (SYC-209 PR 3.1, plan K13). A tile's z/x/y pins a
// spot on Syros to about 75 m at the closest zoom, and a team page asks for
// the picture around a private feeding site whenever it opens. So the
// address a browser asks for never holds z/x/y: it holds this token, an
// encrypted, authenticated reference to one map picture (the 2×2 tiles of a
// view: zoom, top-left tile, and the size each tile is drawn at) that stops
// working after about a day. The address then says nothing about a position
// to anyone who sees it: the hosting provider's edge logs, the browser's
// history, or our own logs (which redact it as well, SYC-255).
//
// AES-256-GCM over one 16-byte block. The nonce is an HMAC of that block
// (a synthetic nonce, as in SIV), so the same picture in the same hour has
// the same address and the browser's private cache works; a nonce repeats
// only for an identical block, which is the one case where that is safe.
// Both keys are derived from the dashboard's session key (TEAM_SESSION_KEYS),
// so there is no new secret to set; during a session-key change either key
// is accepted, as for sessions.

const VERSION = 1;
const BLOCK = 16;
const NONCE = 12;
const TAG = 16;
/** base64url of nonce + block + tag (44 bytes). */
export const TOKEN_RE = /^[A-Za-z0-9_-]{59}$/;

/** A token lasts from 24 to 25 hours: until the end of the hour a day from now. */
const HOUR = 3600;
const LIFETIME_HOURS = 25;

/** One map picture: the view's zoom and top-left tile, and its tile size. */
export interface PictureRef extends Tile {
  size: TileSize;
}

interface Keys {
  enc: Buffer;
  nonce: Buffer;
}

function derive(secret: Buffer): Keys {
  const salt = Buffer.from("syc-209 map tiles");
  return {
    enc: Buffer.from(hkdfSync("sha256", secret, salt, "tile token: encryption v1", 32)),
    nonce: Buffer.from(hkdfSync("sha256", secret, salt, "tile token: nonce v1", 32)),
  };
}

function keys(env: NodeJS.ProcessEnv): Keys[] | null {
  const secrets = sessionKeys(env);
  return secrets ? secrets.map(derive) : null;
}

function pack(ref: PictureRef, exp: number): Buffer {
  const b = Buffer.alloc(BLOCK);
  b.writeUInt8(VERSION, 0);
  b.writeUInt8(ref.z, 1);
  b.writeUInt32BE(ref.x, 2);
  b.writeUInt32BE(ref.y, 6);
  b.writeUInt16BE(ref.size, 10);
  b.writeUInt32BE(exp, 12);
  return b;
}

/**
 * The address token for one map picture. Throws when the dashboard has no
 * session key (nobody can be signed in then, so no page is drawn).
 */
export function mintTileToken(
  ref: PictureRef,
  nowSeconds = Math.floor(Date.now() / 1000),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const k = keys(env)?.[0];
  if (!k) throw new Error("mintTileToken: TEAM_SESSION_KEYS is not set");
  const exp = (Math.floor(nowSeconds / HOUR) + LIFETIME_HOURS) * HOUR;
  const block = pack(ref, exp);
  const nonce = createHmac("sha256", k.nonce).update(block).digest().subarray(0, NONCE);
  const cipher = createCipheriv("aes-256-gcm", k.enc, nonce);
  const body = Buffer.concat([cipher.update(block), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64url");
}

/**
 * The picture a token stands for, or null for anything else: malformed,
 * altered, made with another key, expired, or naming a size the map never
 * draws. One null for all of them, so a refusal says nothing about why.
 */
export function readTileToken(
  token: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
  env: NodeJS.ProcessEnv = process.env,
): PictureRef | null {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const raw = Buffer.from(token, "base64url");
  if (raw.length !== NONCE + BLOCK + TAG) return null;
  // One spelling per token: base64url's last character has two spare bits
  // a decoder ignores, so without this a token would have four addresses.
  if (raw.toString("base64url") !== token) return null;
  const nonce = raw.subarray(0, NONCE);
  const body = raw.subarray(NONCE, NONCE + BLOCK);
  const tag = raw.subarray(NONCE + BLOCK);
  for (const k of keys(env) ?? []) {
    let block: Buffer;
    try {
      const d = createDecipheriv("aes-256-gcm", k.enc, nonce);
      d.setAuthTag(tag);
      block = Buffer.concat([d.update(body), d.final()]);
    } catch {
      continue; // not this key, or altered
    }
    if (block.readUInt8(0) !== VERSION) return null;
    const exp = block.readUInt32BE(12);
    // Expired, or further ahead than any token this server makes.
    if (exp <= nowSeconds || exp > nowSeconds + (LIFETIME_HOURS + 1) * HOUR) return null;
    const size = block.readUInt16BE(10);
    if (!isTileSize(size)) return null;
    return {
      z: block.readUInt8(1),
      x: block.readUInt32BE(2),
      y: block.readUInt32BE(6),
      size,
    };
  }
  return null;
}
