import { isIslandWide, visibleColonyIds } from "../lib/guardianView";
import { useHeldTypingFor } from "../lib/teamAuth/heldTyping";
import { Router, type IRouter, type Request, type Response } from "express";
import { searchTeamCats, teamCatView, teamPhotoUrl } from "../lib/teamCatView";
import { getQueueReport } from "../lib/welfareQueue";
import { requireOrigin, setTeamHeaders } from "../lib/teamAuth/refuse";
import { TEAM_ORIGIN } from "../lib/teamAuth/config";
import multer from "multer";
import { safeError } from "../lib/logger";
import { comparableCount, findFromPhoto, isWholeIsland, type FindFilters } from "../lib/findFromPhoto";
import { checkFindLimits, findLimitReached } from "../middlewares/rateLimit";
import {
  INDEX_DOWN_WORDS,
  MATCHING_DOWN_ISLAND_WORDS,
  MATCHING_DOWN_WORDS,
  narrowingOf,
  renderFindForm,
  renderFindProblem,
  renderFindResults,
  STALE_PLACE_WORDS,
  TOO_BIG_WORDS,
  type FindFormOptions,
} from "../lib/teamPages/findPhotoPage";
import type { TieMode } from "../lib/teamPages/catPages";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { can } from "../lib/capabilities";
import { allColonyChoices } from "../lib/colonyCats";
import { cameFromCats, catPageFormKeys, renderCatPage, renderNoSuchCat } from "../lib/teamPages/catPages";
import { renderCatGridPage, withoutDefaultLives } from "../lib/teamPages/catGridPage";
import { parseCatFilters } from "../lib/teamCatFilters";
import { allTeamCats, catTrail, LIVES, listTeamCats, type CatListFilters } from "../lib/teamCatList";
import { formRoute } from "./teamCorrections";
import { renderCatMapPage } from "../lib/teamPages/catMapPage";
import { ISLAND_CENTRE, START_ZOOM } from "../lib/teamPages/map";
import { viewAround, type View } from "../lib/mapTiles/geometry";
import { applyMove } from "../lib/mapTiles/mapForms";
import { listSites } from "../lib/teamSites";
import { lastSeenWords } from "../lib/teamPages/lastSeen";
import { ObservationRefused } from "../lib/observations";
import { getAppSettings } from "../lib/appSettings";
import { ALREADY_UNDONE, logVetVisit, undoVetVisit, visitDay, visitsFor } from "../lib/vetVisits";
import { blankVisitForm, readVisitForm, renderVetVisitForm, visitFormFrom } from "../lib/teamPages/vetVisitForm";
import { renderConfirmPage } from "../lib/teamPages/confirm";
import { refuseSignedIn } from "../middlewares/requireTeam";
import { db, observationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { issueStripFor } from "../lib/issues/queue";

// The staff dashboard's "Cats" screens (SYC-43 part 2 plan, PR 3). Read-only;
// the correction forms on the cat page post to routes/teamCorrections.ts (PR 4).
// Both show exact positions, so both need view_exact_location. A browser gets
// the page; a caller asking for JSON (Accept: application/json) gets the same
// data as JSON. Neither ever goes through the public cat serialiser.

const router: IRouter = Router();

const wantsJson = (req: Request) => req.accepts(["html", "json"]) === "json";

const TIE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * GET /api/team/cats: every cat as a filterable photo grid (SYC-396 PR 1.3).
 * `?q=` still finds by name or SYR number, and `?tie=` still chooses a cat for
 * a welfare report. A caller asking for JSON gets the old search answer.
 */
router.get(
  "/team/cats",
  requireTeam("view_exact_location"),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    // The strict header first, before any await, so any answer that isn't
    // the finished grid page (JSON, a 500 from an error below) carries it.
    // A refusal from requireTeam went out with the strict one before this.
    setTeamHeaders(res);
    if (wantsJson(req)) {
      // Only a single string is a query; ?q=a&q=b or ?q[x]=1 is no query.
      const q = typeof req.query["q"] === "string" ? req.query["q"] : "";
      return void res.json({ query: q, results: await searchTeamCats(q) });
    }
    // ?tie=<publicId>: choosing a cat for that welfare report (PR 5). Only
    // a well-formed id is used; it is escaped wherever it is drawn.
    const tieId = typeof req.query["tie"] === "string" ? req.query["tie"] : "";
    const tie = TIE_ID_RE.test(tieId)
      ? {
          publicId: tieId,
          report: await getQueueReport(tieId),
          canTie: can(person, "change_report_state"),
        }
      : undefined;
    // ?view=map: the island Map (SYC-396 PR 1.5; plan Decision 1). Not while
    // choosing a cat for a report.
    if (!tie && req.query["view"] === "map") {
      const focusRaw = req.query["focus"];
      const focusId = typeof focusRaw === "string" && CAT_ID_RE.test(focusRaw) ? Number(focusRaw) : undefined;
      const html = await catMapHtml(person, withoutDefaultLives(parseCatFilters(req.query)), {
        focusId,
        scripted: true,
      });
      // As for the grid: the wider header only once the page is built. The
      // map is the Cats route's own page, so WIDE_CSP_ROUTES needs no new name.
      setTeamHeaders(res, { scripts: true });
      return void res.type("html").send(html);
    }
    const filters = withoutDefaultLives(parseCatFilters(req.query), Boolean(tie));
    // Choosing a cat for a report: everyone is in, so a cat already tied always shows.
    const forList = tie && !filters.lives ? { ...filters, lives: [...LIVES] } : filters;
    const started = Date.now();
    const now = new Date();
    const { items, total, catCount } = await listTeamCats(forList, now);
    // Spec §9.6: each page records how long it took. Counts only, no names.
    req.log.info({ ms: Date.now() - started, shown: items.length, total }, "team cats list");
    const html = renderCatGridPage({
      items,
      total,
      catCount,
      filters,
      personName: person.name,
      tie,
      now,
      colonies: await allColonyChoices(visibleColonyIds(person)),
    });
    // Only now, with the page built and nothing left to fail: the grid page
    // is the one page that loads our own script (dashboard-grid.js), so it
    // alone gets the wider header (test/wideCsp.ts WIDE_CSP_ROUTES).
    setTeamHeaders(res, { scripts: true });
    res.type("html").send(html);
  },
);

