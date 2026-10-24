import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { eq } from "drizzle-orm";
import { catsTable, db } from "@workspace/db";
import { can } from "../lib/capabilities";
import { colonyRef, searchCatsToAdd } from "../lib/colonyCats";
import { areaByKey } from "../lib/areas/namedAreas";
import { ObservationRefused } from "../lib/observations";
import {
  abandonBatch,
  addCat,
  BATCH_PHOTOS_MAX,
  createBatch,
  removeCat,
  updateCat,
  updateShared,
} from "../lib/vetBatches";
import { searchBatchCat, type BatchScope } from "../lib/vetBatchSearch";
import { saveBatch, type BatchProblem } from "../lib/vetVisits";
import { batchFindLimitReached } from "../middlewares/rateLimit";
import { backTo, draftOf, guarded, notFound, pageFor, rowOf, saved } from "../lib/vetBatchRoutes";
import { getBatch } from "../lib/vetBatches";
import { refuseSignedIn, requireTeam, teamPerson } from "../middlewares/requireTeam";
import { pageViewer } from "../middlewares/requireSeeing";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { formRoute } from "./teamCorrections";
import { renderConfirmPage } from "../lib/teamPages/confirm";
import {
  afterBatch,
  batchPath,
  cardValuesFrom,
  readCard,
  readShared,
  renderBatchPage,
  renderBatchProblem,
  SAID,
  sharedValuesFrom,
} from "../lib/teamPages/vetBatchPages";

// The vet visit batch pages (SYC-677 Task 6). Server-drawn, no script. Every
// route needs `log_vet_visit`, plus `view_vet_costs` and `find_cat_from_photo`
// (the batch screen shows costs and searches by photo). Every POST checks
// Origin, then the session and capability (formRoute), then the body, and
// answers with a 303 back to the cat's card (`#bc-<row>`), so a reload never
// resubmits. Nothing typed or uploaded is ever in an address: a message that
// has to travel in one is a key from SAID.
//
// Every store error becomes a page, never a 500: a saved batch is "This batch
// was already saved."; a batch removed mid-flow is the not-found page.

const router: IRouter = Router();

const ID_RE = /^\d{1,9}$/;
const NUL = String.fromCharCode(0);

/** The capabilities a batch needs beyond `log_vet_visit`. */
function needsBatchCaps(req: Request, res: Response, next: NextFunction) {
  const person = teamPerson(res);
  if (!can(person, "view_vet_costs") || !can(person, "find_cat_from_photo")) return void refuseSignedIn(req, res);
  next();
}

// Each route names `requireTeam("log_vet_visit")` or `formRoute("log_vet_visit")`
// itself, because guardianView.source.test.ts looks for it in the statement.
const readChecks = [
  (_req: Request, res: Response, next: NextFunction) => {
    setTeamHeaders(res);
    next();
  },
  needsBatchCaps,
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: BATCH_PHOTOS_MAX + 1, fields: 5, fieldSize: 1024, parts: 20 },
}).array("photos", BATCH_PHOTOS_MAX + 1);

const strOf = (v: unknown) => (typeof v === "string" ? v : "");
const bodyOf = (req: Request) => (typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {});

// ── Start, and see, a batch ────────────────────────────────────────────────

router.get("/team/vet-batches/new", requireTeam("log_vet_visit"), ...readChecks, async (req: Request, res: Response) => {
  const person = teamPerson(res);
  const colonyRaw = req.query["colony"];
  const areaRaw = req.query["area"];
  let id: number;
  if (typeof colonyRaw === "string") {
    const colony = ID_RE.test(colonyRaw) ? await colonyRef(pageViewer(res).visible, Number(colonyRaw)) : null;
    if (!colony) return notFound(res);
    id = await createBatch(person, { colonyId: colony.id });
  } else if (typeof areaRaw === "string") {
    const area = areaByKey(areaRaw);
    if (!area) return notFound(res);
    id = await createBatch(person, { areaKey: area.key });
  } else {
    return void res
      .status(400)
      .type("html")
      .send(renderBatchProblem(person.name, "Start a batch from a colony or an area, so we know where the cats are from.", "/api/team/colonies"));
  }
  res.redirect(303, batchPath(id));
});

router.get("/team/vet-batches/:id", requireTeam("log_vet_visit"), ...readChecks, async (req: Request, res: Response) => {
  const raw = String(req.params["id"]);
  const batch = ID_RE.test(raw) ? await getBatch(Number(raw)) : null;
  if (!batch) return notFound(res);
  if (batch.savedAt) return saved(res, batch.shared.colonyId, req.query["done"] === "batch");
  const said = strOf(req.query["said"]);
  const row = strOf(req.query["row"]);
  res.type("html").send(
    await pageFor(res, batch, {
      said: Object.hasOwn(SAID, said) ? { key: said, row: ID_RE.test(row) ? Number(row) : null } : undefined,
    }),
  );
});

