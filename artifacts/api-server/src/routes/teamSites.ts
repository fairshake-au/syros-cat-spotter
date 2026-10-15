import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { formRoute } from "./teamCorrections";
import { ISLAND_CENTRE, START_ZOOM } from "../lib/teamPages/map";
import {
  clampView,
  inIsland,
  isViewAllowed,
  MAX_ZOOM,
  viewAround,
  type Position,
  type View,
} from "../lib/mapTiles/geometry";
import { readTileToken } from "../lib/mapTiles/tileToken";
import { applyMove, readTap } from "../lib/mapTiles/mapForms";
import {
  listSites,
  recentSiteChanges,
  recordSitePageRead,
  siteCounts,
  siteView,
} from "../lib/teamSites";
import { renderNoSuchSite, renderSitePage, renderSitesPage, SITES_PATH } from "../lib/teamPages/sitePages";
import {
  CONFIRM_ZOOM,
  NEW_PATH,
  PICK_PATH,
  renderAddConfirm,
  renderMoveConfirm,
  renderPicker,
  renderSiteProblem,
} from "../lib/teamPages/siteFormPages";
import { t, type WordKey } from "../lib/teamPages/words";
import { coordinate, fieldsOf, lf, noNul, optionalText } from "../lib/teamForms";
import {
  SITE_DIRECTIONS_MAX,
  SITE_NAME_MAX,
  SITE_NOTES_MAX,
  SITE_REASON_MAX,
  STAMP_RE,
  addSite,
  changeSiteColony,
  colonyOptions,
  editSite,
  moveSite,
  restoreSite,
  retireSite,
  siteForMove,
} from "../lib/teamSiteWrites";

// The team's Feeding sites pages (SYC-209 PR 3.2 reads; PR 3.3 writes; spec
// §2.1 to §2.5, §8, §11.2; plan K8, K13, Decision 1A).
//
// **Permissions (plan Decision 1A).** Every route asks for
// `view_exact_location` with NO colony target, so a guardian gets the 403
// until PR 4.1 switches targets and filters on together. The "for any
// colony?" check is the sign-in door's alone.
//
// **No position in any address (K13).** The map's zoom, pan and area buttons
// are POST forms with hidden fields; the "Show retired" setting is a fixed
// key (`retired=1`), never a position. A marker links to a site's number.
//
// **Who looked (spec §8).** Opening ONE site's page writes one
// `site_page_reads` row. The list and the map write none.

const router: IRouter = Router();

const wantsJson = (req: Request) => req.accepts(["html", "json"]) === "json";
const ID_RE = /^\d{1,9}$/;
/** The site page's small map: close enough to see the street. */
const SITE_ZOOM = 17;

async function sitesPage(
  res: Response,
  status: number,
  view: View,
  showRetired: boolean,
  note?: string,
): Promise<void> {
  const [counts, changes, sites] = await Promise.all([
    siteCounts(),
    recentSiteChanges(),
    listSites({ includeRetired: showRetired }),
  ]);
  res
    .status(status)
    .type("html")
    .send(
      renderSitesPage({
        personName: teamPerson(res).name,
        counts,
        changes,
        sites,
        view,
        showRetired,
        note,
      }),
    );
}

/** GET /api/team/sites?retired=1: the map, the count, the recent changes and the list. */
router.get(
  "/team/sites",
  requireTeam("view_exact_location"),
  async (req: Request, res: Response) => {
    setTeamHeaders(res);
    // Only the single value "1" ticks the box; anything else is unticked.
    const showRetired = req.query["retired"] === "1";
    if (wantsJson(req)) {
      const [counts, sites] = await Promise.all([siteCounts(), listSites({ includeRetired: showRetired })]);
      return void res.json({ counts, sites });
    }
    // The tick box keeps the map where it was: the view comes back as an opaque token.
    const token = typeof req.query["view"] === "string" ? readTileToken(req.query["view"]) : null;
    const view =
      token && isViewAllowed(token)
        ? clampView({ z: token.z, x: token.x, y: token.y })
        : viewAround(ISLAND_CENTRE, START_ZOOM);
    await sitesPage(res, 200, view, showRetired);
  },
);

/**
 * POST /api/team/sites/map: zoom, pan or jump to an area on the Feeding sites
 * page. The view and the "Show retired" setting come in hidden fields. It
 * writes nothing, and no read record.
 */
