import sharp from "sharp";
import heicConvert from "heic-convert";

const MAX_STORED_BYTES = 5 * 1024 * 1024; // ~5 MB stored cap
// Absolute ceiling on what we will even attempt to decode. Anything bigger is
// almost certainly not a phone photo (and would blow past the JSON body limit
// anyway).
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
// Bound on the longest edge of a stored photo. Plenty for display and AI
// matching while keeping storage and token costs low.
const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 80;

export type ValidatedImage = {
  buffer: Buffer;
  mime: "image/jpeg" | "image/png";
};

export type ImageValidationError = { error: string };

type DetectedFormat = "jpeg" | "png" | "webp" | "heic";

function detectFormat(buf: Buffer): DetectedFormat | null {
  // JPEG: FF D8 FF
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return "jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length >= 8 && pngSig.every((b, i) => buf[i] === b)) {
    return "png";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  // HEIC/HEIF (ISO BMFF): box size + "ftyp" + a known HEIF brand.
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    const heifBrands = ["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1", "avif"];
    if (heifBrands.includes(brand)) {
      return "heic";
    }
  }
  return null;
}

async function normalizeToJpeg(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: "error" })
    .rotate() // apply EXIF orientation so stored pixels are upright
    .resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/**
 * Decodes, validates and normalizes a base64 photo upload before it is stored
 * or sent to the AI matcher.
 *
 * - Rejects malformed base64 and content that is not JPEG/PNG/HEIC/HEIF/WebP.
 * - Fully decodes the image (verifying it is a real image, not just correct
 *   magic bytes), bounds its dimensions to MAX_DIMENSION on the longest edge,
 *   and re-encodes it as JPEG. Oversized but valid photos are shrunk to fit
 *   under the 5 MB cap instead of being rejected.
 */
export async function validatePhotoBase64(
  photoBase64: string,
): Promise<ValidatedImage | ImageValidationError> {
  // Tolerate a data URI prefix, but strip it before decoding.
  const raw = photoBase64.replace(/^data:image\/[a-zA-Z+]+;base64,/, "").trim();

  if (raw.length === 0) {
    return { error: "photoBase64 is empty" };
  }
  // Fast pre-check: base64 inflates by ~4/3, so an absurdly oversized string
  // can be rejected without decoding it.
  if (raw.length > (MAX_INPUT_BYTES * 4) / 3 + 4) {
    return { error: "Image too large: uploads must be at most 20 MB" };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    return { error: "photoBase64 is not valid base64" };
  }

  const input = Buffer.from(raw, "base64");
  if (input.length === 0) {
    return { error: "photoBase64 is not valid base64" };
  }
  if (input.length > MAX_INPUT_BYTES) {
    return { error: "Image too large: uploads must be at most 20 MB" };
  }

  const format = detectFormat(input);
  if (!format) {
    return {
      error:
        "Unsupported image format: only JPEG, PNG, HEIC/HEIF, and WebP are accepted",
    };
  }

  // Normalize: fully decode (catches corrupt/truncated files that pass the
  // magic-byte check), bound dimensions, re-encode as JPEG.
  let buffer: Buffer;
  try {
    buffer = await normalizeToJpeg(input);
  } catch {
    if (format === "heic") {
      // sharp's bundled libvips cannot decode HEVC-compressed HEIC (the
      // default iPhone format). Fall back to a WASM decoder, then run the
      // decoded JPEG through the same normalization pipeline.
      try {
        const decoded = Buffer.from(
          await heicConvert({
            buffer: new Uint8Array(input),
            format: "JPEG",
            quality: 0.9,
          }),
        );
        buffer = await normalizeToJpeg(decoded);
      } catch {
        return { error: "Image could not be decoded: file appears corrupt" };
      }
    } else {
      return { error: "Image could not be decoded: file appears corrupt" };
    }
  }

  // Extremely unlikely after downscaling, but keep the storage cap hard:
  // re-encode at lower quality before giving up.
  if (buffer.length > MAX_STORED_BYTES) {
    try {
      buffer = await sharp(buffer)
        .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 60, mozjpeg: true })
        .toBuffer();
    } catch {
      return { error: "Image could not be processed" };
    }
    if (buffer.length > MAX_STORED_BYTES) {
      return { error: "Image too large: could not compress under 5 MB" };
    }
  }

  return { buffer, mime: "image/jpeg" };
}
