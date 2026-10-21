import { Router, type IRouter, type Request, type Response } from "express";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { formRoute } from "./teamCorrections";
import { PriceRefused, priceChanges, setStandardPrice, standardPriceNow, type PriceChange } from "../lib/vetSettings";
import { renderVetSettingsPage, VET_SETTINGS_DONE, VET_SETTINGS_PATH } from "../lib/teamPages/vetSettingsPage";

// The Vet settings page (SYC-396 PR 3.1b; dashboard §8.4, §10.3): the
// standard sterilisation price and its history, and the one form route that
// changes it. Team-only: `edit_vet_settings` is island-only, so a cat
// guardian gets the 403 on both.

const router: IRouter = Router();

const wantsJson = (req: Request) => req.accepts(["html", "json"]) === "json";
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The price as typed: whole euros, with an optional € sign. NaN otherwise, which setStandardPrice refuses. */
const typedEuros = (raw: string): number => {
  const s = raw.trim().replace(/^€\s*/, "");
  return /^\d{1,6}$/.test(s) ? Number(s) : Number.NaN;
};

/**
 * Draws the page. The history is read by the route itself, behind its door
 * (guardianView.source.test.ts holds every priceChanges() call to one).
 */
async function page(
  res: Response,
  status: number,
  history: PriceChange[],
  extra: { again?: { typed: string; message: string }; done?: string },
) {
  const person = teamPerson(res);
  res.status(status).type("html").send(
    renderVetSettingsPage({
      personName: person.name,
      priceEur: await standardPriceNow(),
      history,
      ...extra,
    }),
  );
}

router.get("/team/vet-settings", requireTeam("edit_vet_settings"), async (req: Request, res: Response) => {
  setTeamHeaders(res); // before any await, so an error answer carries them too
  if (wantsJson(req)) {
    return void res.json({ standardPriceEur: await standardPriceNow(), changes: await priceChanges() });
  }
  const done = str(req.query["done"]);
  await page(res, 200, await priceChanges(), { done: Object.hasOwn(VET_SETTINGS_DONE, done) ? done : undefined });
});

router.post("/team/vet-settings", ...formRoute("edit_vet_settings"), async (req: Request, res: Response) => {
  const person = teamPerson(res);
  const raw = ((req.body ?? {}) as Record<string, unknown>)["eur"];
  // A JSON client may send the number itself.
  const typed = typeof raw === "number" ? String(raw) : str(raw);
  try {
    await setStandardPrice(person, typedEuros(typed));
  } catch (err) {
    if (!(err instanceof PriceRefused)) throw err;
    if (wantsJson(req)) return void res.status(400).json({ error: "bad_form", field: "eur", message: err.message });
    return page(res, 400, await priceChanges(), { again: { typed, message: err.message } });
  }
  if (wantsJson(req)) return void res.json({ ok: true, standardPriceEur: await standardPriceNow() });
  res.redirect(303, `${VET_SETTINGS_PATH}?done=changed`);
});

export default router;