router.post(
  "/team/sites/map",
  ...formRoute("view_exact_location"),
  async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const showRetired = body["retired"] === "1";
    const view = applyMove(body);
    if (!view) {
      return void (await sitesPage(
        res,
        400,
        viewAround(ISLAND_CENTRE, START_ZOOM),
        showRetired,
        t("sites.moveNote"),
      ));
    }
    await sitesPage(res, 200, view, showRetired);
  },
);

// ── Writing (SYC-209 PR 3.3) ───────────────────────────────────────────────
//
// Every POST runs `formRoute`: the Origin check, then the session and the
// capability (NO colony target, Decision 1A), then the body. A browser gets
// a page, or a 303 back with a fixed message key; anything else gets JSON. A
// bad form answers 400 naming the fields only, never echoing what was typed.

const isFormPost = (req: Request) => Boolean(req.is("application/x-www-form-urlencoded"));

const sitePath = (id: number, done?: string) =>
  `${SITES_PATH}/${id}${done ? `?done=${encodeURIComponent(done)}` : ""}`;

/** What went wrong in a field, in words. A field not named gets the general sentence. */
const FIELD_WORDS: Record<string, WordKey> = {
  name: "sproblem.name",
  notes: "sproblem.notesLong",
  directions: "sproblem.directionsLong",
  reason: "sproblem.reason",
  lat: "sproblem.position",
  lng: "sproblem.position",
  updatedAt: "sproblem.stamp",
  colonyId: "sproblem.colony",
};

const problemFor = (fields: string[], typedName: unknown): string => {
  const sentences = new Set(
    fields.map((f) => {
      if (f === "name" && typeof typedName === "string" && typedName.trim().length > SITE_NAME_MAX) {
        return t("sproblem.nameLong");
      }
      const key = Object.hasOwn(FIELD_WORDS, f) ? FIELD_WORDS[f] : undefined;
      return key ? t(key) : t("sproblem.fields") + ".";
    }),
  );
  return [...sentences].join(" ");
};

/** 400, naming the fields only (JSON), or a short page with a way back (a form). */
function badForm(
  req: Request,
  res: Response,
  fields: string[],
  back: { href: string; label: string },
  message?: string,
): void {
  if (!isFormPost(req)) {
    return void res.status(400).json({ error: "Invalid request", fields });
  }
  const typedName = (req.body as Record<string, unknown> | undefined)?.["name"];
  res
    .status(400)
    .type("html")
    .send(renderSiteProblem(teamPerson(res).name, message ?? problemFor(fields, typedName), back));
}

function notFound(req: Request, res: Response): void {
  const json = req.method === "GET" || req.method === "HEAD" ? wantsJson(req) : !isFormPost(req);
  if (json) return void res.status(404).json({ error: "Not found" });
  res.status(404).type("html").send(renderNoSuchSite(teamPerson(res).name));
}

/** "Someone already changed this." (spec §11.2): 303 back with the message, or 409. */
function stale(req: Request, res: Response, id: number): void {
  req.log.info({ reason: "stale_stamp" }, "feeding site write refused");
  if (isFormPost(req)) return void res.redirect(303, sitePath(id, "stale"));
  res.status(409).json({ error: "Someone already changed this.", code: "STALE" });
}

const siteIdOf = (req: Request): number | null => {
  const raw = String(req.params["id"]);
  return ID_RE.test(raw) ? Number(raw) : null;
};

// The fields, as the forms send them.
const nameField = z.preprocess(lf, z.string().trim().min(1).max(SITE_NAME_MAX).refine(noNul));
const reasonField = z.preprocess(lf, z.string().trim().min(1).max(SITE_REASON_MAX).refine(noNul));
const stampField = z.string().regex(STAMP_RE);
const latField = coordinate(90).refine((v): v is number => v !== null);
const lngField = coordinate(180).refine((v): v is number => v !== null);
const colonyDigits = z.string().regex(ID_RE).transform(Number);
/** The add form: "no colony" is an empty box, and a missing field is the same. */
const optionalColony = z.preprocess(
  (v) => (v === undefined || v === "" ? null : v),
  colonyDigits.nullable(),
);
/** Change colony: the field must be there; an empty box means "no colony". */
const requiredColony = z.union([z.literal("").transform(() => null), colonyDigits]);

