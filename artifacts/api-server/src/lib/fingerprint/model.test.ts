import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DIMENSIONS, FingerprintUnavailable, MODEL_ID, fingerprintOf, resetModelForTests } from "./model";

// SYC-527 piece 3, Task 5: the looks-like model. Runs the real DINOv2 file
// from artifacts/api-server/models/, so these are slower than most tests
// (the model loads once, then each photo takes well under a second).

/** A 640 px picture with real structure (stripes, a disc, a gradient), so it has features to tell apart. */
async function picture(kind: "stripes" | "disc"): Promise<Buffer> {
  const w = 640;
  const h = 480;
  const svg =
    kind === "stripes"
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
           <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d98a2b"/><stop offset="1" stop-color="#3a2a1a"/></linearGradient></defs>
           <rect width="${w}" height="${h}" fill="url(#g)"/>
           ${Array.from({ length: 12 }, (_, i) => `<rect x="${i * 56}" y="0" width="22" height="${h}" fill="#1b1b1b" opacity="0.7"/>`).join("")}
           <ellipse cx="200" cy="300" rx="90" ry="60" fill="#f2e6d0"/>
         </svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
           <rect width="${w}" height="${h}" fill="#9ec7e8"/>
           <rect y="330" width="${w}" height="150" fill="#4f7d3a"/>
           <circle cx="420" cy="200" r="120" fill="#f5f5f5"/>
           <circle cx="380" cy="170" r="14" fill="#111"/><circle cx="460" cy="170" r="14" fill="#111"/>
           <polygon points="330,110 360,40 395,100" fill="#f5f5f5"/><polygon points="445,100 480,40 510,110" fill="#f5f5f5"/>
         </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, v, i) => s + v * b[i]!, 0);

afterEach(() => {
  vi.unstubAllGlobals();
  resetModelForTests();
});

describe("fingerprintOf", () => {
  it("returns 384 numbers of length 1", async () => {
    expect(MODEL_ID).toBe("dinov2-small-q8/v1");
    expect(DIMENSIONS).toBe(384);
    const v = await fingerprintOf(await picture("stripes"));
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(384);
    expect(Math.sqrt(dot(v, v))).toBeCloseTo(1, 5);
  });

  it("gives the same numbers for the same photo twice", async () => {
    const jpeg = await picture("stripes");
    const a = await fingerprintOf(jpeg);
    const b = await fingerprintOf(jpeg);
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it("puts a photo closer to a slightly resized copy than to a different photo", async () => {
    const original = await picture("stripes");
    const resized = await sharp(original).resize(576).jpeg({ quality: 85 }).toBuffer();
    const other = await picture("disc");
    const [a, b, c] = [await fingerprintOf(original), await fingerprintOf(resized), await fingerprintOf(other)];
    const sameish = dot(a, b);
    const different = dot(a, c);
    expect(sameish).toBeGreaterThan(different);
    expect(sameish).toBeGreaterThan(0.9);
  });

  it("throws FingerprintUnavailable, and makes no network request, when the model can't be loaded", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network used");
    });
    vi.stubGlobal("fetch", fetchSpy);
    resetModelForTests("/nonexistent/models-folder");
    await expect(fingerprintOf(await picture("disc"))).rejects.toBeInstanceOf(FingerprintUnavailable);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("tries again after a failed load rather than remembering the failure", async () => {
    resetModelForTests("/nonexistent/models-folder");
    const jpeg = await picture("disc");
    await expect(fingerprintOf(jpeg)).rejects.toBeInstanceOf(FingerprintUnavailable);
    resetModelForTests(); // the real folder again; a failed load must not have been cached
    expect((await fingerprintOf(jpeg)).length).toBe(384);
  });
});