/** The island Map page for this person and these filters (SYC-396 PR 1.5). */
async function catMapHtml(
  person: ReturnType<typeof teamPerson>,
  filters: CatListFilters,
  opts: { focusId?: number; scripted: boolean; view?: View; note?: string },
): Promise<string> {
  const now = new Date();
  const visible = visibleColonyIds(person);
  const [{ cats, catCount }, sites, colonies, focus] = await Promise.all([
    allTeamCats(filters, now),
    listSites(visible, { includeRetired: false }),
    allColonyChoices(visible),
    opts.focusId !== undefined ? catTrail(opts.focusId) : Promise.resolve(null),
  ]);
  const last = focus?.points.at(-1);
  const view = opts.view ?? (last ? viewAround(last, FOCUS_ZOOM) : viewAround(ISLAND_CENTRE, START_ZOOM));
  return renderCatMapPage({
    personName: person.name,
    filters,
    colonies,
    cats,
    catCount,
    sites: sites.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, look: s.isPublic ? "public" : "private" })),
    focus,
    view,
    now,
    scripted: opts.scripted,
    note: opts.note,
  });
}

/** The button map opens this close on a focused cat's last spot. */
const FOCUS_ZOOM = 16;

/** A query string from a hidden field, as the object parseCatFilters reads (repeats become lists). */
function queryObject(qs: unknown): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (typeof qs !== "string" || qs.length > 2000) return out;
  for (const [k, v] of new URLSearchParams(qs)) {
    const had = out[k];
    out[k] = had === undefined ? v : Array.isArray(had) ? [...had, v] : [had, v];
  }
  return out;
}

/**
 * POST /api/team/cats/map: the zoom, pan and "Go to" buttons of the island
 * Map's button map, for a browser with no script (SYC-396 PR 1.5; spec §6.3).
 * The view and the filters come in hidden fields, never the address. Draws
 * the Map page with the button map in the open and no script at all, so it
 * keeps the strict security header (formRoute sets it).
 */
router.post(
  "/team/cats/map",
  ...formRoute("view_exact_location"),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    const body = typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {};
    const filters = withoutDefaultLives(parseCatFilters(queryObject(body["filters"])));
    const focusRaw = body["focus"];
    const focusId = typeof focusRaw === "string" && CAT_ID_RE.test(focusRaw) ? Number(focusRaw) : undefined;
    const view = applyMove(body);
    const html = await catMapHtml(person, filters, {
      focusId,
      scripted: false,
      view: view ?? viewAround(ISLAND_CENTRE, START_ZOOM),
      note: view ? undefined : "That didn't work, so the map is back at the whole island.",
    });
    res.status(view ? 200 : 400).type("html").send(html);
  },
);

