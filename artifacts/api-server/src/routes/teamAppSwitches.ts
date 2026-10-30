import { Router, type IRouter, type Request, type Response } from "express";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { formRoute } from "./teamCorrections";
import { SwitchRefused, setDonateAddress, setDuplicateSweep, setExtraPhotos, setFactShown, switchDonationOff, switchesNow } from "../lib/appSwitches";
import { renderAppSwitchesPage, APP_SWITCHES_DONE, APP_SWITCHES_PATH } from "../lib/teamPages/appSwitchesPage";
import { renderConfirmPage } from "../lib/teamPages/confirm";

// The App switches page (SYC-383): the Help feed a cat button's address, the
// extra photo boxes' On / Off (SYC-415), the look-alike sweep's On / Off (SYC-59 PR 5.3) and the starter facts' Shown / Hidden. Team-only: `edit_app_switches` is
// island-only, so a cat guardian gets the 403 on every route here.

const router: IRouter = Router();

const wantsJson = (req: Request) => req.accepts(["html", "json"]) === "json";
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;

async function page(res: Response, status: number, extra: { again?: { typed: string; message: string }; done?: string }) {
  const now = await switchesNow();
  res.status(status).type("html").send(
    renderAppSwitchesPage({
      personName: teamPerson(res).name,
      donateUrl: now.donateUrl,
      hidden: now.hidden,
      extraPhotosOn: now.extraPhotosOn,
      duplicateSweepOn: now.duplicateSweepOn,
      ...extra,
    }),
  );
}

router.get("/team/app-switches", requireTeam("edit_app_switches"), async (req: Request, res: Response) => {
  setTeamHeaders(res); // before any await, so an error answer carries them too
  if (wantsJson(req)) {
    const now = await switchesNow();
    return void res.json({ donateUrl: now.donateUrl, hiddenFacts: [...now.hidden], extraPhotosOn: now.extraPhotosOn, duplicateSweepOn: now.duplicateSweepOn });
  }
  const done = str(req.query["done"]);
  await page(res, 200, { done: Object.hasOwn(APP_SWITCHES_DONE, done) ? done : undefined });
});

router.post("/team/app-switches/donation", ...formRoute("edit_app_switches"), async (req: Request, res: Response) => {
  const turnOff = str(body(req)["do"]) === "off";
  const typed = str(body(req)["address"]);
  // Turning off reaches every visitor, so the page asks first (SYC-738).
  // Turning on stays one tap. The JSON route acts in one step, as before.
  if (turnOff && str(body(req)["confirm"]) !== "1" && !wantsJson(req)) {
    return void res.type("html").send(
      renderConfirmPage({
        title: "Turn the Help feed a cat button off?",
        lines: [
          "The Help feed a cat button disappears for every visitor within a couple of minutes, the next time they open the app.",
          "Visitors still see the words about feeding, with no button and no figures.",
          "You can turn it back on here.",
        ],
        action: `${APP_SWITCHES_PATH}/donation`,
        fields: { do: "off" },
        yes: "Yes, turn the button off",
        cancelHref: APP_SWITCHES_PATH,
        cancelLabel: "Back to App switches",
        personName: teamPerson(res).name,
        active: "settings",
      }),
    );
  }
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

// Both ways are one tap: turning the boxes off loses nothing already sent.
router.post("/team/app-switches/extra-photos", ...formRoute("edit_app_switches"), async (req: Request, res: Response) => {
  const raw = body(req)["on"];
  // The form carries the state to move TO: "1" turns the boxes on, "0" off.
  if (!(raw === true || raw === false || raw === "1" || raw === "0")) {
    if (wantsJson(req)) return void res.status(400).json({ error: "bad_form", field: "on" });
    return page(res, 400, {});
  }
  const on = raw === true || raw === "1";
  await setExtraPhotos(on);
  if (wantsJson(req)) return void res.json({ ok: true, extraPhotosOn: on });
  res.redirect(303, `${APP_SWITCHES_PATH}?done=${on ? "photosOn" : "photosOff"}#extra-photos`);
});

// Both ways are one tap: turning the sweep off only stops new reports; the ones written stay on the list.
router.post("/team/app-switches/duplicate-sweep", ...formRoute("edit_app_switches"), async (req: Request, res: Response) => {
  const raw = body(req)["on"];
  if (!(raw === true || raw === false || raw === "1" || raw === "0")) {
    if (wantsJson(req)) return void res.status(400).json({ error: "bad_form", field: "on" });
    return page(res, 400, {});
  }
  const on = raw === true || raw === "1";
  await setDuplicateSweep(on);
  if (wantsJson(req)) return void res.json({ ok: true, duplicateSweepOn: on });
  res.redirect(303, `${APP_SWITCHES_PATH}?done=${on ? "sweepOn" : "sweepOff"}#duplicate-sweep`);
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
