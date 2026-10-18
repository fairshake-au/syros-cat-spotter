import { Router, type IRouter, type Request, type Response } from "express";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { formRoute } from "./teamCorrections";
import { isIslandWide } from "../lib/guardianView";
import { areaChanges, type AreaChange as AreaChangeLine } from "../lib/areas/areaHistory";
import { AreaChangeRefused, changeArea, type AreaChange, type AreaField } from "../lib/areas/areaWrites";
import { areasVersion, currentAreas, loadAreas } from "../lib/areas/namedAreas";
import { loadTeamCats } from "../lib/teamCatList";
import { isActive } from "../lib/dashboard/countedCats";
import { renderConfirmPage } from "../lib/teamPages/confirm";
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
  return currentAreas().map((a) => ({ ...a, cats: count.get(a.key) ?? 0 }));
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
      version: areasVersion(),
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
};

router.post("/team/areas", ...formRoute("edit_named_areas"), async (req: Request, res: Response) => {
  const person = teamPerson(res);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const op = str(body["op"]);
  const key = str(body["key"]).trim();
  const values = { name: str(body["name"]), key: str(body["key"]), lat: str(body["lat"]), lng: str(body["lng"]) };

  const refuse = async (field: AreaField, message: string) => {
    if (wantsJson(req)) return void res.status(400).json({ error: "bad_form", field, message });
    const formOp = op === "add" || op === "rename" || op === "move" || op === "retire" ? op : "add";
    await loadAreas();
    await page(res, 400, await areaChanges(), {
      again: { op: formOp, key: formOp === "add" ? undefined : key, field, message, values },
    });
  };

  let change: AreaChange;
  if (op === "add" || op === "move") {
    const lat = coordinate(values.lat);
    const lng = coordinate(values.lng);
    if (lat === null) return refuse("lat", "Type the latitude as a number, like 37.44470.");
    if (lng === null) return refuse("lng", "Type the longitude as a number, like 24.94170.");
    change = op === "add" ? { kind: "add", key, name: values.name, lat, lng } : { kind: "move", key, lat, lng };
  } else if (op === "rename") {
    change = { kind: "rename", key, name: values.name };
  } else if (op === "retire") {
    const area = currentAreas().find((a) => a.key === key);
    if (area && str(body["confirm"]) !== "1" && !wantsJson(req)) {
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
    if (err instanceof AreaChangeRefused) return refuse(err.field, err.message);
    throw err;
  }
  if (wantsJson(req)) return void res.json({ ok: true, version: areasVersion() });
  res.redirect(303, `${AREAS_PATH}?done=${DONE_OF[change.kind]}`);
});

export default router;