// NOTE: no schema here has a visibility field. zod drops every key it does
// not name, so an `is_public`, `public_*` or `made_public_*` sent with the
// form is ignored (spec test 7).
const AddForm = z.object({
  name: nameField,
  colonyId: optionalColony,
  directions: optionalText(SITE_DIRECTIONS_MAX).optional(),
  notes: optionalText(SITE_NOTES_MAX).optional(),
  lat: latField,
  lng: lngField,
});
const EditForm = z.object({
  updatedAt: stampField,
  name: nameField.optional(),
  directions: optionalText(SITE_DIRECTIONS_MAX).optional(),
  notes: optionalText(SITE_NOTES_MAX).optional(),
});
const MoveForm = z.object({ updatedAt: stampField, lat: latField, lng: lngField, reason: reasonField });
const ReasonForm = z.object({ updatedAt: stampField, reason: reasonField });
const ColonyForm = z.object({ updatedAt: stampField, colonyId: requiredColony });
const StampOnly = z.object({ updatedAt: stampField });
const TypedForm = z.object({ lat: latField, lng: lngField });

/** Typed coordinates: a plain-decimal pair, or the fields that were wrong. */
const typedSpot = (body: Record<string, unknown>) => TypedForm.safeParse(body);

// ── Add ────────────────────────────────────────────────────────────────────

function newPickerPage(res: Response, status: number, view: View, note?: string): void {
  res
    .status(status)
    .type("html")
    .send(
      renderPicker({
        personName: teamPerson(res).name,
        title: t("new.title"),
        intro: t("new.intro"),
        back: { href: SITES_PATH, label: t("site.backToSites") },
        view,
        tapAction: PICK_PATH,
        moveAction: `${NEW_PATH}/map`,
        note,
        legend: t("new.private"),
      }),
    );
}

/** GET /api/team/sites/new: the map in place mode. Registered before /sites/:id. */
router.get(
  "/team/sites/new",
  requireTeam("add_feeding_site"),
  (_req: Request, res: Response) => {
    setTeamHeaders(res);
    newPickerPage(res, 200, viewAround(ISLAND_CENTRE, START_ZOOM));
  },
);

/** POST /api/team/sites/new/map: zoom, pan and the area buttons on the add page. */
router.post(
  "/team/sites/new/map",
  ...formRoute("add_feeding_site"),
  (req: Request, res: Response) => {
    const view = applyMove(req.body);
    if (!view) {
      return void newPickerPage(res, 400, viewAround(ISLAND_CENTRE, START_ZOOM), t("sites.moveNote"));
    }
    newPickerPage(res, 200, view);
  },
);

/** What a tap or typed position turned into. */
type Picked =
  | { ok: true; spot: Position; zoom: number; checkNote?: string }
  | { ok: false; status: 400; view: View; note: string; fields: string[] };

/** Reads the picker's form: a tap on the map, or typed coordinates. Never parses the tap itself. */
function readPick(body: Record<string, unknown>): Picked {
  if (Object.hasOwn(body, "lat") || Object.hasOwn(body, "lng")) {
    const typed = typedSpot(body);
    const here = viewAround(ISLAND_CENTRE, START_ZOOM);
    if (!typed.success) {
      return { ok: false, status: 400, view: here, note: t("sproblem.position"), fields: fieldsOf(typed.error) };
    }
    const spot = { lat: typed.data.lat, lng: typed.data.lng };
    if (!inIsland(spot)) {
      return { ok: false, status: 400, view: here, note: t("sproblem.outside"), fields: ["lat", "lng"] };
    }
    return { ok: true, spot, zoom: CONFIRM_ZOOM };
  }
  const tap = readTap(body);
  if (!tap.ok && tap.reason === "unreadable") {
    return {
      ok: false,
      status: 400,
      view: viewAround(ISLAND_CENTRE, START_ZOOM),
      note: t("sproblem.tapUnreadable"),
      fields: ["view"],
    };
  }
  if (!tap.ok) {
    return {
      ok: false,
      status: 400,
      view: clampView(tap.picture),
      note: tap.reason === "outside" ? t("sproblem.outside") : t("sproblem.tapNoPoint"),
      fields: ["x", "y"],
    };
  }
  return {
    ok: true,
    spot: tap.spot,
    zoom: Math.min(tap.picture.z + 2, MAX_ZOOM),
    // The same "Details for checking the tap" as the Map page (SYC-287's real-phone check).
    checkNote: `Point ${tap.point.x}, ${tap.point.y} on a ${tap.picture.size * 2} px map picture.`,
  };
}

