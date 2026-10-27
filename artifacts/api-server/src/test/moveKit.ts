import { catsTable, db, observationsTable, photosTable, sightingsTable, type Observation } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { writeObservation } from "../lib/observations";
import { deleteTestSightings } from "./sightings";

/**
 * Tests only (SYC-150 PR 3.1): cats, sightings and a spotter's answers for
 * the move tests. Names are letters only (CLAUDE.md, SYC-709). Observations,
 * sightings and moves are append-only, so those rows stay, naming only this
 * kit's (deleted) cats, and the throwaway database goes at the end of the run.
 */

if (!process.env["VITEST"]) {
  throw new Error("test/moveKit is for tests only (VITEST is not set).");
}

const LETTERS = "bcdfghjkmpqrvwxz";
let counter = 0;
/** A unique tag spelt in letters. */
export const tag = () => {
  counter += 1;
  let n = counter;
  let out = "";
  do {
    out = LETTERS[n % 16] + out;
    n = Math.floor(n / 16);
  } while (n > 0);
  return out;
};

export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

export function moveKit(prefix: string) {
  const devicePrefix = `vitest-${prefix.toLowerCase()}-`;

  async function cleanup() {
    await db.delete(catsTable).where(like(catsTable.name, `${prefix}%`));
    await deleteTestSightings(like(sightingsTable.deviceId, `${devicePrefix}%`));
  }

  async function photo(): Promise<number> {
    const t = tag();
    const [p] = await db
      .insert(photosTable)
      .values({ publicId: `${prefix}${t}`, data: Buffer.from(`photo:${t}`).toString("base64"), mime: "image/jpeg", createdAt: daysAgo(40) })
      .returning({ id: photosTable.id });
    return p!.id;
  }

  async function cat(createdAt = daysAgo(40)): Promise<number> {
    const [c] = await db
      .insert(catsTable)
      .values({ name: `${prefix}${tag()}`, primaryPhotoId: await photo(), lat: 37.4441, lng: 24.9412, discovererDeviceId: `${devicePrefix}finder`, createdAt })
      .returning({ id: catsTable.id });
    return c!.id;
  }

  const device = () => `${devicePrefix}${tag()}`;

  /** A resolved sighting of `catId` from `deviceId`, with its own photo. */
  async function sighting(catId: number, deviceId: string, at = daysAgo(3)) {
    const photoId = await photo();
    const [s] = await db
      .insert(sightingsTable)
      .values({ catId, deviceId, photoId, lat: 37.4441, lng: 24.9412, status: "resolved", createdAt: at })
      .returning();
    return s!;
  }

  /** The spotter's answers on the reward screen, as the answers route writes them. */
  async function answer(
    s: { id: number; catId: number | null; deviceId: string | null; photoId: number | null; createdAt: Date },
    kind: "ear_tip" | "food_and_water" | "note",
    value: object,
  ): Promise<Observation> {
    return writeObservation(db, {
      catId: s.catId!,
      kind,
      value,
      deviceId: s.deviceId,
      roleAtTime: "public",
      authorityScope: "none",
      provenance: "volunteered",
      sightingId: s.id,
      photoId: s.photoId,
      observedAt: s.createdAt,
    });
  }

  const rowsOf = (catId: number) => db.select().from(observationsTable).where(eq(observationsTable.catId, catId));

  return { cleanup, photo, cat, device, sighting, answer, rowsOf, devicePrefix };
}
