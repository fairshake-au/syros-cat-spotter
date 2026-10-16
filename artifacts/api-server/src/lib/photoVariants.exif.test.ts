import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { makeVariant, type VariantSize } from "./photoVariants";

// SYC-396 PR 1.2 (spec §11): every version is free of location data. Same
// guard, and same fixture approach, as lib/imageValidation.exif.test.ts: it
// rests on sharp's re-encode never calling withMetadata().

async function jpegWithGpsExif(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 900, channels: 3, background: "#048" } })
    .jpeg()
    .withMetadata({
      exif: {
        IFD0: { Copyright: "vitest fixture" },
        GPS: {
          // Ermoupoli, Syros.
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

describe("photo versions carry no location data", () => {
  it("the fixture really does carry GPS (so the checks below can fail)", async () => {
    expect((await sharp(await jpegWithGpsExif()).metadata()).exif).toBeDefined();
  });

  for (const size of ["small", "medium"] as VariantSize[]) {
    it(`the ${size} version has no EXIF block at all`, async () => {
      const out = await makeVariant(await jpegWithGpsExif(), size);
      expect((await sharp(out).metadata()).exif).toBeUndefined();
    });
  }
});
