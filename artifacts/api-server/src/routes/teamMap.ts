import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { mapSquareLimiter, mapSquareTokensLimiter, mapTileLimiter } from "../middlewares/rateLimit";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { requireSeeing } from "../middlewares/requireSeeing";
import { formRoute } from "./teamCorrections";
import { renderPage } from "../lib/teamPages/layout";
import { ISLAND_CENTRE, renderMap, START_ZOOM, type MapMarker } from "../lib/teamPages/map";
import { escapeHtml as esc } from "../lib/teamPages/escape";
import { place } from "../lib/teamPages/position";
import { isIslandWide } from "../lib/guardianView";
import {
  clampView,
  isTileAllowed,
  isViewAllowed,
  MAX_ZOOM,
  MIN_ZOOM,
  viewAround,
  type Position,
  type View,
} from "../lib/mapTiles/geometry";
import { applyMove, readTap } from "../lib/mapTiles/mapForms";
import { mintSquareToken, readSquareToken, readTileToken } from "../lib/mapTiles/tileToken";
import { getTilePng, mosaicPicture } from "../lib/mapTiles/tileCache";

// The team's map (SYC-209 PR 3.1; feeding-sites spec §3, §11.4; plan K4,
// K13). PR 3.2 puts the feeding sites on it, PR 3.3 uses its tap to place
// one; this PR is the map itself and where its pictures come from.
//
// **Permissions (plan Decision 1A; PR 4.1).** The Map page, its moves and its
// tap ask for `view_exact_location` with NO colony target: it is the team's
// own map (and the real-phone tap check, SYC-287), so a cat guardian gets the
// 403 there. The picture route lets in anyone who sees some colony
// (`requireSeeing`): a cat guardian's Feeding sites and site pages draw their
// maps from it. A picture is the map of the island only, never a site, a
// marker or a position of ours (spec §7.3: "a tile reveals nothing; it still
// needs a session and the capability"), and its address is an opaque token.
// Not the door's "for any colony?" check, which the plan once named for the
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

/** A tap on the Map page zooms in this many steps around the spot. */
const TAP_ZOOM_STEP = 2;


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
    ? // Open map only for an island-wide viewer (D9, SYC-395).
      `<p class="tapped">You tapped a spot in <strong>${place(extra.tapped.lat, extra.tapped.lng, { link: isIslandWide(teamPerson(res)) })}</strong>. ` +
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
        active: null,
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
  ...requireSeeing(),
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
    const picture = await mosaicPicture(ref, ref.size);
    if (!picture) {
      req.log.warn({ reason: "tile_unavailable" }, "map picture unavailable");
      return void res.status(503).json({ error: "Map picture unavailable" });
    }
    // A picture with a blank quarter stays no-store, so a reload in the same
    // hour (same address) picks up the tile once the server has it.
    if (picture.complete) res.setHeader("Cache-Control", "private, max-age=86400");
    res.type("png").send(picture.png);
  },
);

// ── The island map's squares (SYC-396 PR 1.5; spec §6.3) ───────────────────
//
// The draggable map on the Cats page (?view=map) needs one picture per map
// square, not a 2×2 picture. Positions still never reach an address:
// 1. the page asks, in a signed-in POST, for the squares it can see
//    (square numbers in the BODY, never a latitude or longitude, and never in
//    the address);
// 2. the server answers with a token for each square on Syros;
// 3. the map fetches each square by its token alone.
// Both are team-only (view_exact_location with no target): the Map is the
// team's in phase 1, so a cat guardian gets the 403 (spec §10.2 gives her a
// map of her own colonies later). The request log redacts the square's
// address (lib/logger.ts MAP_TILE_IN_PATH), and each person may fetch at
// most 300 squares in 10 minutes (middlewares/rateLimit.ts mapSquareLimiter).

/** Squares in one token request. A 2560 px wide screen asks in two. */
export const MAX_SQUARES_PER_CALL = 64;

const SquareNumber = z.number().int().min(0).max(2 ** MAX_ZOOM - 1);
/** Square numbers only: anything else, a lat or lng included, is refused. */
const SquaresRequest = z
  .object({
    z: z.number().int().min(MIN_ZOOM).max(MAX_ZOOM),
    xMin: SquareNumber,
    xMax: SquareNumber,
    yMin: SquareNumber,
    yMax: SquareNumber,
  })
  .strict()
  .refine((r) => r.xMin <= r.xMax && r.yMin <= r.yMax);

/**
 * POST /api/team/map-squares: `{ z, xMin, xMax, yMin, yMax }` (JSON) to
 * `{ tokens: { "z/x/y": token } }`, for the squares in that range that are on
 * Syros only. More than 64 squares in one call is refused whole (400), so
 * the answer never depends on which 64 were picked. `no-store`, like every
 * dashboard answer.
 */
router.post(
  "/team/map-squares",
  ...formRoute("view_exact_location"),
  mapSquareTokensLimiter,
  (req: Request, res: Response) => {
    const parsed = SquaresRequest.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: "bad_request" });
    const { z: zoom, xMin, xMax, yMin, yMax } = parsed.data;
    if ((xMax - xMin + 1) * (yMax - yMin + 1) > MAX_SQUARES_PER_CALL) {
      return void res.status(400).json({ error: "too_many_squares" });
    }
    const tokens: Record<string, string> = {};
    for (let x = xMin; x <= xMax; x++)
      for (let y = yMin; y <= yMax; y++) {
        const square = { z: zoom, x, y };
        if (isTileAllowed(square)) tokens[`${zoom}/${x}/${y}`] = mintSquareToken(square);
      }
    res.json({ tokens });
  },
);

/**
 * GET /api/team/map-square/:token: one 256 px map square. `:token` is a
 * version 2 token (lib/mapTiles/tileToken.ts), never z/x/y; a 2×2
 * picture's token is refused here. Counted against the person's 300 squares
 * per 10 minutes before anything is fetched.
 *
 * A square is cached `private, max-age=86400`, never `public`, as the 2×2
 * pictures are. Every refusal or error stays `no-store`.
 */
router.get(
  "/team/map-square/:token",
  requireTeam("view_exact_location"),
  (_req: Request, res: Response, next: () => void) => {
    setTeamHeaders(res); // no-store until there is a square to send, a 429 included
    next();
  },
  mapSquareLimiter,
  async (req: Request, res: Response) => {
    const square = readSquareToken(req.params["token"]);
    if (!square || !isTileAllowed(square)) {
      return void res.status(404).json({ error: "Not found" });
    }
    const png = await getTilePng(square);
    if (!png) {
      req.log.warn({ reason: "tile_unavailable" }, "map square unavailable");
      return void res.status(503).json({ error: "Map picture unavailable" });
    }
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.type("png").send(png);
  },
);

export default router;
