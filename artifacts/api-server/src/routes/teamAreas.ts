import { Router, type IRouter, type Request, type Response } from "express";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { formRoute } from "./teamCorrections";
import { isIslandWide } from "../lib/guardianView";
import { areaChanges, type AreaChange as AreaChangeLine } from "../lib/areas/areaHistory";
import { AreaChangeRefused, changeArea, checkNewArea, MIN_AREAS, type AreaChange, type AreaField } from "../lib/areas/areaWrites";
import { SEED_AREAS } from "../lib/areas/seedAreas";
import { areaByKey, areasVersion, currentAreas, loadAreas, retiredAreas } from "../lib/areas/namedAreas";
import { loadTeamCats } from "../lib/teamCatList";
import { isActive } from "../lib/dashboard/countedCats";
import { renderConfirmPage } from "../lib/teamPages/confirm";
import { renderPage } from "../lib/teamPages/layout";
import { applyMove } from "../lib/mapTiles/mapForms";
import { viewAround, type View } from "../lib/mapTiles/geometry";
import { renderPicker } from "../lib/teamPages/siteFormPages";
import { renderCentreConfirm } from "../lib/teamPages/centrePages";
import { ERMOUPOLI_VIEW, readCentrePick } from "./centrePick";
import { t } from "../lib/teamPages/words";
import {
  AREAS_DONE,
  AREAS_PATH,
  renderAreasPage,
  type AreaFormAgain,
  type AreaRow,
} from "../lib/teamPages/areasPage";

// The Areas page (SYC-396 PR 2.4; dashboard §3.3): the team's named areas,
// and the one form route that changes them. Team-only: `edit_named_areas` is
// island-only, so a cat guardian gets the 403 on both. Positions travel only
// in the form body, never in an address.

const router: IRouter = Router();

const wantsJson = (req: Request) => req.accepts(["html", "json"]) === "json";
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A coordinate as typed: plain decimal numbers only (as teamForms.coordinate). */
const coordinate = (raw: string): number | null => {
  const s = raw.trim();
  return /^[+-]?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};

/** The areas with how many active cats are nearest each one (§9.5: through loadTeamCats). */
async function rows(): Promise<AreaRow[]> {
  const cats = (await loadTeamCats()).filter(isActive);
  const count = new Map<string, number>();
  for (const c of cats) count.set(c.areaKey, (count.get(c.areaKey) ?? 0) + 1);
  return busiestFirst(currentAreas().map((a) => ({ ...a, cats: count.get(a.key) ?? 0 })));
}

/** Most cats first, then by name (SYC-619 §4.2): the busy areas are at the top. */
export function busiestFirst(areas: readonly AreaRow[]): AreaRow[] {
  return [...areas].sort((a, b) => b.cats - a.cats || a.name.localeCompare(b.name, "en"));
}

/**
 * Draws the page. The history is read by the route itself, behind its door
 * (guardianView.source.test.ts holds every areaChanges() call to one).
 */
async function page(
  res: Response,
  status: number,
  history: AreaChangeLine[],
  extra: { again?: AreaFormAgain; done?: string },
) {
  const person = teamPerson(res);
  const areas = await rows();
  res.status(status).type("html").send(
    renderAreasPage({
      personName: person.name,
      link: isIslandWide(person),
      areas,
      retired: await retiredAreas(),
      version: areasVersion(),
      // The seed was the list's first version: its rows are the first SEED_AREAS.length changes.
      firstVersion: SEED_AREAS.length,
      history,
      ...extra,
    }),
  );
}

router.get("/team/areas", requireTeam("edit_named_areas"), async (req: Request, res: Response) => {
  setTeamHeaders(res); // before any await, so an error answer carries them too
  if (wantsJson(req)) {
    await loadAreas();
    return void res.json({ version: areasVersion(), areas: currentAreas(), changes: await areaChanges() });
  }
  const done = str(req.query["done"]);
  // Exact on this page, whatever another server changed in the last minute.
  await loadAreas();
  await page(res, 200, await areaChanges(), { done: Object.hasOwn(AREAS_DONE, done) ? done : undefined });
});