/**
 * POST /api/team/cats/positions: every cat the filters match, at the place it
 * was last seen (else first found), for the island map (SYC-396 PR 1.5; spec
 * §6.1, §10.4). The filters come in the JSON BODY, in the grid's own shape,
 * never in the address: a query string here is ignored. No paging. Team-only
 * (view_exact_location with no target): a cat guardian gets the 403, since the
 * Map is the team's in phase 1 (§10.2). `no-store`, like every dashboard
 * answer. Positions reach the browser only in this signed-in answer and are
 * never drawn as numbers (the map's card shows the place in words).
 */
router.post(
  "/team/cats/positions",
  ...formRoute("view_exact_location"),
  async (req: Request, res: Response) => {
    const body = typeof req.body === "object" && req.body !== null && !Array.isArray(req.body) ? req.body : {};
    const { page: _page, ...filters } = parseCatFilters(body);
    const started = Date.now();
    const now = new Date();
    const { cats } = await allTeamCats(filters, now);
    // Spec §9.6: counts only, no names.
    req.log.info({ ms: Date.now() - started, shown: cats.length }, "team cat positions");
    res.json({
      cats: cats.map((c) => ({
        id: c.id,
        name: c.name,
        mark: c.mark,
        lat: c.placedAt.lat,
        lng: c.placedAt.lng,
        place: c.place,
        lastSeenAt: c.lastSeenAt ? c.lastSeenAt.toISOString() : null,
        // The card's words, worded as everywhere else ("Last seen 3 days ago").
        seen: lastSeenWords(c.lastSeenAt, now),
        // The colony's number; the page's own colony list has its name.
        colony: c.colonyId,
        photo: c.photoPublicId ? `${teamPhotoUrl(c.photoPublicId)}/small` : null,
      })),
    });
  },
);

// ── Find from a photo (SYC-396 PR 2.5; spec §5.2) ─────────────────────────
// Registered before GET /team/cats/:id, so "find" is never read as a cat id.

/** Only the three narrowing filters: an area key, a colony number, colour codes. */
function findFilters(src: unknown): FindFilters {
  const f = parseCatFilters(src);
  return { area: f.area, colony: f.colony, colours: f.colours };
}

/**
 * An area or colony that was given with a value but isn't recognised (a
 * retired key, a typo). parseCatFilters drops it, which would quietly turn
 * the search into the whole island, so the find page refuses it. An empty
 * value still means the island.
 */
async function stalePlace(
  src: unknown,
  f: FindFilters,
  person: ReturnType<typeof teamPerson>,
  address?: unknown,
): Promise<boolean> {
  const asObject = (v: unknown) => (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const q = asObject(src);
  const given = (v: unknown) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
  // A place written some other way (`area[]`, `colony2`) is no place we read: refuse it.
  const odd = (o: Record<string, unknown>) =>
    Object.keys(o).some((k) => k !== "area" && k !== "colony" && /^(area|colony)/.test(k));
  if (odd(q) || odd(asObject(address))) return true;
  // The search's place travels in the body. One in its address is never read, so refuse it.
  const a = asObject(address);
  if (given(a["area"]) || given(a["colony"])) return true;
  if (given(q["area"]) && f.area === undefined) return true;
  if (!given(q["colony"])) return false;
  if (f.colony === undefined) return true;
  // A well-formed number that is no colony (or none this person may see) is just as stale.
  return !(await allColonyChoices(visibleColonyIds(person))).some((c) => c.id === f.colony);
}

const matchingDownWords = (f: FindFilters) => (isWholeIsland(f) ? MATCHING_DOWN_ISLAND_WORDS : MATCHING_DOWN_WORDS);

/** ?tie= / a `tie` field: choosing a cat for that welfare report, as on the Cats page. */
async function tieFrom(raw: unknown, person: ReturnType<typeof teamPerson>): Promise<TieMode | undefined> {
  if (typeof raw !== "string" || !TIE_ID_RE.test(raw)) return undefined;
  return { publicId: raw, report: await getQueueReport(raw), canTie: can(person, "change_report_state") };
}

/**
 * The upload, held in memory only and never written anywhere: one file of at
 * most 10 MB, and a few short fields (the narrowing and the report).
 */
const findUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10, fieldSize: 1024, parts: 12 },
}).single("photo");

