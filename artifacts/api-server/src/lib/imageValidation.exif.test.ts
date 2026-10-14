import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

// hosting-and-photo-storage.md §6.4 / SYC-65: the location-privacy promise —
// a downloaded photo file must not carry the GPS coordinates of where it was
// taken — rests entirely on sharp's re-encode never calling withMetadata().
// That behaviour was verified correct but untested; §6.4 asks for a test
// asserting the output buffer has no GPS tags and no EXIF block at all, plus
// a second test through the HEIC fallback path.
//
// normalizeToJpeg() never calls .withMetadata(), so ANY input re-encoded by
// it comes out with no exif block whatsoever, not merely a GPS-scrubbed one.
// "No exif block" is a strictly stronger, easier-to-assert guarantee that
// implies "no GPS tags" — so that's what these tests check.

const FIXTURE_HEIC = path.join(__dirname, "__fixtures__", "sample-hevc.heic");

async function jpegWithGpsExif(): Promise<Buffer> {
  return sharp({
    create: { width: 640, height: 480, channels: 3, background: "#048" },
  })
    .jpeg()
    .withMetadata({
      exif: {
        IFD0: { Copyright: "vitest fixture" },
        GPS: {
          // Ermoupoli, Syros — the app's own location-blurring promise is
          // exactly what this test is guarding.
          GPSLatitudeRef: "N",
          GPSLatitude: "37/1 26/1 24/1",
          GPSLongitudeRef: "E",
          GPSLongitude: "24/1 56/1 0/1",
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    .toBuffer();
}

// SYC-260 (SYC-166 slice 0): photos edited in Apple Photos (including
// "Adjust Location") and in desktop editors can carry the position in an XMP
// packet rather than, or as well as, EXIF. The same re-encode must drop XMP.
async function jpegWithGpsXmp(): Promise<Buffer> {
  const xmp = [
    '<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:exif="http://ns.adobe.com/exif/1.0/"',
    ' exif:GPSLatitude="37,26.4N" exif:GPSLongitude="24,56.0E"/>',
    "</rdf:RDF>",
    "</x:xmpmeta>",
    '<?xpacket end="w"?>',
  ].join("");
  return sharp({
    create: { width: 640, height: 480, channels: 3, background: "#048" },
  })
    .jpeg()
    .withXmp(xmp)
    .toBuffer();
}

describe("validatePhotoBase64 strips GPS EXIF (§6.4)", () => {
  it("strips EXIF (and with it, GPS) from a normal JPEG upload", async () => {
    const tagged = await jpegWithGpsExif();
    // Premise check: the input really does carry an EXIF block before we
    // claim the pipeline removed it.
    const inputMeta = await sharp(tagged).metadata();
    expect(inputMeta.exif).toBeDefined();
    expect(inputMeta.exif!.length).toBeGreaterThan(0);

    const { validatePhotoBase64 } = await import("./imageValidation");
    const result = await validatePhotoBase64(tagged.toString("base64"));
    if ("error" in result) throw new Error(`unexpected rejection: ${result.error}`);

    const outputMeta = await sharp(result.buffer).metadata();
    expect(outputMeta.exif).toBeUndefined();
    expect(outputMeta.xmp).toBeUndefined();
  });

  it("also strips EXIF/GPS through the HEIC fallback path (HEVC-compressed HEIC)", async () => {
    // The real HEVC fixture makes sharp's primary decode fail, driving
    // validatePhotoBase64 into the heic-convert catch branch. Mock that
    // decoder's output to be a JPEG carrying GPS EXIF (standing in for a
    // real iPhone HEIC photo, which does) so this test proves the fallback
    // branch's re-encode strips it too, not just the primary JPEG path.
    vi.resetModules();
    const tagged = await jpegWithGpsExif();
    const inputMeta = await sharp(tagged).metadata();
    expect(inputMeta.exif).toBeDefined();

    vi.doMock("heic-convert", () => ({
      default: vi.fn(async () => tagged),
    }));

    const { validatePhotoBase64 } = await import("./imageValidation");
    const heic = fs.readFileSync(FIXTURE_HEIC);
    const result = await validatePhotoBase64(heic.toString("base64"));
    if ("error" in result) throw new Error(`unexpected rejection: ${result.error}`);

    const outputMeta = await sharp(result.buffer).metadata();
    expect(outputMeta.exif).toBeUndefined();
    expect(outputMeta.xmp).toBeUndefined();

    vi.doUnmock("heic-convert");
    vi.resetModules();
  });

  it("strips an XMP block carrying a position from a normal JPEG upload (SYC-260)", async () => {
    const tagged = await jpegWithGpsXmp();
    // Premise check: the input really does carry the XMP position.
    const inputMeta = await sharp(tagged).metadata();
    expect(inputMeta.xmp).toBeDefined();
    expect(inputMeta.xmp!.toString()).toContain("GPSLatitude");

    const { validatePhotoBase64 } = await import("./imageValidation");
    const result = await validatePhotoBase64(tagged.toString("base64"));
    if ("error" in result) throw new Error(`unexpected rejection: ${result.error}`);

    const outputMeta = await sharp(result.buffer).metadata();
    expect(outputMeta.xmp).toBeUndefined();
    expect(outputMeta.exif).toBeUndefined();
    // Belt and braces: no trace of the packet anywhere in the stored bytes.
    expect(result.buffer.includes("GPSLatitude")).toBe(false);
  });

  it("also strips XMP through the HEIC fallback path (SYC-260)", async () => {
    vi.resetModules();
    const tagged = await jpegWithGpsXmp();
    const inputMeta = await sharp(tagged).metadata();
    expect(inputMeta.xmp).toBeDefined();

    vi.doMock("heic-convert", () => ({
      default: vi.fn(async () => tagged),
    }));

    const { validatePhotoBase64 } = await import("./imageValidation");
    const heic = fs.readFileSync(FIXTURE_HEIC);
    const result = await validatePhotoBase64(heic.toString("base64"));
    if ("error" in result) throw new Error(`unexpected rejection: ${result.error}`);

    const outputMeta = await sharp(result.buffer).metadata();
    expect(outputMeta.xmp).toBeUndefined();
    expect(result.buffer.includes("GPSLatitude")).toBe(false);

    vi.doUnmock("heic-convert");
    vi.resetModules();
  });
});