const DONE_OF: Record<AreaChange["kind"], string> = {
  add: "added",
  rename: "renamed",
  move: "moved",
  retire: "retired",
  restore: "restored",
};

router.post("/team/areas", ...formRoute("edit_named_areas"), async (req: Request, res: Response) => {
  const person = teamPerson(res);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const op = str(body["op"]);
  const key = str(body["key"]).trim();
  const values = { name: str(body["name"]), key: str(body["key"]), lat: str(body["lat"]), lng: str(body["lng"]) };

  const refuse = async (field: AreaField, message: string) => {
    if (wantsJson(req)) return void res.status(400).json({ error: "bad_form", field, message });
    const formOp = op === "add" || op === "rename" || op === "move" || op === "retire" || op === "restore" ? op : "add";
    await loadAreas();
    await page(res, 400, await areaChanges(), {
      again: { op: formOp, key: formOp === "add" ? undefined : key, field, message, values },
    });
  };

  // A move only ever comes from the map's confirmation (the page has no typed
  // move box), so a position it can't use is "off Syros", never "type a number".
  const offSyros = t("centre.off", undefined);
  // An add's position also only comes from the map's confirmation now (SYC-557).
  const mapped = op === "move" || op === "add";
  let change: AreaChange;
  if (op === "add" || op === "move") {
    const lat = coordinate(values.lat);
    const lng = coordinate(values.lng);
    if (lat === null) return refuse("lat", mapped ? offSyros : "Type the latitude as a number, like 37.44470.");
    if (lng === null) return refuse("lng", mapped ? offSyros : "Type the longitude as a number, like 24.94170.");
    change = op === "add" ? { kind: "add", key, name: values.name, lat, lng } : { kind: "move", key, lat, lng };
  } else if (op === "rename") {
    change = { kind: "rename", key, name: values.name };
  } else if (op === "restore") {
    change = { kind: "restore", key };
  } else if (op === "retire") {
    if (str(body["confirm"]) !== "1" && !wantsJson(req)) {
      // Always ask first, from the list as the database has it now: this
      // server's copy may not have seen an area another server just added
      // (review of #245, F1).
      await loadAreas();
      const area = currentAreas().find((a) => a.key === key);
      if (!area) return refuse("area", "There is no such area, or it has already been retired.");
      // Say so before asking "Are you sure?", not after (the writer checks again under its lock).
      if (currentAreas().length <= MIN_AREAS) {
        return refuse("area", `The island needs at least ${MIN_AREAS} areas, so ${area.name} can't be retired. Add another area first.`);
      }
      return void res.type("html").send(
        renderConfirmPage({
          title: `Retire ${area.name}?`,
          lines: [
            `${area.name} leaves the list. Its places go to the nearest area that's left, or Off Syros.`,
            "Older reports keep the version they used. It stays in the history.",
          ],
          action: AREAS_PATH,
          fields: { op: "retire", key },
          yes: `Yes, retire ${area.name}`,
          cancelHref: AREAS_PATH,
          cancelLabel: "Back to the areas",
          personName: person.name,
          active: null,
        }),
      );
    }
    change = { kind: "retire", key };
  } else {
    return refuse("area", "That form wasn't one this page sends. Try again from the page.");
  }

  try {
    await changeArea(person, change);
  } catch (err) {
    if (err instanceof AreaChangeRefused) {
      // The centre check's "Check the latitude" is for the Add form's typed boxes.
      return refuse(err.field, (change.kind === "move" || change.kind === "add") && err.offSyros ? offSyros : err.message);
    }
    throw err;
  }
  if (wantsJson(req)) return void res.json({ ok: true, version: areasVersion() });
  res.redirect(303, `${AREAS_PATH}?done=${DONE_OF[change.kind]}`);
});