// ── The fields every cat shares ────────────────────────────────────────────

router.post("/team/vet-batches/:id", ...formRoute("log_vet_visit"), needsBatchCaps, async (req: Request, res: Response) => {
  const batch = await draftOf(req, res);
  if (!batch) return;
  const person = teamPerson(res);
  const values = sharedValuesFrom(req.body);
  const read = readShared(values, {
    // Without set_vaccination the page has no vaccine boxes: what is there stays.
    keepVaccines: can(person, "set_vaccination") ? undefined : { vaccines: batch.shared.vaccines, vaccineOther: batch.shared.vaccineOther },
  });
  if (!read.ok) {
    return void res.status(400).type("html").send(await pageFor(res, batch, { shared: { values, problems: read.problems } }));
  }
  await guarded(res, batch, async () => {
    await updateShared(batch.id, { ...batch.shared, ...read.shared });
    res.redirect(303, `${batchPath(batch.id)}#shared`);
  });
});

// ── Cats ───────────────────────────────────────────────────────────────────

router.post("/team/vet-batches/:id/cats", ...formRoute("log_vet_visit"), needsBatchCaps, async (req: Request, res: Response) => {
  // The upload's own errors are answered here, on this route only, with a sentence.
  let uploadError: unknown = null;
  await new Promise<void>((resolve) => {
    upload(req, res, (err?: unknown) => {
      uploadError = err ?? null;
      resolve();
    });
  });
  const batch = await draftOf(req, res);
  if (!batch) return;
  const said = (key: string) => res.redirect(303, `${batchPath(batch.id)}?said=${key}#add`);
  if (uploadError !== null) {
    const code = uploadError instanceof multer.MulterError ? uploadError.code : "";
    req.log.info({ outcome: code || "bad_upload" }, "vet batch: add a cat");
    return said(code === "LIMIT_FILE_SIZE" ? "photo_too_big" : code === "LIMIT_UNEXPECTED_FILE" || code === "LIMIT_FILE_COUNT" ? "too_many_photos" : "bad_upload");
  }
  const files = ((req.files as { buffer: Buffer; size: number }[] | undefined) ?? []).filter((f) => f.size > 0);
  await guarded(res, batch, async () => {
    const out = await addCat(batch.id, files.map((f) => f.buffer));
    if (out.ok) return void res.redirect(303, backTo(batch.id, out.batchCatId));
    if (out.reason === "saved") return saved(res, batch.shared.colonyId);
    said(out.reason);
  });
});

function scopeOf(raw: string, visible: ReturnType<typeof pageViewer>["visible"]): Promise<BatchScope | null> {
  if (raw === "batch" || raw === "island") return Promise.resolve(raw);
  const colony = /^colony:(\d{1,9})$/.exec(raw);
  if (colony) return colonyRef(visible, Number(colony[1])).then((c) => (c ? { colonyId: c.id } : null));
  const area = /^area:([a-z0-9_-]{1,40})$/.exec(raw);
  if (area) return Promise.resolve(areaByKey(area[1]) ? { areaKey: area[1]! } : null);
  return Promise.resolve(null);
}

router.post("/team/vet-batches/:id/cats/:catRow/search", ...formRoute("log_vet_visit"), needsBatchCaps, async (req: Request, res: Response) => {
  const batch = await draftOf(req, res);
  if (!batch) return;
  const cat = rowOf(req, res, batch);
  if (!cat) return;
  const person = teamPerson(res);
  const back = (said?: string) => res.redirect(303, backTo(batch.id, cat.id, said));
  const scope = await scopeOf(strOf(bodyOf(req)["scope"]), pageViewer(res).visible);
  if (!scope) return back("bad_place");
  // A free early look: someone already over the limit is told so, with no work done.
  const already = await batchFindLimitReached(person.id).catch(() => "ok" as const);
  if (already !== "ok") return back(`capped_${already}`);
  await guarded(res, batch, async () => {
    const out = await searchBatchCat(person, cat.id, scope);
    // Counts only (never a photo, a cat or a place).
    req.log.info({ outcome: out.kind, ...(out.kind === "results" ? { shown: out.results.length } : {}) }, "vet batch: find a cat");
    switch (out.kind) {
      case "results":
        return back();
      case "refused":
        return back(out.reason === "person" || out.reason === "team" ? `capped_${out.reason}` : "counter_down");
      default:
        return back(out.kind);
    }
  });
});

router.post("/team/vet-batches/:id/cats/:catRow/lookup", ...formRoute("log_vet_visit"), needsBatchCaps, async (req: Request, res: Response) => {
  const batch = await draftOf(req, res);
  if (!batch) return;
  const cat = rowOf(req, res, batch);
  if (!cat) return;
  const q = strOf(bodyOf(req)["q"]).slice(0, 100);
  // A NUL can match nothing (Postgres can't hold one); no search is used either way.
  const results = q.trim() === "" || q.includes(NUL) ? [] : await searchCatsToAdd(pageViewer(res).visible, q);
  res.type("html").send(await pageFor(res, batch, { lookup: { row: cat.id, results } }));
});

