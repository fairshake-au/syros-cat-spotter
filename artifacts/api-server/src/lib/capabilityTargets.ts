import {
  catsTable,
  db,
  feedingSitesTable,
  observationsTable,
  photosTable,
  sightingsTable,
  welfareReportsTable,
} from "@workspace/db";
import { eq, isNotNull, and } from "drizzle-orm";
import type { CapabilityTarget } from "./capabilities";
import { currentColonyOf } from "./colonyMembership";

// Where a check applies, read FROM THE RECORD, never from the request
// (roles-and-invites.md §6.1; SYC-53 PR 0.5, test T5). A guardian can't name
// her own colony in a query string or a form to reach someone else's cat.
//
// - A cat's colony is its newest active `colony` statement (superseded ones
//   ignored; `colonyId: null` means none), through colonyMembership.ts, the
//   one place that rule lives.
// - A photo's colony is its cats': every cat it is tied to (as a cat's main
//   photo, a sighting's photo, or a statement's photo). It may be tied to
//   more than one, so this returns one target per cat and the check must pass
//   for EVERY one of them. A photo tied to no cat gets one target with no
//   colony, which only island holders pass.
// - A report's colony is its cat's; a report tied to no cat has none.
// - A feeding site's colony is its own column.
//
// A cat in no colony has no placed target, so only island holders pass.

/** The target for one cat. */
export async function catTarget(catId: number): Promise<CapabilityTarget> {
  const colonies = await currentColonyOf([catId]);
  return { colonyId: colonies.get(catId) ?? null };
}

/** One target per cat, for checking every one of them. */
async function catTargets(catIds: readonly number[]): Promise<CapabilityTarget[]> {
  const unique = [...new Set(catIds)];
  if (unique.length === 0) return [{ colonyId: null }];
  const colonies = await currentColonyOf(unique);
  return unique.map((id) => ({ colonyId: colonies.get(id) ?? null }));
}

/** The cats a stored photo is tied to, by its public id. */
export async function catsOfPhoto(publicId: string): Promise<number[]> {
  const [photo] = await db
    .select({ id: photosTable.id })
    .from(photosTable)
    .where(eq(photosTable.publicId, publicId));
  if (!photo) return [];
  const [asMain, asSighting, asStatement] = await Promise.all([
    db
      .select({ catId: catsTable.id })
      .from(catsTable)
      .where(eq(catsTable.primaryPhotoId, photo.id)),
    db
      .select({ catId: sightingsTable.catId })
      .from(sightingsTable)
      .where(and(eq(sightingsTable.photoId, photo.id), isNotNull(sightingsTable.catId))),
    db
      .select({ catId: observationsTable.catId })
      .from(observationsTable)
      .where(eq(observationsTable.photoId, photo.id)),
  ]);
  return [...asMain, ...asSighting, ...asStatement]
    .map((r) => r.catId)
    .filter((id): id is number => typeof id === "number");
}

/** Every target a catalogue photo must pass: one per cat it is tied to. */
export async function photoTargets(publicId: string): Promise<CapabilityTarget[]> {
  return catTargets(await catsOfPhoto(publicId));
}

/** A welfare report's target: its cat's colony, or none. */
export async function reportTarget(publicId: string): Promise<CapabilityTarget> {
  const [report] = await db
    .select({ catId: welfareReportsTable.catId })
    .from(welfareReportsTable)
    .where(eq(welfareReportsTable.publicId, publicId));
  if (!report || report.catId === null) return { colonyId: null };
  return catTarget(report.catId);
}

/** A feeding site's target: its own colony column. */
export async function feedingSiteTarget(siteId: number): Promise<CapabilityTarget> {
  const [site] = await db
    .select({ colonyId: feedingSitesTable.colonyId })
    .from(feedingSitesTable)
    .where(eq(feedingSitesTable.id, siteId));
  return { colonyId: site?.colonyId ?? null };
}
