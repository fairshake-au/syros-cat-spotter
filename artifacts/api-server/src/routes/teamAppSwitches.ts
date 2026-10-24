import { Router, type IRouter, type Request, type Response } from "express";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { formRoute } from "./teamCorrections";
import { SwitchRefused, setDonateAddress, setFactShown, switchDonationOff, switchesNow } from "../lib/appSwitches";
import { renderAppSwitchesPage, APP_SWITCHES_DONE, APP_SWITCHES_PATH } from "../lib/teamPages/appSwitchesPage";

// The App switches page (SYC-383): the Help feed a cat button's address and
// the starter facts' Shown / Hidden. Team-only: `edit_app_switches` is
// island-only, so a cat guardian gets the 403 on every route here.

const router: IRouter = Router();

const wantsJson = (req: Request) => req.accepts(["html", "json"]) === "json";
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;

async function page(res: Response, status: number, extra: { again?: { typed: string; message: string }; done?: string }) {
  const now = await switchesNow();
  res.status(status).type("html").send(
    renderAppSwitchesPage({ personName: teamPerson(res).name, donateUrl: now.donateUrl, hidden: now.hidden, ...extra }),
  );
}

router.get("/team/app-switches", requireTeam("edit_app_switches"), async (req: Request, res: Response) => {
  setTeamHeaders(res); // before any await, so an error answer carries them too
  if (wantsJson(req)) {
    const now = await switchesNow();
    return void res.json({ donateUrl: now.donateUrl, hiddenFacts: [...now.hidden] });
  }
  const done = str(req.query["done"]);
  await page(res, 200, { done: Object.hasOwn(APP_SWITCHES_DONE, done) ? done : undefined });
});

router.post("/team/app-switches/donation", ...formRoute("edit_app_switches"), async (req: Request, res: Response) => {
  const turnOff = str(body(req)["do"]) === "off";
  const typed = str(body(req)["address"]);
  try {
    if (turnOff) await switchDonationOff();
    else await setDonateAddress(typed);
  } catch (err) {
    if (!(err instanceof SwitchRefused)) throw err;
    if (wantsJson(req)) return void res.status(400).json({ error: "bad_form", field: "address", message: err.message });
    return page(res, 400, { again: { typed, message: err.message } });
  }
  if (wantsJson(req)) return void res.json({ ok: true, donateUrl: (await switchesNow()).donateUrl });
  res.redirect(303, `${APP_SWITCHES_PATH}?done=${turnOff ? "off" : "on"}`);
});

router.post("/team/app-switches/fact", ...formRoute("edit_app_switches"), async (req: Request, res: Response) => {
  const id = str(body(req)["id"]);
  const raw = body(req)["shown"];
  // The form carries the state to move TO: "1" shows the fact, "0" hides it.
  const show = raw === true || raw === "1";
  if (!(raw === true || raw === false || raw === "1" || raw === "0")) {
    if (wantsJson(req)) return void res.status(400).json({ error: "bad_form", field: "shown" });
    return page(res, 400, {});
  }
  try {
    await setFactShown(id, show);
  } catch (err) {
    if (!(err instanceof SwitchRefused)) throw err;
    if (wantsJson(req)) return void res.status(400).json({ error: "bad_form", field: "id", message: err.message });
    return page(res, 400, {});
  }
  if (wantsJson(req)) return void res.json({ ok: true });
  res.redirect(303, `${APP_SWITCHES_PATH}?done=${show ? "shown" : "hidden"}#${encodeURIComponent(id)}`);
});

export default router;