/** The form again, with a problem drawn next to its field. */
async function findFormHtml(
  person: ReturnType<typeof teamPerson>,
  filters: FindFilters,
  tie: TieMode | undefined,
  extra: Pick<FindFormOptions, "problem" | "capped" | "scripted"> = {},
): Promise<string> {
  const now = new Date();
  const [count, capped, colonies] = await Promise.all([
    comparableCount(filters, now),
    // A notice only: if the counter can't be read, the form shows without
    // one, and the POST still enforces the caps (review finding 1).
    extra.capped ? Promise.resolve(extra.capped) : findLimitReached(person.id).catch(() => "ok" as const),
    allColonyChoices(visibleColonyIds(person)),
  ]);
  return renderFindForm({
    personName: person.name,
    filters,
    colonies,
    tie,
    now,
    narrowing: narrowingOf(count, isWholeIsland(filters)),
    capped: capped === "ok" ? undefined : capped,
    problem: extra.problem,
    scripted: extra.scripted,
  });
}

/** GET /api/team/cats/find: where to look, how many cats that leaves, and the photo form. */
router.get(
  "/team/cats/find",
  requireTeam("find_cat_from_photo"),
  async (req: Request, res: Response) => {
    // Strict header first, before any await; the page is upgraded to the
    // script header below once it is built (find-photo.js, SYC-522).
    setTeamHeaders(res);
    const person = teamPerson(res);
    const filters = findFilters(req.query);
    const html = await findFormHtml(
      person,
      filters,
      await tieFrom(req.query["tie"], person),
      {
        scripted: true,
        ...((await stalePlace(req.query, filters, person)) ? { problem: { field: "place" as const, words: STALE_PLACE_WORDS } } : {}),
      },
    );
    // Only now, with the page built: this form loads find-photo.js (SYC-522),
    // which locks the button so one tap spends one search.
    setTeamHeaders(res, { scripts: true });
    res.type("html").send(html);
  },
);

/**
 * POST /api/team/cats/find: the search. Multipart, with the photo and the
 * narrowing in one form. The upload is read first (the narrowing arrives in
 * it); the daily caps are counted only after the narrowing and the photo
 * pass, and before any AI call (lib/findFromPhoto.ts `gate`). The answer is
 * this POST's own page: no address holds a result, a photo or a position.
 * The log line holds counts only: never the file's name, the filters or a
 * cat.
 */