// ── A new area, centre by tapping a map (SYC-557) ──────────────────────────
//
// Step 1 is the Add form's name and short key (checked here, nothing saved);
// step 2 is the map; step 3 is the confirmation, whose button posts `op=add`
// to the form route above with the position in hidden fields. The name and
// key ride along in hidden fields; never a position in an address.

const NEW_PATH = `${AREAS_PATH}/new`;

/** The name and key the Add form sent, if they pass the checks. Otherwise the page goes back with the problem. */
async function newAreaOf(
  req: Request,
  res: Response,
): Promise<{ key: string; name: string } | null> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const values = { name: str(body["name"]), key: str(body["key"]).trim() };
  try {
    return await checkNewArea(values.key, values.name);
  } catch (err) {
    if (!(err instanceof AreaChangeRefused)) throw err;
    await loadAreas();
    await page(res, 400, await areaChanges(), {
      again: { op: "add", field: err.field, message: err.message, values },
    });
    return null;
  }
}

function newAreaPickerPage(res: Response, status: number, a: { key: string; name: string }, view: View, note?: string): void {
  res
    .status(status)
    .type("html")
    .send(
      renderPicker({
        personName: teamPerson(res).name,
        active: null,
        title: `Where is ${a.name}?`,
        intro: `Tap the centre of ${a.name}. You will see the spot before anything is saved.`,
        back: { href: AREAS_PATH, label: "Back to the areas" },
        view,
        tapAction: `${NEW_PATH}/pick`,
        moveAction: `${NEW_PATH}/map`,
        carry: { name: a.name, key: a.key },
        note,
      }),
    );
}

router.post("/team/areas/new", ...formRoute("edit_named_areas"), async (req: Request, res: Response) => {
  const a = await newAreaOf(req, res);
  if (a) newAreaPickerPage(res, 200, a, ERMOUPOLI_VIEW);
});

router.post("/team/areas/new/map", ...formRoute("edit_named_areas"), async (req: Request, res: Response) => {
  const a = await newAreaOf(req, res);
  if (!a) return;
  const view = applyMove(req.body);
  if (!view) return void newAreaPickerPage(res, 400, a, ERMOUPOLI_VIEW, "That didn't work, so the map is back at the start.");
  newAreaPickerPage(res, 200, a, view);
});

router.post("/team/areas/new/pick", ...formRoute("edit_named_areas"), async (req: Request, res: Response) => {
  const a = await newAreaOf(req, res);
  if (!a) return;
  const person = teamPerson(res);
  const picked = readCentrePick((req.body ?? {}) as Record<string, unknown>, undefined, ERMOUPOLI_VIEW, {
    requireArea: false,
  });
  if (!picked.ok) {
    if (wantsJson(req)) return void res.status(400).json({ error: "Invalid request", fields: picked.fields });
    return void newAreaPickerPage(res, picked.status, a, picked.view, picked.note);
  }
  if (wantsJson(req)) return void res.json(picked.spot);
  res.type("html").send(
    renderCentreConfirm({
      personName: person.name,
      island: isIslandWide(person),
      active: null,
      title: `Where is ${a.name}?`,
      question: () => `Make this the centre of ${a.name}?`,
      saveLabel: "Add the area",
      spot: picked.spot,
      zoom: picked.zoom,
      nowLabel: "",
      newLabel: `The centre of ${a.name}`,
      tapAction: `${NEW_PATH}/pick`,
      carry: { name: a.name, key: a.key },
      saveAction: AREAS_PATH,
      saveFields: { op: "add", name: a.name, key: a.key },
      back: { href: AREAS_PATH, label: "Back to the areas" },
    }),
  );
});

// ── An area's centre, by tapping a map (SYC-517, 517-B) ────────────────────
//
// The same three steps as a colony's centre, for the team only. Nothing here
// writes: the confirmation's button posts `op=move` to the form route above,
// with the position in hidden fields. Never in an address.