/**
 * POST /api/team/sites/pick: a tap on the add page's map, or typed
 * coordinates. It answers with the confirmation page directly, so the spot
 * is in hidden fields only and never in an address (K13). A (0, 0) tap, a
 * spot outside Syros and an unreadable form are refused.
 */
router.post(
  "/team/sites/pick",
  ...formRoute("add_feeding_site"),
  async (req: Request, res: Response) => {
    const picked = readPick((req.body ?? {}) as Record<string, unknown>);
    if (!picked.ok) {
      if (!isFormPost(req)) return void res.status(400).json({ error: "Invalid request", fields: picked.fields });
      return void newPickerPage(res, picked.status, picked.view, picked.note);
    }
    if (!isFormPost(req)) return void res.json(picked.spot);
    res.type("html").send(
      renderAddConfirm({
        personName: teamPerson(res).name,
        spot: picked.spot,
        zoom: picked.zoom,
        colonies: await colonyOptions(),
        checkNote: picked.checkNote,
      }),
    );
  },
);

/**
 * POST /api/team/sites: save a new site (`add_feeding_site`). Always private:
 * no visibility field exists, and any `is_public` or `public_*` key sent is
 * ignored. Writes a `created` history row, and answers 303 to the new page.
 */
router.post(
  "/team/sites",
  ...formRoute("add_feeding_site"),
  async (req: Request, res: Response) => {
    const back = { href: NEW_PATH, label: t("sproblem.backToAdd") };
    const parsed = AddForm.safeParse(req.body ?? {});
    if (!parsed.success) return badForm(req, res, fieldsOf(parsed.error), back);
    const out = await addSite(teamPerson(res).id, {
      ...parsed.data,
      directions: parsed.data.directions ?? null,
      notes: parsed.data.notes ?? null,
    });
    switch (out.kind) {
      case "no_colony":
        return badForm(req, res, ["colonyId"], back);
      case "outside":
        return badForm(req, res, ["lat", "lng"], back, t("sproblem.outside"));
      case "created":
        if (isFormPost(req)) return void res.redirect(303, sitePath(out.id, "created"));
        return void res.status(201).json({ id: out.id });
    }
  },
);

// ── One site: details, colony, retire, bring back ──────────────────────────

/** Answers a conditional write: the same few outcomes for every route below. */
function answer(
  req: Request,
  res: Response,
  id: number,
  back: { href: string; label: string },
  out:
    | { kind: "missing" }
    | { kind: "stale" }
    | { kind: "no_colony" }
    | { kind: "outside" }
    | { kind: "unchanged" }
    | { kind: "saved"; madePrivate?: boolean; events?: number },
  done: { saved: string; madePrivate?: string },
): void {
  switch (out.kind) {
    case "missing":
      return notFound(req, res);
    case "stale":
      return stale(req, res, id);
    case "no_colony":
      return badForm(req, res, ["colonyId"], back);
    case "outside":
      return badForm(req, res, ["lat", "lng"], back, t("sproblem.outside"));
    case "unchanged":
      if (isFormPost(req)) return void res.redirect(303, sitePath(id, "unchanged"));
      return void res.json({ changed: 0 });
    case "saved":
      if (isFormPost(req)) {
        const key = out.madePrivate && done.madePrivate ? done.madePrivate : done.saved;
        return void res.redirect(303, sitePath(id, key));
      }
      return void res.json({ changed: out.events ?? 1, madePrivate: out.madePrivate ?? false });
  }
}

/** POST /api/team/sites/:id: name, notes and how to find it (`edit_feeding_site`). */
router.post(
  "/team/sites/:id",
  ...formRoute("edit_feeding_site"),
  async (req: Request, res: Response) => {
    const id = siteIdOf(req);
    if (id === null) return notFound(req, res);
    const back = { href: sitePath(id), label: t("sproblem.backToSite") };
    const parsed = EditForm.safeParse(req.body ?? {});
    if (!parsed.success) return badForm(req, res, fieldsOf(parsed.error), back);
    const { updatedAt, ...details } = parsed.data;
    const out = await editSite(teamPerson(res).id, id, updatedAt, details);
    answer(req, res, id, back, out, { saved: "saved" });
  },
);