router.post(
  "/team/cats/find",
  requireOrigin(TEAM_ORIGIN),
  requireTeam("find_cat_from_photo"),
  (_req: Request, res: Response, next: () => void) => {
    setTeamHeaders(res);
    next();
  },
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    // The upload's own errors are answered here, on this route only, with the
    // page and words: never the app's generic JSON 500.
    let uploadError: unknown = null;
    await new Promise<void>((resolve) => {
      findUpload(req, res, (err?: unknown) => {
        uploadError = err ?? null;
        resolve();
      });
    });
    const body = typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {};
    const filters = findFilters(body);
    const tie = await tieFrom(body["tie"], person);
    // Checked first: a stale place must never be redrawn as the island, even
    // when the upload also failed.
    const stale = await stalePlace(body, filters, person, req.query);
    if (uploadError !== null) {
      const tooBig = uploadError instanceof multer.MulterError && uploadError.code === "LIMIT_FILE_SIZE";
      req.log.info({ outcome: tooBig ? "too_big" : "bad_upload" }, "find from a photo");
      const words = tooBig ? TOO_BIG_WORDS : "That upload didn't work. Choose one photo and try again.";
      return void res
        .status(tooBig ? 413 : 400)
        .type("html")
        .send(
          await findFormHtml(person, filters, tie, {
            problem: stale ? { field: "place", words: STALE_PLACE_WORDS } : { field: "photo", words },
          }),
        );
    }
    // A report that doesn't exist: nothing to tie, so no search runs and none
    // is used (second review, finding 4).
    if (tie && !tie.report) {
      req.log.info({ outcome: "no_such_report" }, "find from a photo");
      return void res.status(404).type("html").send(await findFormHtml(person, filters, tie));
    }
    if (stale) {
      req.log.info({ outcome: "stale_place" }, "find from a photo");
      return void res
        .status(400)
        .type("html")
        .send(await findFormHtml(person, filters, tie, { problem: { field: "place", words: STALE_PLACE_WORDS } }));
    }
    const file = req.file;
    if (!file || file.size === 0) {
      req.log.info({ outcome: "no_photo" }, "find from a photo");
      return void res
        .status(400)
        .type("html")
        .send(await findFormHtml(person, filters, tie, { problem: { field: "photo", words: "Choose or take a photo first." } }));
    }

    // A free early look at the caps: someone already over theirs isn't kept
    // waiting while the photo is re-encoded and the cats' photos are read
    // (second review, finding 5). The real count is still made in the gate.
    const already = await findLimitReached(person.id).catch(() => "ok" as const);
    if (already !== "ok") {
      req.log.info({ outcome: "refused" }, "find from a photo");
      return void res.status(429).type("html").send(await findFormHtml(person, filters, tie, { capped: already }));
    }
    const started = Date.now();
    const now = new Date();
    let capped: "person" | "team" | null = null;
    const out = await findFromPhoto(file.buffer, filters, now, {
      gate: async () => {
        let r: Awaited<ReturnType<typeof checkFindLimits>>;
        try {
          r = await checkFindLimits(person.id);
        } catch (err) {
          // Fails closed, with the page and words, never the app's JSON 500
          // (review finding 1).
          req.log.warn({ err: safeError(err) }, "find from a photo: the daily count failed");
          return "counter_down";
        }
        if (r === "ok") return null;
        capped = r;
        return r;
      },
    });
    // Spec §9.6: counts only. Never the file's name, the filters or a cat.
    req.log.info(
      {
        ms: Date.now() - started,
        outcome: out.kind,
        ...("count" in out ? { count: out.count } : {}),
        ...(out.kind === "results" ? { compared: out.compared, shown: out.results.length } : {}),
      },
      "find from a photo",
    );
    const colonies = await allColonyChoices(visibleColonyIds(person));
    const common = { personName: person.name, filters, colonies, tie, now };
    switch (out.kind) {
      case "none_to_compare":
        return void res.status(400).type("html").send(await findFormHtml(person, filters, tie));
      case "bad_photo":
        return void res.status(400).type("html").send(
          await findFormHtml(person, filters, tie, {
            problem: { field: "photo", words: "That file isn't a photo we can read. Choose a JPEG, PNG, HEIC or WebP photo." },
          }),
        );
      case "no_photos":
        return void res.status(422).type("html").send(
          renderFindProblem({
            ...common,
            words: "None of these cats has a photo to compare with. No search was used.",
            gridLink: true,
          }),
        );
      case "refused":
        if (out.reason === "counter_down") {
          return void res.status(503).type("html").send(renderFindProblem({ ...common, words: matchingDownWords(filters), gridLink: true }));
        }
        return void res
          .status(429)
          .type("html")
          .send(await findFormHtml(person, filters, tie, { capped: capped ?? "person" }));
      case "not_a_cat":
        // 422, not 200: the POST's only 200 is the results page (test/wideCsp.ts PHOTO_CSP_ROUTES).
        return void res.status(422).type("html").send(
          renderFindProblem({ ...common, words: "We couldn't see a cat in that photo. Try another photo of the cat.", gridLink: false }),
        );
      case "index_down":
        // Spec §9.4: no search was used up (this is before the caps are counted).
        return void res.status(503).type("html").send(renderFindProblem({ ...common, words: INDEX_DOWN_WORDS, gridLink: false }));
      case "matching_down":
        return void res.status(503).type("html").send(renderFindProblem({ ...common, words: matchingDownWords(filters), gridLink: true }));
      case "results": {
        const { cats } = await allTeamCats({ area: filters.area, colony: filters.colony, colours: filters.colours }, now);
        const cards = new Map(cats.map((c) => [c.id, c]));
        const html = renderFindResults({
          ...common,
          count: out.count,
          compared: out.compared,
          shortlist: out.shortlist,
          leftOut: out.leftOut,
          results: out.results,
          cards,
          preview: out.preview,
        });
        // Only now, with the page built: the team's photo is a data: picture
        // in this answer, so this answer alone allows them (SYC-491).
        setTeamHeaders(res, { uploadedPhoto: true });
        return void res.type("html").send(html);
      }
    }
  },
);

