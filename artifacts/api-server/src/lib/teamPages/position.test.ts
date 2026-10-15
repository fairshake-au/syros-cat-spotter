import { describe, expect, it } from "vitest";
import { mapUrl, position, roundPos } from "./position";

describe("roundPos", () => {
  it("rounds to 5 places", () => {
    expect(roundPos(37.446999999999996)).toBe("37.44700");
    expect(roundPos(24.9)).toBe("24.90000");
  });
  it("handles negatives", () => {
    expect(roundPos(-33.8688197)).toBe("-33.86882");
  });
});

describe("mapUrl", () => {
  it("is exactly the Google search address with an encoded, rounded pair", () => {
    expect(mapUrl(37.446999999999996, 24.9)).toBe(
      "https://www.google.com/maps/search/?api=1&query=37.44700%2C24.90000",
    );
  });
  it("keeps the minus sign on negatives", () => {
    expect(mapUrl(-33.8688197, -151.2)).toBe(
      "https://www.google.com/maps/search/?api=1&query=-33.86882%2C-151.20000",
    );
  });
});

describe("position", () => {
  it("prints text only, no link, when not asked", () => {
    const html = position(37.446999999999996, 24.9, { link: false });
    expect(html).toBe("37.44700, 24.90000");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("google");
  });
  it("adds the link, with an escaped href and rel, when asked", () => {
    const html = position(37.446999999999996, 24.9, { link: true });
    expect(html).toBe(
      '37.44700, 24.90000 &middot; <a href="https://www.google.com/maps/search/?api=1&amp;query=37.44700%2C24.90000" rel="noopener noreferrer">Open map</a>',
    );
  });
  it("escapes the link: the & in the address is written &amp;", () => {
    const html = position(-1.5, -2.25, { link: true });
    expect(html).toContain("-1.50000, -2.25000");
    expect(html).toContain("?api=1&amp;query=");
    expect(html).not.toMatch(/\?api=1&query=/);
  });
});