router.post("/team/vet-batches/:id/cats/:catRow/confirm", ...formRoute("log_vet_visit"), needsBatchCaps, async (req: Request, res: Response) => {
  const batch = await draftOf(req, res);
  if (!batch) return;
  const cat = rowOf(req, res, batch);
  if (!cat) return;
  const raw = strOf(bodyOf(req)["catId"]);
  await guarded(res, batch, async () => {
    if (raw === "none") {
      await updateCat(cat.id, { catId: null, confirmed: false });
      return void res.redirect(303, backTo(batch.id, cat.id));
    }
    const [found] = ID_RE.test(raw) ? await db.select({ id: catsTable.id }).from(catsTable).where(eq(catsTable.id, Number(raw))) : [];
    if (!found) return void res.redirect(303, backTo(batch.id, cat.id, "no_such_cat"));
    await updateCat(cat.id, { catId: found.id, confirmed: true });
    res.redirect(303, backTo(batch.id, cat.id));
  });
});

router.post("/team/vet-batches/:id/cats/:catRow", ...formRoute("log_vet_visit"), needsBatchCaps, async (req: Request, res: Response) => {
  const batch = await draftOf(req, res);
  if (!batch) return;
  const cat = rowOf(req, res, batch);
  if (!cat) return;
  const person = teamPerson(res);
  const values = cardValuesFrom(req.body);
  // Ticking Vaccinated is a second capability, checked on the server whatever the page showed.
  if (values.did.includes("vaccinated") && !can(person, "set_vaccination")) return void refuseSignedIn(req, res);
  const read = readCard(values);
  if (!read.ok) {
    return void res.status(400).type("html").send(await pageFor(res, batch, { card: { row: cat.id, values, problems: read.problems } }));
  }
  await guarded(res, batch, async () => {
    await updateCat(cat.id, read.fields);
    res.redirect(303, backTo(batch.id, cat.id));
  });
});

router.post("/team/vet-batches/:id/cats/:catRow/remove", ...formRoute("log_vet_visit"), needsBatchCaps, async (req: Request, res: Response) => {
  const batch = await draftOf(req, res);
  if (!batch) return;
  const cat = rowOf(req, res, batch);
  if (!cat) return;
  await guarded(res, batch, async () => {
    await removeCat(cat.id);
    res.redirect(303, `${batchPath(batch.id)}#cats`);
  });
});

// ── Save, or throw away ────────────────────────────────────────────────────

router.post("/team/vet-batches/:id/save", ...formRoute("log_vet_visit"), needsBatchCaps, async (req: Request, res: Response) => {
  const batch = await draftOf(req, res);
  if (!batch) return;
  const person = teamPerson(res);
  const problem = async (problems: BatchProblem[], sentence?: string) =>
    res.status(422).type("html").send(await pageFor(res, batch, { problems, problem: sentence }));
  try {
    const out = await saveBatch(person, batch.id);
    if (out.ok) {
      req.log.info({ visits: out.visits.length }, "vet batch saved");
      return void res.redirect(
        303,
        batch.shared.colonyId !== null ? afterBatch(batch.shared.colonyId, "batch") : `${batchPath(batch.id)}?done=batch`,
      );
    }
    if (out.problems.some((x) => x.batchCatId === null && x.field === "batch")) return saved(res, batch.shared.colonyId);
    return void (await problem(out.problems));
  } catch (err) {
    if (err instanceof ObservationRefused) {
      if (err.code === "NOT_AUTHORISED") return void refuseSignedIn(req, res);
      if (err.code === "NOT_FOUND") return notFound(res);
      req.log.info({ code: err.code }, "vet batch save refused");
      return void (await problem([], "That batch couldn't be saved as it is. Check the answers and try again."));
    }
    throw err;
  }
});

router.post("/team/vet-batches/:id/abandon", ...formRoute("log_vet_visit"), needsBatchCaps, async (req: Request, res: Response) => {
  const batch = await draftOf(req, res);
  if (!batch) return;
  if (bodyOf(req)["confirm"] !== "1") {
    return void res.type("html").send(
      renderConfirmPage({
        title: "Throw this batch away?",
        lines: [
          `The batch's ${batch.cats.length === 1 ? "1 cat" : `${batch.cats.length} cats`} and their photos are deleted for good.`,
          "No vet visit has been saved from it, so no cat's record changes.",
        ],
        action: `${batchPath(batch.id)}/abandon`,
        fields: {},
        yes: "Yes, throw it away",
        cancelHref: batchPath(batch.id),
        cancelLabel: "No, go back (nothing changed)",
        personName: teamPerson(res).name,
        active: "colonies",
      }),
    );
  }
  await guarded(res, batch, async () => {
    await abandonBatch(batch.id);
    res.redirect(303, afterBatch(batch.shared.colonyId));
  });
});

export default router;