/** POST /api/team/sites/:id/colony: put the site in another colony, or none (`reassign_feeding_site`). */
router.post(
  "/team/sites/:id/colony",
  ...formRoute("reassign_feeding_site"),
  async (req: Request, res: Response) => {
    const id = siteIdOf(req);
    if (id === null) return notFound(req, res);
    const back = { href: sitePath(id), label: t("sproblem.backToSite") };
    const parsed = ColonyForm.safeParse(req.body ?? {});
    if (!parsed.success) return badForm(req, res, fieldsOf(parsed.error), back);
    const out = await changeSiteColony(teamPerson(res).id, id, parsed.data.updatedAt, parsed.data.colonyId);
    answer(req, res, id, back, out, { saved: "colony", madePrivate: "colonyPrivate" });
  },
);

/** POST /api/team/sites/:id/retire: take the site off the map, with a reason (`edit_feeding_site`). */
router.post(
  "/team/sites/:id/retire",
  ...formRoute("edit_feeding_site"),
  async (req: Request, res: Response) => {
    const id = siteIdOf(req);
    if (id === null) return notFound(req, res);
    const back = { href: sitePath(id), label: t("sproblem.backToSite") };
    const parsed = ReasonForm.safeParse(req.body ?? {});
    if (!parsed.success) return badForm(req, res, fieldsOf(parsed.error), back);
    const out = await retireSite(teamPerson(res).id, id, parsed.data.updatedAt, parsed.data.reason);
    answer(req, res, id, back, out, { saved: "retired" });
  },
);

/** POST /api/team/sites/:id/restore: bring a retired site back, private, with a reason (`edit_feeding_site`). */
router.post(
  "/team/sites/:id/restore",
  ...formRoute("edit_feeding_site"),
  async (req: Request, res: Response) => {
    const id = siteIdOf(req);
    if (id === null) return notFound(req, res);
    const back = { href: sitePath(id), label: t("sproblem.backToSite") };
    const parsed = ReasonForm.safeParse(req.body ?? {});
    if (!parsed.success) return badForm(req, res, fieldsOf(parsed.error), back);
    const out = await restoreSite(teamPerson(res).id, id, parsed.data.updatedAt, parsed.data.reason);
    answer(req, res, id, back, out, { saved: "restored" });
  },
);

// ── Move ───────────────────────────────────────────────────────────────────

type MovingSite = NonNullable<Awaited<ReturnType<typeof siteForMove>>>;

function movePickerPage(
  res: Response,
  status: number,
  site: MovingSite,
  stamp: string,
  view: View,
  note?: string,
): void {
  const base = sitePath(site.id);
  res
    .status(status)
    .type("html")
    .send(
      renderPicker({
        personName: teamPerson(res).name,
        title: `${t("move.title")} ${site.name}`,
        intro: t("move.intro"),
        back: { href: base, label: t("sproblem.backToSite") },
        view,
        markers: [{ lat: site.lat, lng: site.lng, label: t("move.now"), look: "retired" }],
        tapAction: `${base}/move/pick`,
        moveAction: `${base}/move/map`,
        carry: { updatedAt: stamp },
        note,
        legend: t("move.legend"),
      }),
    );
}

/** GET /api/team/sites/:id/move: the picker, starting at the site. It reads the page's stamp as it opens. */
router.get(
  "/team/sites/:id/move",
  requireTeam("edit_feeding_site"),
  async (req: Request, res: Response) => {
    setTeamHeaders(res);
    const id = siteIdOf(req);
    const site = id === null ? null : await siteForMove(id);
    if (!site) return notFound(req, res);
    movePickerPage(res, 200, site, site.stamp, viewAround({ lat: site.lat, lng: site.lng }, SITE_ZOOM));
  },
);