const CAT_ID_RE = /^\d{1,9}$/;
const PHOTO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** GET /api/team/cats/:id: the team's page for one cat. */
router.get(
  "/team/cats/:id",
  requireTeam("view_exact_location"),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    setTeamHeaders(res);
    const raw = String(req.params["id"]);
    const view = CAT_ID_RE.test(raw) ? await teamCatView(Number(raw), new Date(), person) : null;
    if (!view) {
      if (wantsJson(req)) return void res.status(404).json({ error: "Not found" });
      return void res.status(404).type("html").send(renderNoSuchCat(person.name));
    }
    if (wantsJson(req)) return void res.json(view);
    // After a correction (PR 4) the form comes back here with ?done=<key>.
    // Only a fixed key is shown, never the query text itself.
    const done = typeof req.query["done"] === "string" ? req.query["done"] : undefined;
    const s = req.query["s"];
    const at = typeof s === "string" && CAT_ID_RE.test(s) ? Number(s) : undefined;
    // After Hide or Restore (PR 6): the photo the page lands on, by publicId.
    const p = req.query["p"];
    const photo = typeof p === "string" && PHOTO_ID_RE.test(p) ? p : undefined;
    const visits = await visitsFor(view.cat.id, { costs: can(person, "view_vet_costs") });
    // Back after signing in again (SYC-516 C3): one of this page's forms filled in.
    const kept = await useHeldTypingFor(req, person, catPageFormKeys(view, (c) => can(person, c)));
    res.type("html").send(
      renderCatPage(view, person.name, {
        visits,
        kept: kept ?? undefined,
        may: (c) => can(person, c),
        done,
        at,
        photo,
        colonies: can(person, "assign_cat_to_colony")
          ? await allColonyChoices(visibleColonyIds(person))
          : undefined,
        back: cameFromCats(req.get("referer")),
        allHistory: req.query["history"] === "all",
        island: isIslandWide(person),
        // SYC-44 PR 7.1: its own check (view_welfare_queue), not this page's.
        issues: await issueStripFor(person, view.cat.id),
      }),
    );
  },
);

// ── Vet visits (SYC-396 PR 3.1a; dashboard §8; plan Task 3.1.3) ──────────

const isForm = (req: Request) => Boolean(req.is("application/x-www-form-urlencoded"));
const VISIT_REASON_MAX = 500;

/** The visit form, drawn for the person: costs and vaccinations only if they may. */
async function visitFormFor(req: Request, res: Response, catId: number) {
  const person = teamPerson(res);
  const view = await teamCatView(catId, new Date(), person);
  if (!view) return null;
  const { sterilisationPriceEur } = await getAppSettings();
  return {
    person,
    view,
    page: {
      cat: { id: view.cat.id, name: view.cat.name, mainPhotoUrl: view.cat.mainPhotoUrl },
      personName: person.name,
      costs: can(person, "view_vet_costs"),
      vaccinate: can(person, "set_vaccination"),
      standardPriceEur: sterilisationPriceEur,
    },
  };
}

/**
 * GET /api/team/cats/:id/vet-visit: the form. It opens with Sterilised
 * ticked and the cost filled with the standard price; `?did=` ticks other
 * boxes, and fills the price only when Sterilised is among them.
 */
router.get(
  "/team/cats/:id/vet-visit",
  requireTeam("log_vet_visit"),
  async (req: Request, res: Response) => {
    setTeamHeaders(res);
    const raw = String(req.params["id"]);
    const found = CAT_ID_RE.test(raw) ? await visitFormFor(req, res, Number(raw)) : null;
    if (!found) return void res.status(404).type("html").send(renderNoSuchCat(teamPerson(res).name));
    const q = req.query["did"];
    const did = Array.isArray(q) ? q.map(String) : typeof q === "string" ? [q] : undefined;
    res.type("html").send(
      renderVetVisitForm({ ...found.page, values: blankVisitForm(found.page.standardPriceEur, did) }),
    );
  },
);

/**
 * POST /api/team/cats/:id/vet-visit: saves the visit and what it settled, in
 * one transaction (lib/vetVisits.ts). A problem comes back as the form again,
 * with everything typed kept and the problem named beside its field.
 */
