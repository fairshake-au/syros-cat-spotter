import { eq, sql } from "drizzle-orm";
import { db, photosTable } from "@workspace/db";

// Tests only (SYC-462): a photo removed for good, written exactly as
// removePhoto's one write is (spec §4.4 step 2), so the app's readers can be
// tested without the lib/db command. The person is left in place afterwards:
// photos.removed_by links to them, and the throwaway database goes at the end.

if (!process.env["VITEST"]) {
  throw new Error("removalKit is for tests only (VITEST is not set).");
}

/** Marks a photo removed for good: no picture, who, when and the request. */
export async function markRemoved(photoId: number, personId: string): Promise<void> {
  await db
    .update(photosTable)
    .set({ data: null, removedAt: sql`now()`, removedBy: personId, removedReason: "SYC-462" })
    .where(eq(photosTable.id, photoId));
}
