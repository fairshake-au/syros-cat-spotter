import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { validatePhotoBase64 } from "./imageValidation";

const FIXTURE_HEIC = path.join(__dirname, "__fixtures__", "sample-hevc.heic");

async function testPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 100,
      height: 80,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  })
    .png()
    .toBuffer();
}

describe("validatePhotoBase64 format support", () => {
  it("accepts WebP and normalizes to JPEG", async () => {
    const webp = await sharp(await testPng()).webp().toBuffer();
    const result = await validatePhotoBase64(webp.toString("base64"));
    expect(result).not.toHaveProperty("error");
    if (!("error" in result)) {
      expect(result.mime).toBe("image/jpeg");
      expect(result.buffer.subarray(0, 3)).toEqual(
        Buffer.from([0xff, 0xd8, 0xff]),
      );
    }
  });

  it("accepts AVIF (ftyp avif brand) and normalizes to JPEG", async () => {
    const avif = await sharp(await testPng())
      .heif({ compression: "av1" })
      .toBuffer();
    const result = await validatePhotoBase64(avif.toString("base64"));
    expect(result).not.toHaveProperty("error");
    if (!("error" in result)) {
      expect(result.mime).toBe("image/jpeg");
    }
  });

  it("accepts HEVC-compressed HEIC via the WASM fallback", async () => {
    const heic = fs.readFileSync(FIXTURE_HEIC);
    const result = await validatePhotoBase64(heic.toString("base64"));
    expect(result).not.toHaveProperty("error");
    if (!("error" in result)) {
      expect(result.mime).toBe("image/jpeg");
      expect(result.buffer.subarray(0, 3)).toEqual(
        Buffer.from([0xff, 0xd8, 0xff]),
      );
    }
  });

  it("rejects a truncated HEIC as corrupt", async () => {
    const truncated = fs.readFileSync(FIXTURE_HEIC).subarray(0, 5000);
    const result = await validatePhotoBase64(truncated.toString("base64"));
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toMatch(/corrupt/i);
    }
  });

  it("rejects non-image data with a clear unsupported-format error", async () => {
    const result = await validatePhotoBase64(
      Buffer.from("definitely not an image").toString("base64"),
    );
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toMatch(/Unsupported image format/);
    }
  });
});