router.post(
  "/team/cats/:id/vet-visit",
  ...formRoute("log_vet_visit"),
  async (req: Request, res: Response) => {
    const raw = String(req.params["id"]);
    const found = CAT_ID_RE.test(raw) ? await visitFormFor(req, res, Number(raw)) : null;
    if (!found) {
      if (!isForm(req)) return void res.status(404).json({ error: "Not found" });
      return void res.status(404).type("html").send(renderNoSuchCat(teamPerson(res).name));
    }
    const values = visitFormFrom(req.body);
    const again = (status: number, problems: Parameters<typeof renderVetVisitForm>[0]["problems"], problem?: string) => {
      if (!isForm(req)) return void res.status(status).json({ error: "Invalid request", fields: Object.keys(problems ?? {}) });
      res.status(status).type("html").send(renderVetVisitForm({ ...found.page, values, problems, problem }));
    };
    const read = readVisitForm(values, { costs: found.page.costs, vaccinate: found.page.vaccinate });
    if (!read.ok) return again(400, read.problems);
    try {
      const saved = await logVetVisit(found.person, { catId: found.view.cat.id, date: read.date, value: read.value });
      if (!isForm(req)) return void res.status(201).json(saved);
      res.redirect(303, `/api/team/cats/${found.view.cat.id}?done=visit#vet-visits`);
    } catch (err) {
      if (!(err instanceof ObservationRefused)) throw err;
      if (err.code === "NOT_AUTHORISED") return refuseSignedIn(req, res);
      if (err.code === "FUTURE_OBSERVED_AT") return again(400, { date: "The date can't be in the future." });
      req.log.info({ code: err.code }, "vet visit refused");
      return again(400, {}, "That visit couldn't be saved as it is. Check the answers and try again.");
    }
  },
);

/**
 * POST /api/team/vet-visits/:visitId/wrong: undoes a visit and everything it
 * recorded, in one step (Decision 6). A browser gets "Are you sure?" first;
 * Yes posts again with confirm=1.
 */
router.post(
  "/team/vet-visits/:visitId/wrong",
  ...formRoute("log_vet_visit"),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    const raw = String(req.params["visitId"]);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = typeof body["reason"] === "string" ? body["reason"].replace(/\r\n?/g, "\n").trim() : "";
    const [visit] = CAT_ID_RE.test(raw)
      ? await db.select().from(observationsTable).where(eq(observationsTable.id, Number(raw)))
      : [];
    // An undo is a vet_visit row too; it is no visit to mark wrong (second review, finding 3).
    const isUndo = (visit?.value as { retracted?: unknown } | undefined)?.retracted === true;
    if (!visit || visit.kind !== "vet_visit" || isUndo) {
      if (!isForm(req)) return void res.status(404).json({ error: "Not found" });
      return void res.status(404).type("html").send(renderNoSuchCat(person.name));
    }
    const back = `/api/team/cats/${visit.catId}`;
    if (reason.length < 1 || reason.length > VISIT_REASON_MAX || reason.includes(String.fromCharCode(0))) {
      if (!isForm(req)) return void res.status(400).json({ error: "Invalid request", fields: ["reason"] });
      return void res.redirect(303, `${back}?done=visitReason#vet-visits`);
    }
    if (isForm(req) && body["confirm"] !== "1") {
      return void res.type("html").send(
        renderConfirmPage({
          title: `Mark the vet visit on ${visitDay(visit.observedAt)} wrong?`,
          lines: [
            "The visit and everything it recorded are marked wrong together: its sterilisation and any vaccination.",
            "If it overruled a cat guardian's answer, her answer stands again.",
            "Nothing is deleted. It all stays in the history, crossed out, with your reason.",
          ],
          action: `/api/team/vet-visits/${visit.id}/wrong`,
          fields: { reason },
          yes: "Yes, mark the visit wrong",
          cancelHref: `${back}#vet-visits`,
          cancelLabel: "No, go back (nothing changed)",
          personName: person.name,
          active: "cats",
        }),
      );
    }
    try {
      const out = await undoVetVisit(person, visit.id, reason);
      if (!isForm(req)) return void res.status(201).json(out);
      res.redirect(303, `${back}?done=visitWrong#vet-visits`);
    } catch (err) {
      if (!(err instanceof ObservationRefused)) throw err;
      if (err.code === "NOT_AUTHORISED") return refuseSignedIn(req, res);
      if (err.code === "ALREADY_SUPERSEDED") {
        if (!isForm(req)) return void res.status(409).json({ error: ALREADY_UNDONE, code: "ALREADY_SUPERSEDED" });
        return void res.redirect(303, `${back}?done=visitAlready#vet-visits`);
      }
      throw err;
    }
  },
);

export default router;
