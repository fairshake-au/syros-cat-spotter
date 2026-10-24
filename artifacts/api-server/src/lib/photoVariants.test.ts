import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, photosTable, photoVariantsTable, pool } from "@workspace/db";
import { clearVariants, makeVariant, variantFor } from "./photoVariants";

// SYC-396 PR 1.2 (spec §11): small and medium versions of a catalogue photo.

const fixtureJpeg = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#048" } })
    .jpeg()
    .toBuffer();

const made: number[] = [];
async function seedPhoto(jpeg: Buffer): Promise<{ id: number }> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: jpeg.toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  made.push(p!.id);
  return p!;
}

const rowsFor = (photoId: number) =>
  db.select().from(photoVariantsTable).where(eq(photoVariantsTable.photoId, photoId));

afterAll(async () => {
  for (const id of made) await db.delete(photosTable).where(eq(photosTable.id, id));
  await pool.end();
});

describe("makeVariant", () => {
  it("makes a JPEG no wider than the size", async () => {
    const out = await makeVariant(await fixtureJpeg(1536, 1024), "small");
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(160);
  });

  it("makes the medium size 640 wide", async () => {
    const meta = await sharp(await makeVariant(await fixtureJpeg(1536, 1024), "medium")).metadata();
    expect(meta.width).toBe(640);
  });

  it("makes the card size 360 wide", async () => {
    const meta = await sharp(await makeVariant(await fixtureJpeg(1536, 1024), "card")).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(360);
  });

  it("puts a transparent PNG on white, not black", async () => {
    const png = await sharp({
      create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const stats = await sharp(await makeVariant(png, "small")).stats();
    for (const c of stats.channels.slice(0, 3)) expect(c.mean).toBeGreaterThan(240);
  });

  it("never enlarges", async () => {
    const meta = await sharp(await makeVariant(await fixtureJpeg(100, 80), "medium")).metadata();
    expect(meta.width).toBe(100);
  });
});

describe("variantFor", () => {
  it("stores it once and reuses it", async () => {
    const photo = await seedPhoto(await fixtureJpeg(800, 600));
    const a = await variantFor(photo.id, "small");
    const b = await variantFor(photo.id, "small");
    expect(a?.equals(b!)).toBe(true);
    expect(await rowsFor(photo.id)).toHaveLength(1);
  });

  it("keeps small and medium as separate rows", async () => {
    const photo = await seedPhoto(await fixtureJpeg(800, 600));
    await variantFor(photo.id, "small");
    await variantFor(photo.id, "medium");
    expect(await rowsFor(photo.id)).toHaveLength(2);
  });

  it("returns null for a photo that doesn't exist", async () => {
    expect(await variantFor(2_147_000_000, "small")).toBeNull();
  });

  it("returns null, and stores nothing, for stored bytes that aren't an image", async () => {
    const photo = await seedPhoto(Buffer.from("fake-jpeg"));
    expect(await variantFor(photo.id, "small")).toBeNull();
    expect(await rowsFor(photo.id)).toHaveLength(0);
  });

  it("is removed with its photo (the cascade)", async () => {
    const photo = await seedPhoto(await fixtureJpeg(800, 600));
    await variantFor(photo.id, "small");
    await db.delete(photosTable).where(eq(photosTable.id, photo.id));
    expect(await rowsFor(photo.id)).toHaveLength(0);
  });

  it("clearVariants removes every size, card included, so they are remade", async () => {
    const photo = await seedPhoto(await fixtureJpeg(800, 600));
    await variantFor(photo.id, "small");
    await variantFor(photo.id, "medium");
    await variantFor(photo.id, "card");
    expect(await rowsFor(photo.id)).toHaveLength(3);
    await clearVariants(photo.id);
    expect(await rowsFor(photo.id)).toHaveLength(0);
  });
});
