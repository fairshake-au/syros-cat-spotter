import type { Request, Response } from "express";
import { eq, inArray } from "drizzle-orm";
import { catsTable, db, photosTable } from "@workspace/db";
import { can } from "./capabilities";
import { getAppSettings } from "./appSettings";
import { allColonyChoices, colonyRef } from "./colonyCats";
import { areaByKey, currentAreas } from "./areas/namedAreas";
import { syrNumber, teamPhotoUrl } from "./teamCatView";
import { BatchSavedError, getBatch, type Batch, type BatchCat } from "./vetBatches";
import { batchFindLimitReached } from "../middlewares/rateLimit";
import { teamPerson } from "../middlewares/requireTeam";
import { pageViewer } from "../middlewares/requireSeeing";
import {
  batchPath,
  renderBatchPage,
  renderBatchSaved,
  renderNoSuchBatch,
  type BatchPage,
  type CatLine,
} from "./teamPages/vetBatchPages";

// What the batch routes (routes/teamVetBatches.ts) share: finding the batch a
// request is about, turning the store's refusals into pages, and drawing the
// page. Kept out of the route file so the island-only call check
// (guardianView.source.test.ts) sees each store call inside the route that is
// behind log_vet_visit.

const ID_RE = /^\d{1,9}$/;

export function notFound(res: Response) {
  res.status(404).type("html").send(renderNoSuchBatch(teamPerson(res).name));
}

export function saved(res: Response, colonyId: number | null, just = false) {
  res.type("html").send(renderBatchSaved({ personName: teamPerson(res).name, colonyId, just }));
}

/** A route's batch: the draft, or the page that says why there is none (and null). */
export async function draftOf(req: Request, res: Response): Promise<Batch | null> {
  const raw = String(req.params["id"]);
  const batch = ID_RE.test(raw) ? await getBatch(Number(raw)) : null;
  if (!batch) {
    notFound(res);
    return null;
  }
  if (batch.savedAt) {
    saved(res, batch.shared.colonyId);
    return null;
  }
  return batch;
}

/** A route's cat row, in this batch: or the not-found page (and null). */
export function rowOf(req: Request, res: Response, batch: Batch): BatchCat | null {
  const raw = String(req.params["catRow"]);
  const cat = ID_RE.test(raw) ? batch.cats.find((c) => c.id === Number(raw)) : undefined;
  if (!cat) {
    notFound(res);
    return null;
  }
  return cat;
}

/** The store's refusals as pages. */
export async function guarded(res: Response, batch: Batch, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    if (err instanceof BatchSavedError) return saved(res, batch.shared.colonyId);
    if (err instanceof Error && err.message === "No such batch") return notFound(res);
    throw err;
  }
}

export const backTo = (batchId: number, row?: number | null, said?: string) =>
  `${batchPath(batchId)}${said ? `?said=${said}${row ? `&row=${row}` : ""}` : ""}${row ? `#bc-${row}` : ""}`;

/** The page, with everything it draws read fresh. */
export async function pageFor(res: Response, batch: Batch, extra: Partial<BatchPage> = {}): Promise<string> {
  const person = teamPerson(res);
  const viewer = pageViewer(res);
  const wanted = new Set<number>();
  for (const c of batch.cats) {
    if (c.catId !== null) wanted.add(c.catId);
    for (const s of c.suggestions ?? []) wanted.add(s.catId);
  }
  const lines = new Map<number, CatLine>();
  if (wanted.size) {
    const rows = await db
      .select({ id: catsTable.id, name: catsTable.name, photo: photosTable.publicId })
      .from(catsTable)
      .leftJoin(photosTable, eq(photosTable.id, catsTable.primaryPhotoId))
      .where(inArray(catsTable.id, [...wanted]));
    for (const r of rows) {
      lines.set(r.id, { name: r.name, syr: syrNumber(r.id), thumbUrl: r.photo ? `${teamPhotoUrl(r.photo)}/small` : null });
    }
  }
  const [{ sterilisationPriceEur }, colonies, limit, colony] = await Promise.all([
    getAppSettings(),
    allColonyChoices(viewer.visible),
    batchFindLimitReached(person.id).catch(() => "ok" as const),
    batch.shared.colonyId !== null ? colonyRef(viewer.visible, batch.shared.colonyId) : Promise.resolve(null),
  ]);
  const area = batch.shared.areaKey !== null ? areaByKey(batch.shared.areaKey) : undefined;
  return renderBatchPage({
    batch,
    personName: person.name,
    mayVaccinate: can(person, "set_vaccination"),
    standardPriceEur: sterilisationPriceEur,
    place: colony ? { kind: "colony", name: colony.name } : area ? { kind: "area", name: area.name } : null,
    cats: lines,
    scopes: { colonies, areas: currentAreas().map((a) => ({ key: a.key, name: a.name })) },
    limit,
    ...extra,
  });
}

