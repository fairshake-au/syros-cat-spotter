const MAX_DECODED_BYTES = 5 * 1024 * 1024; // ~5 MB decoded

export type ValidatedImage = {
  buffer: Buffer;
  mime: "image/jpeg" | "image/png";
};

export type ImageValidationError = { error: string };

function detectMime(buf: Buffer): ValidatedImage["mime"] | null {
  // JPEG: FF D8 FF
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length >= 8 && pngSig.every((b, i) => buf[i] === b)) {
    return "image/png";
  }
  return null;
}

/**
 * Decodes and validates a base64 photo upload before it is stored or sent to
 * the AI matcher. Rejects malformed base64, non-JPEG/PNG content, and images
 * larger than ~5 MB decoded.
 */
export function validatePhotoBase64(
  photoBase64: string,
): ValidatedImage | ImageValidationError {
  // Tolerate a data URI prefix, but strip it before decoding.
  const raw = photoBase64.replace(/^data:image\/[a-zA-Z+]+;base64,/, "").trim();

  if (raw.length === 0) {
    return { error: "photoBase64 is empty" };
  }
  // Fast pre-check: base64 inflates by ~4/3, so an obviously oversized string
  // can be rejected without decoding it.
  if (raw.length > (MAX_DECODED_BYTES * 4) / 3 + 4) {
    return { error: "Image too large: decoded size must be at most 5 MB" };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    return { error: "photoBase64 is not valid base64" };
  }

  const buffer = Buffer.from(raw, "base64");
  if (buffer.length === 0) {
    return { error: "photoBase64 is not valid base64" };
  }
  if (buffer.length > MAX_DECODED_BYTES) {
    return { error: "Image too large: decoded size must be at most 5 MB" };
  }

  const mime = detectMime(buffer);
  if (!mime) {
    return { error: "Unsupported image format: only JPEG and PNG are accepted" };
  }

  return { buffer, mime };
}
