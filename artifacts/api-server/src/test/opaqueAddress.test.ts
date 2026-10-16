import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mintTileToken } from "../lib/mapTiles/tileToken";
import { isOpaqueAddress } from "./opaqueAddress";

// SYC-425: the K13 scans set aside a photo uuid and a map picture's signed
// token, and nothing else.

const KEY = "vitest-opaqueaddress-key-0123456789abcdef-0123";
let saved: string | undefined;

beforeAll(() => {
  saved = process.env["TEAM_SESSION_KEYS"];
  process.env["TEAM_SESSION_KEYS"] = KEY;
});
afterAll(() => {
  if (saved === undefined) delete process.env["TEAM_SESSION_KEYS"];
  else process.env["TEAM_SESSION_KEYS"] = saved;
});

describe("isOpaqueAddress", () => {
  it("sets aside a map picture this server signed, whatever its letters", () => {
    for (let x = 0; x < 50; x++) {
      const token = mintTileToken({ z: 16, x: 37000 + x, y: 25000, size: 179 });
      expect(isOpaqueAddress(`/api/team/map-tiles/${token}`)).toBe(true);
    }
  });

  it("does not set aside a signed token that was changed by one character", () => {
    const token = mintTileToken({ z: 16, x: 37012, y: 25011, size: 179 });
    const flipped = token.slice(0, 10) + (token[10] === "A" ? "B" : "A") + token.slice(11);
    expect(isOpaqueAddress(`/api/team/map-tiles/${token}`)).toBe(true);
    expect(isOpaqueAddress(`/api/team/map-tiles/${flipped}`)).toBe(false);
    expect(isOpaqueAddress(`/api/team/map-tiles/${token}?lat=37.4`)).toBe(false);
  });

  it("sets aside a photo's uuid address", () => {
    expect(isOpaqueAddress("/api/team/photos/0b5c3e1a-12ab-4cde-8f90-1234567890ab")).toBe(true);
    expect(isOpaqueAddress("/api/photos/0b5c3e1a-12ab-4cde-8f90-1234567890ab")).toBe(true);
  });

  it("does not set aside a map address carrying numbers it didn't sign", () => {
    for (const v of [
      "/api/team/map-tiles/16-37012-25011",
      "/api/team/map-tiles/16/37012/25011",
      "/api/team/map-tiles/37-4468-24-9453",
      "/api/team/map-tiles/AAAA-10-7Do",
      "/api/team/map-tiles/16-37012-25011?x=1",
    ]) {
      expect(isOpaqueAddress(v), v).toBe(false);
    }
  });

  it("does not set aside any other address", () => {
    for (const v of [
      "/api/team/sites/12",
      "/api/team/photos/12-34-56",
      "https://www.google.com/maps?q=37.4468,24.9453",
      "/api/team/sites/map#map",
    ]) {
      expect(isOpaqueAddress(v), v).toBe(false);
    }
  });
});