const KEY_RE = /^[a-z0-9-]{1,40}$/;
const AREA_ZOOM = 14;

/** The area these pages are for (as the database has it now), or null. */
async function areaOf(req: Request): Promise<{ key: string; name: string; lat: number; lng: number } | null> {
  const key = String(req.params["key"]);
  if (!KEY_RE.test(key)) return null;
  await loadAreas();
  return areaByKey(key) ?? null;
}

const centreAreaStart = (a: { lat: number; lng: number }): View => viewAround(a, AREA_ZOOM);

function noSuchArea(res: Response): void {
  res
    .status(404)
    .type("html")
    .send(
      renderPage({
        title: "No such area",
        active: null,
        personName: teamPerson(res).name,
        body: `<p>There is no such area, or it has been retired.</p><p><a class="tap" href="${AREAS_PATH}">Back to the areas</a></p>`,
      }),
    );
}

function areaPickerPage(
  res: Response,
  status: number,
  a: { key: string; name: string; lat: number; lng: number },
  view: View,
  note?: string,
): void {
  const base = `${AREAS_PATH}/${a.key}/centre`;
  res
    .status(status)
    .type("html")
    .send(
      renderPicker({
        personName: teamPerson(res).name,
        active: null,
        title: `Move the centre of ${a.name}`,
        intro: "Tap where the centre of this area should be. You will see the spot before anything is saved.",
        back: { href: AREAS_PATH, label: "Back to the areas" },
        view,
        markers: [{ lat: a.lat, lng: a.lng, label: "The centre now", look: "retired" }],
        tapAction: `${base}/pick`,
        moveAction: `${base}/map`,
        note,
      }),
    );
}

router.get("/team/areas/:key/centre", requireTeam("edit_named_areas"), async (req: Request, res: Response) => {
  setTeamHeaders(res);
  const a = await areaOf(req);
  if (!a) return noSuchArea(res);
  areaPickerPage(res, 200, a, centreAreaStart(a));
});

router.post("/team/areas/:key/centre/map", ...formRoute("edit_named_areas"), async (req: Request, res: Response) => {
  const a = await areaOf(req);
  if (!a) return noSuchArea(res);
  const view = applyMove(req.body);
  if (!view) return void areaPickerPage(res, 400, a, centreAreaStart(a), "That didn't work, so the map is back on this area.");
  areaPickerPage(res, 200, a, view);
});

router.post("/team/areas/:key/centre/pick", ...formRoute("edit_named_areas"), async (req: Request, res: Response) => {
  const a = await areaOf(req);
  if (!a) return noSuchArea(res);
  const person = teamPerson(res);
  const picked = readCentrePick((req.body ?? {}) as Record<string, unknown>, undefined, centreAreaStart(a), {
    requireArea: false,
  });
  if (!picked.ok) {
    if (wantsJson(req)) return void res.status(400).json({ error: "Invalid request", fields: picked.fields });
    return void areaPickerPage(res, picked.status, a, picked.view, picked.note);
  }
  if (wantsJson(req)) return void res.json(picked.spot);
  const base = `${AREAS_PATH}/${a.key}/centre`;
  res.type("html").send(
    renderCentreConfirm({
      personName: person.name,
      island: isIslandWide(person),
      active: null,
      title: `Move the centre of ${a.name}`,
      question: () => `Move the centre of ${a.name} here?`,
      saveLabel: "Move the centre here",
      spot: picked.spot,
      zoom: picked.zoom,
      now: a,
      nowInWords: false,
      nowLabel: "The centre now",
      newLabel: "The new centre",
      tapAction: `${base}/pick`,
      saveAction: AREAS_PATH,
      saveFields: { op: "move", key: a.key },
      back: { href: `${base}`, label: "Start again on this area's map" },
    }),
  );
});

export default router;
