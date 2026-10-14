import { describe, expect, it } from "vitest";
import { mintTileToken, readTileToken, TOKEN_RE } from "./tileToken";

// SYC-209 PR 3.1, plan K13: a map picture's address is an encrypted,
// authenticated, short-lived token, never z/x/y.

const KEY_A = "vitest-tiles-key-A-0123456789abcdef-0123456789";
const KEY_B = "vitest-tiles-key-B-0123456789abcdef-0123456789";
const env = (keys: string) => ({ TEAM_SESSION_KEYS: keys }) as NodeJS.ProcessEnv;
const NOW = 1_792_000_000; // an hour boundary plus some
const tile = { z: 17, x: 74230, y: 50478, size: 179 as const };

describe("the map picture token", () => {
  it("reads back the picture it was made for", () => {
    const t = mintTileToken(tile, NOW, env(KEY_A));
    expect(t).toMatch(TOKEN_RE);
    expect(readTileToken(t, NOW, env(KEY_A))).toEqual(tile);
  });

  it("holds no z, x or y a reader could see", () => {
    const t = mintTileToken(tile, NOW, env(KEY_A));
    for (const n of [tile.x, tile.y]) expect(t).not.toContain(String(n));
    // Neither the raw numbers' bytes.
    const raw = Buffer.from(t, "base64url");
    const x = Buffer.alloc(4);
    x.writeUInt32BE(tile.x);
    expect(raw.includes(x)).toBe(false);
  });

  it("is the same within the hour (so the browser's private cache works) and different for another picture or size", () => {
    const a = mintTileToken(tile, NOW, env(KEY_A));
    expect(mintTileToken(tile, NOW + 60, env(KEY_A))).toBe(a);
    expect(mintTileToken({ ...tile, x: tile.x + 1 }, NOW, env(KEY_A))).not.toBe(a);
    expect(mintTileToken({ ...tile, size: 171 }, NOW, env(KEY_A))).not.toBe(a);
    expect(mintTileToken(tile, NOW + 3600, env(KEY_A))).not.toBe(a);
  });

  it("stops working after a day and an hour at most, and is never valid for less than a day", () => {
    const t = mintTileToken(tile, NOW, env(KEY_A));
    expect(readTileToken(t, NOW + 24 * 3600, env(KEY_A))).toEqual(tile);
    expect(readTileToken(t, NOW + 25 * 3600, env(KEY_A))).toBeNull();
  });

  it("refuses an altered token, one made with another key, and anything that isn't a token", () => {
    const t = mintTileToken(tile, NOW, env(KEY_A));
    for (let i = 0; i < t.length; i += 7) {
      const flipped = t.slice(0, i) + (t[i] === "A" ? "B" : "A") + t.slice(i + 1);
      expect(readTileToken(flipped, NOW, env(KEY_A)), `char ${i}`).toBeNull();
    }
    expect(readTileToken(t, NOW, env(KEY_B))).toBeNull();
    for (const bad of [undefined, 17, "", "17/74230/50478.png", "17%zz", t + "A", t.slice(1)])
      expect(readTileToken(bad, NOW, env(KEY_A))).toBeNull();
    expect(readTileToken(t, NOW, {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("accepts either key during a session-key change, and makes new tokens with the first", () => {
    const old = mintTileToken(tile, NOW, env(KEY_A));
    expect(readTileToken(old, NOW, env(`${KEY_B},${KEY_A}`))).toEqual(tile);
    const fresh = mintTileToken(tile, NOW, env(`${KEY_B},${KEY_A}`));
    expect(readTileToken(fresh, NOW, env(KEY_B))).toEqual(tile);
  });

  it("can't be made without a session key", () => {
    expect(() => mintTileToken(tile, NOW, {} as NodeJS.ProcessEnv)).toThrow();
  });
});
