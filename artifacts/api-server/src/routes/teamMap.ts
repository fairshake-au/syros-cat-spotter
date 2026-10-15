import { Router, type IRouter, type Request, type Response } from "express";
import { mapTileLimiter } from "../middlewares/rateLimit";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { formRoute } from "./teamCorrections";
import { renderPage } from "../lib/teamPages/layout";
import { renderMap, type MapMarker } from "../lib/teamPages/map";
import { escapeHtml as esc } from "../lib/teamPages/escape";
import {
  clampView,
  isViewAllowed,
  MAX_ZOOM,
  viewAround,
  type Position,
  type View,
} from "../lib/mapTiles/geometry";
import { applyMove, readTap } from "../lib/mapTiles/mapForms";
import { readTileToken } from "../lib/mapTiles/tileToken";
import { mosaicPicture } from "../lib/mapTiles/tileCache";

// The team's map (SYC-209 PR 3.1; feeding-sites spec §3, §11.4; plan K4,
// K13). PR 3.2 puts the feeding sites on it, PR 3.3 uses its tap to place
// one; this PR is the map itself and where its pictures come from.
//
// **Permissions (plan Decision 1A).** Every route asks for
// `view_exact_location` with NO colony target, so once the roles plan makes
// can() strict, a guardian is refused here until PR 4.1 switches targets on.
// Not canSomewhere ("for any colony?"), which the plan once named for the
// picture route: on a route it would show a guardian the whole island. In
// SYC-53 PR 0.5 only the sign-in door may call it (agreed with that session).
//
// **No position in any address (K13).** The picture route takes an opaque
// token, never z/x/y. Zoom, pan, the area buttons and every tap are POST
// forms with hidden fields, so no position reaches an address bar, the
// browser's history, the hosting provider's edge logs or our own.

const router: IRouter = Router();

const isFormPost = (req: Request) =>
  Boolean(req.is("application/x-www-form-urlencoded"));

/** Where the map opens: the middle of the island, zoom 12. */
const ISLAND_CENTRE: Position = { lat: 37.445, lng: 24.93 };
const START_ZOOM = 12;
/** A tap on the Map page zooms in this many steps around the spot. */
const TAP_ZOOM_STEP = 2;

const fmt = (n: number) => n.toFixed(5);

function mapPage(
  res: Response,
  status: number,
  view: View,
  extra: { tapped?: Position; note?: string; pictureNote?: string } = {},
): void {
  const markers: MapMarker[] = extra.tapped
    ? [{ ...extra.tapped, label: "The spot you tapped" }]
    : [];
  const tapped = extra.tapped
    ? `<p class="tapped">You tapped <strong>${fmt(extra.tapped.lat)}, ${fmt(extra.tapped.lng)}</strong>. ` +
      "The red ring marks the spot.</p>" +
      (extra.pictureNote
        ? `<details class="checkdetails"><summary>Details for checking the tap</summary><p class="meta">${esc(extra.pictureNote)}</p></details>`
        : "")
    : "";
  const note = extra.note ? `<p class="warn">${esc(extra.note)}</p>` : "";
  res
    .status(status)
    .type("html")
    .send(
      renderPage({
        title: "Map",
        active: "map",
        personName: teamPerson(res).name,
        mainClass: "mappage",
        body:
          renderMap({ view, markers, mode: "place" }) +
          note +
          tapped +
          '<p class="hint">Tap the map to look closer: it zooms in around the spot and marks it. ' +
          "This map is only for the team. Our server fetches the map pictures, so your browser " +
          "never tells a map company where you are looking.</p>",
      }),
    );
}

/** GET /api/team/map: the island. */
router.get(
  "/team/map",
  requireTeam("view_exact_location"),
  (_req: Request, res: Response) => {
    setTeamHeaders(res);
    mapPage(res, 200, viewAround(ISLAND_CENTRE, START_ZOOM));
  },
);

/**
 * POST /api/team/map: zoom, pan, or jump to an area. The current view comes
 * in hidden fields; one that isn't over Syros is pulled back over it.
 */
router.post(
  "/team/map",
  ...formRoute("view_exact_location"),
  (req: Request, res: Response) => {
    const view = applyMove(req.body);
    if (!view) {
      return void mapPage(res, 400, viewAround(ISLAND_CENTRE, START_ZOOM), {
        note: "That didn't work, so the map is back at the whole island.",
      });
    }
    mapPage(res, 200, view);
  },
);

/**
 * POST /api/team/map/tap: a tap on the map picture (lib/mapTiles/mapForms.ts
 * reads it). The Map page zooms in around the spot and marks it. A spot
 * outside Syros, a (0, 0) "tap" and an unreadable form are refused.
 */
router.post(
  "/team/map/tap",
  ...formRoute("view_exact_location"),
  (req: Request, res: Response) => {
    const tap = readTap(req.body);
    if (!tap.ok && tap.reason === "unreadable") {
      return void mapPage(res, 400, viewAround(ISLAND_CENTRE, START_ZOOM), {
        note: "That tap couldn't be read (the page may have been open for more than a day), so the map is back at the whole island. Nothing was picked.",
      });
    }
    if (!tap.ok) {
      const here: View = clampView(tap.picture);
      return void mapPage(res, 400, here, {
        note:
          tap.reason === "outside"
            ? "That spot is outside Syros, so it can't be picked."
            : "That tap didn't say where on the map it was. This happens when the map picture hasn't loaded, or when it's chosen with the keyboard. Nothing was picked: tap the map itself.",
      });
    }
    if (!isFormPost(req)) return void res.json(tap.spot);
    mapPage(res, 200, viewAround(tap.spot, Math.min(tap.picture.z + TAP_ZOOM_STEP, MAX_ZOOM)), {
      tapped: tap.spot,
      pictureNote: `Point ${tap.point.x}, ${tap.point.y} on a ${tap.picture.size * 2} px map picture.`,
    });
  },
);

/**
 * GET /api/team/map-tiles/:tile: one map picture, the 2×2 tiles of a view
 * joined at one band's size. `:tile` is a token (see
 * lib/mapTiles/tileToken.ts), never z/x/y. Refused, without fetching
 * anything, unless it names a view on Syros at zoom 12–19 at a size the map
 * draws.
 *
 * Pictures are the one stated exception to the dashboard's `no-store`:
 * `private, max-age=86400`, never `public`, so a shared cache can never hand
 * a session-gated picture to someone else. Every refusal or error stays
 * `no-store`.
 */
router.get(
  "/team/map-tiles/:tile",
  requireTeam("view_exact_location"),
  (_req: Request, res: Response, next: () => void) => {
    setTeamHeaders(res); // no-store until there is a picture to send, a 429 included
    next();
  },
  mapTileLimiter,
  async (req: Request, res: Response) => {
    const ref = readTileToken(req.params["tile"]);
    if (!ref || !isViewAllowed(ref)) {
      return void res.status(404).json({ error: "Not found" });
    }
    const body = await mosaicPicture(ref, ref.size);
    if (!body) {
      req.log.warn({ reason: "tile_unavailable" }, "map picture unavailable");
      return void res.status(503).json({ error: "Map picture unavailable" });
    }
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.type("png").send(body);
  },
);

export default router;
