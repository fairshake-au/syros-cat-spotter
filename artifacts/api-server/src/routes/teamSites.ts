import { Router, type IRouter, type Request, type Response } from "express";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { formRoute } from "./teamCorrections";
import { ISLAND_CENTRE, START_ZOOM } from "../lib/teamPages/map";
import { viewAround, type View } from "../lib/mapTiles/geometry";
import { applyMove } from "../lib/mapTiles/mapForms";
import {
  listSites,
  recentSiteChanges,
  recordSitePageRead,
  siteCounts,
  siteView,
} from "../lib/teamSites";
import { renderNoSuchSite, renderSitePage, renderSitesPage } from "../lib/teamPages/sitePages";
import { t } from "../lib/teamPages/words";

// The team's Feeding sites pages, read-only (SYC-209 PR 3.2; spec §2.1, §2.2,
// §8; plan K13, Decision 1A). PR 3.3 adds the writes.
//
// **Permissions (plan Decision 1A).** Every route asks for
// `view_exact_location` with NO colony target, so a guardian gets the 403
// until PR 4.1 switches targets and filters on together. `canSomewhere` is
// the sign-in door's alone.
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
    await sitesPage(res, 200, viewAround(ISLAND_CENTRE, START_ZOOM), showRetired);
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
    // One row: person, site, time. No position.
    await recordSitePageRead(person.id, site.id);
    if (wantsJson(req)) return void res.json(site);
    res.type("html").send(
      renderSitePage({
        site,
        personName: person.name,
        view: viewAround({ lat: site.lat, lng: site.lng }, SITE_ZOOM),
      }),
    );
  },
);

export default router;
