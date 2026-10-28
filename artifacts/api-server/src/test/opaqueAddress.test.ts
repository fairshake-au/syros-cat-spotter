import { describe, expect, it } from "vitest";
import { isOpaqueAddress } from "./opaqueAddress";

// SYC-425: the K13 scans set aside a photo uuid, and nothing else.

describe("isOpaqueAddress", () => {
  it("sets aside a photo's uuid address", () => {
    expect(isOpaqueAddress("/api/team/photos/0b5c3e1a-12ab-4cde-8f90-1234567890ab")).toBe(true);
    expect(isOpaqueAddress("/api/photos/0b5c3e1a-12ab-4cde-8f90-1234567890ab")).toBe(true);
  });

  it("does not set aside a map address carrying numbers", () => {
    for (const v of [
      "/api/team/map-tiles/16-37012-25011",
      "/api/team/map-tiles/16/37012/25011",
      "/api/team/map-tiles/37-4468-24-9453",
      "/api/team/map-tiles/AAAA-10-7Do",
      "/api/team/map-tiles/16-37012-25011?x=1",
      "/api/team/map-square/16-37012-25011",
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
