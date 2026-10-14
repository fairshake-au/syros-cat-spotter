import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { mapTileLimiter } from "../middlewares/rateLimit";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { formRoute } from "./teamCorrections";
import { renderPage } from "../lib/teamPages/layout";
import { renderMap, type MapMarker } from "../lib/teamPages/map";
import { escapeHtml as esc } from "../lib/teamPages/escape";
import {
  clampView,
  inIsland,
  isTileAllowed,
  MAX_ZOOM,
  pan,
  tapToPosition,
  viewAround,
  zoomIn,
  zoomOut,
  type Position,
  type View,
} from "../lib/mapTiles/geometry";
import { areaByKey, AREAS } from "../lib/mapTiles/areas";
import { readTileToken } from "../lib/mapTiles/tileToken";
import { getTilePng, pictureAtSize } from "../lib/mapTiles/tileCache";

// The team's map (SYC-209 PR 3.1; feeding-sites spec §3, §11.4; plan K4,
// K13). PR 3.2 puts the feeding sites on it, PR 3.3 uses its tap to place
// one; this PR is the map itself and where its pictures come from.
//
// **Permissions (plan Decision 1A).** Every route asks for
// `view_exact_location` with NO colony target, so once the roles plan makes
// can() strict, a guardian is refused here until PR 4.1 (and SYC-53 PR 0.5's
// canSomewhere for the tile route) switches targets on.
//
// **No position in any address (K13).** The picture route takes an opaque
// token, never z/x/y. Zoom, pan, the area buttons and every tap are POST
// forms with hidden fields, so no position reaches an address bar, the
// browser's history, the hosting provider's edge logs or our own.

const router: IRouter = Router();

const isFormPost = (req: Request) =>
  Boolean(req.is("application/x-www-form-urlencoded"));

/** A whole number written plainly (no "1e3", no "0x10", no spaces). */
const wholeNumber = z.string().regex(/^-?\d{1,10}$/).transform(Number);

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
      "The red ring marks the spot." +
      (extra.pictureNote ? ` <span class="meta">${esc(extra.pictureNote)}</span>` : "") +
      "</p>"
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

const MoveForm = z.object({
  vz: wholeNumber,
  vx: wholeNumber,
  vy: wholeNumber,
  go: z.enum(["in", "out", "north", "south", "east", "west"]).optional(),
  area: z.enum(AREAS.map((a) => a.key) as [string, ...string[]]).optional(),
});

/**
 * POST /api/team/map: zoom, pan, or jump to an area. The current view comes
 * in hidden fields; one that isn't over Syros is pulled back over it.
 */
router.post(
  "/team/map",
  ...formRoute("view_exact_location"),
  (req: Request, res: Response) => {
    const parsed = MoveForm.safeParse(req.body);
    if (!parsed.success) {
      return void mapPage(res, 400, viewAround(ISLAND_CENTRE, START_ZOOM), {
        note: "That didn't work, so the map is back at the whole island.",
      });
    }
    const f = parsed.data;
    let view = clampView({ z: f.vz, x: f.vx, y: f.vy });
    const area = areaByKey(f.area);
    if (area) view = viewAround(area, area.zoom);
    else if (f.go === "in") view = zoomIn(view);
    else if (f.go === "out") view = zoomOut(view);
    else if (f.go === "north") view = pan(view, 0, -1);
    else if (f.go === "south") view = pan(view, 0, 1);
    else if (f.go === "east") view = pan(view, 1, 0);
    else if (f.go === "west") view = pan(view, -1, 0);
    mapPage(res, 200, view);
  },
);

const TapForm = z.object({
  tile: z.string().max(100),
  size: wholeNumber,
  // An image button posts the point tapped as x and y (no name on the button).
  x: wholeNumber,
  y: wholeNumber,
});

/**
 * POST /api/team/map/tap: a tap on a picture. The form carries the picture's
 * token and the size it was drawn at; the browser adds the point. The size
 * must be the one the token was made for, so a picture is always converted
 * at the scale it was tapped at. A spot outside Syros is refused.
 */
router.post(
  "/team/map/tap",
  ...formRoute("view_exact_location"),
  (req: Request, res: Response) => {
    const parsed = TapForm.safeParse(req.body);
    const ref = parsed.success ? readTileToken(parsed.data.tile) : null;
    if (!parsed.success || !ref || ref.size !== parsed.data.size || !isTileAllowed(ref)) {
      return void mapPage(res, 400, viewAround(ISLAND_CENTRE, START_ZOOM), {
        note: "That tap couldn't be read (the page may have been open for more than a day), so the map is back at the whole island. Nothing was picked.",
      });
    }
    const here: View = clampView({ z: ref.z, x: ref.x, y: ref.y });
    // (0, 0) is what a browser sends when the picture never loaded, or when
    // the button is pressed from the keyboard: not a place anyone tapped.
    // Taking it would put the spot on the picture's corner without a word.
    if (parsed.data.x === 0 && parsed.data.y === 0) {
      return void mapPage(res, 400, here, {
        note: "That tap didn't say where on the map it was. This happens when a map picture hasn't loaded, or when it's chosen with the keyboard. Nothing was picked: tap the map itself.",
      });
    }
    const spot = tapToPosition(ref, ref.size, parsed.data.x, parsed.data.y);
    if (!spot || !inIsland(spot)) {
      return void mapPage(res, 400, here, {
        note: "That spot is outside Syros, so it can't be picked.",
      });
    }
    if (!isFormPost(req)) return void res.json(spot);
    mapPage(res, 200, viewAround(spot, Math.min(ref.z + TAP_ZOOM_STEP, MAX_ZOOM)), {
      tapped: spot,
      pictureNote: `(Point ${parsed.data.x}, ${parsed.data.y} on a ${ref.size} px picture.)`,
    });
  },
);

/**
 * GET /api/team/map-tiles/:tile: one map picture. `:tile` is a token (see
 * lib/mapTiles/tileToken.ts), never z/x/y. Refused, without fetching
 * anything, unless it names a picture on Syros at zoom 12–19 at a size the
 * map draws.
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
    if (!ref || !isTileAllowed(ref)) {
      return void res.status(404).json({ error: "Not found" });
    }
    const png = await getTilePng(ref);
    if (!png) {
      req.log.warn({ reason: "tile_unavailable" }, "map picture unavailable");
      return void res.status(503).json({ error: "Map picture unavailable" });
    }
    const body = await pictureAtSize(png, ref.size);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.type("png").send(body);
  },
);

export default router;
