import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { validatePhotoBase64 } from "./imageValidation";

const MAX_STORED_BYTES = 5 * 1024 * 1024;

/** Random noise resists compression, so we can build genuinely huge files. */
function noiseRaw(width: number, height: number): Buffer {
  const buf = Buffer.allocUnsafe(width * height * 3);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 2654435761) % 256;
  return buf;
}

async function bigPng(width = 2400, height = 1800): Promise<Buffer> {
  return sharp(noiseRaw(width, height), {
    raw: { width, height, channels: 3 },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();
}

async function bigJpeg(width = 2800, height = 2100): Promise<Buffer> {
  return sharp(noiseRaw(width, height), {
    raw: { width, height, channels: 3 },
  })
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

describe("validatePhotoBase64", () => {
  it("accepts an oversized valid PNG and stores it as JPEG under 5 MB", async () => {
    const png = await bigPng();
    expect(png.length).toBeGreaterThan(MAX_STORED_BYTES); // premise: input really is >5 MB

    const result = await validatePhotoBase64(png.toString("base64"));
    if ("error" in result) throw new Error(`unexpected rejection: ${result.error}`);

    expect(result.mime).toBe("image/jpeg");
    expect(result.buffer.length).toBeLessThanOrEqual(MAX_STORED_BYTES);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(2048);
  }, 60000);

  it("accepts an oversized valid JPEG and stores it as JPEG under 5 MB", async () => {
    const jpeg = await bigJpeg();
    expect(jpeg.length).toBeGreaterThan(MAX_STORED_BYTES);

    const result = await validatePhotoBase64(jpeg.toString("base64"));
    if ("error" in result) throw new Error(`unexpected rejection: ${result.error}`);

    expect(result.buffer.length).toBeLessThanOrEqual(MAX_STORED_BYTES);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(2048);
  }, 60000);

  it("rejects a corrupt file that passes the JPEG magic-byte check", async () => {
    const fake = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.from("not really a jpeg body".repeat(100)),
    ]);
    const result = await validatePhotoBase64(fake.toString("base64"));
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/corrupt/i);
  });

  it("rejects a truncated but real JPEG", async () => {
    const jpeg = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#888" },
    })
      .jpeg()
      .toBuffer();
    const truncated = jpeg.subarray(0, Math.floor(jpeg.length / 4));
    const result = await validatePhotoBase64(truncated.toString("base64"));
    expect(result).toHaveProperty("error");
  });

  it("rejects invalid base64", async () => {
    const result = await validatePhotoBase64("this is *not* base64!!!");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/base64/i);
  });

  it("rejects an empty string", async () => {
    const result = await validatePhotoBase64("");
    expect(result).toHaveProperty("error");
  });

  it("rejects inputs above the 20 MB ceiling without decoding them", async () => {
    // A base64 string longer than the pre-check threshold; content irrelevant.
    const huge = "A".repeat(((20 * 1024 * 1024 * 4) / 3 + 1024) | 0);
    const result = await validatePhotoBase64(huge);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/too large/i);
  });

  it("rejects non-JPEG/PNG formats (GIF)", async () => {
    const gif = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "#f00" },
    })
      .gif()
      .toBuffer();
    const result = await validatePhotoBase64(gif.toString("base64"));
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/format/i);
  });

  it("tolerates a data URI prefix", async () => {
    const jpeg = await sharp({
      create: { width: 20, height: 10, channels: 3, background: "#0f0" },
    })
      .jpeg()
      .toBuffer();
    const result = await validatePhotoBase64(
      `data:image/jpeg;base64,${jpeg.toString("base64")}`,
    );
    expect(result).not.toHaveProperty("error");
  });

  it("applies EXIF orientation so stored pixels are upright", async () => {
    // 640x480 landscape tagged with orientation 6 (rotate 90 CW) — cameras
    // held in portrait produce exactly this. After normalization the stored
    // image must be physically portrait (480x640) with no orientation tag.
    const tagged = await sharp({
      create: { width: 640, height: 480, channels: 3, background: "#00f" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const result = await validatePhotoBase64(tagged.toString("base64"));
    if ("error" in result) throw new Error(`unexpected rejection: ${result.error}`);

    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(480);
    expect(meta.height).toBe(640);
    expect(meta.orientation ?? 1).toBe(1);
  });
});