/** POST /api/team/sites/:id/move/map: zoom, pan and the area buttons on the move page. */
router.post(
  "/team/sites/:id/move/map",
  ...formRoute("edit_feeding_site"),
  async (req: Request, res: Response) => {
    const id = siteIdOf(req);
    const site = id === null ? null : await siteForMove(id);
    if (id === null || !site) return notFound(req, res);
    const stamp = StampOnly.safeParse(req.body ?? {});
    if (!stamp.success) {
      return badForm(req, res, ["updatedAt"], { href: sitePath(id), label: t("sproblem.backToSite") });
    }
    const view = applyMove(req.body);
    if (!view) {
      return void movePickerPage(
        res,
        400,
        site,
        stamp.data.updatedAt,
        viewAround({ lat: site.lat, lng: site.lng }, SITE_ZOOM),
        t("sites.moveNote"),
      );
    }
    movePickerPage(res, 200, site, stamp.data.updatedAt, view);
  },
);

/**
 * POST /api/team/sites/:id/move/pick: a tap or typed coordinates on the move
 * page. Answers with the confirmation page directly: the old and new spots
 * and the required reason. Nothing is saved yet.
 */
router.post(
  "/team/sites/:id/move/pick",
  ...formRoute("edit_feeding_site"),
  async (req: Request, res: Response) => {
    const id = siteIdOf(req);
    const site = id === null ? null : await siteForMove(id);
    if (id === null || !site) return notFound(req, res);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const stamp = StampOnly.safeParse(body);
    if (!stamp.success) {
      return badForm(req, res, ["updatedAt"], { href: sitePath(id), label: t("sproblem.backToSite") });
    }
    const picked = readPick(body);
    if (!picked.ok) {
      if (!isFormPost(req)) return void res.status(400).json({ error: "Invalid request", fields: picked.fields });
      // Back on the site's own map, not the whole island.
      const view =
        picked.view.z === START_ZOOM
          ? viewAround({ lat: site.lat, lng: site.lng }, SITE_ZOOM)
          : picked.view;
      return void movePickerPage(res, picked.status, site, stamp.data.updatedAt, view, picked.note);
    }
    if (!isFormPost(req)) return void res.json(picked.spot);
    res.type("html").send(
      renderMoveConfirm({
        personName: teamPerson(res).name,
        site: { ...site, stamp: stamp.data.updatedAt },
        spot: picked.spot,
        zoom: picked.zoom,
        checkNote: picked.checkNote,
      }),
    );
  },
);

/** POST /api/team/sites/:id/move: save the move, with its reason (`edit_feeding_site`). */
router.post(
  "/team/sites/:id/move",
  ...formRoute("edit_feeding_site"),
  async (req: Request, res: Response) => {
    const id = siteIdOf(req);
    if (id === null) return notFound(req, res);
    const back = { href: `${SITES_PATH}/${id}/move`, label: t("sproblem.backToMove") };
    const parsed = MoveForm.safeParse(req.body ?? {});
    if (!parsed.success) return badForm(req, res, fieldsOf(parsed.error), back);
    const { updatedAt, lat, lng, reason } = parsed.data;
    const out = await moveSite(teamPerson(res).id, id, updatedAt, { lat, lng }, reason);
    answer(req, res, id, back, out, { saved: "moved", madePrivate: "movedPrivate" });
  },
);

/** GET /api/team/sites/:id: one site. Opening it is recorded (spec §8). */
router.get(
  "/team/sites/:id",
  requireTeam("view_exact_location"),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    setTeamHeaders(res);
    const raw = String(req.params["id"]);
    const site = ID_RE.test(raw) ? await siteView(Number(raw)) : null;
    if (!site) {
      if (wantsJson(req)) return void res.status(404).json({ error: "Not found" });
      return void res.status(404).type("html").send(renderNoSuchSite(person.name));
    }
    // One row: person, site, time. No position. Written before anything is
    // sent, outside any transaction, and FAIL-CLOSED on purpose: if the audit
    // record can't be written the error handler answers 500 and the person
    // gets no page. A HEAD request is not an opening (no body is shown), so
    // it writes nothing.
    if (req.method !== "HEAD") await recordSitePageRead(person.id, site.id);
    if (wantsJson(req)) return void res.json(site);
    res.type("html").send(
      renderSitePage({
        site,
        personName: person.name,
        view: viewAround({ lat: site.lat, lng: site.lng }, SITE_ZOOM),
        colonies: await colonyOptions(),
        done: typeof req.query["done"] === "string" ? req.query["done"] : undefined,
      }),
    );
  },
);

export default router;
