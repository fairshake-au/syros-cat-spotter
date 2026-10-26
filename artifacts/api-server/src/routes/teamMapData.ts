import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { buildStyle, type MapLang } from "@workspace/map-style";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireSeeing } from "../middlewares/requireSeeing";
import { mapDataLimiter } from "../middlewares/rateLimit";
import { currentMapVersion, getMapFile, mapFilePath, type MapSource } from "../lib/mapData/store";

// The dashboard's own copy of the Syros map (SYC-705 Phase 2, Task 2b.3):
// the map file, fonts, symbols and style, all served from the dashboard's own
// address, so a browser never asks a map company (or anyone but us) for map
// data. Everything here is for anyone who sees some colony (`requireSeeing`):
// the data is the island's map only, never a site, a cat or a position of
// ours. The files come from lib/mapData/store.ts.
//
// **Never part of the map file.** The browser's map library normally asks for
// byte ranges of the map file, and which ranges it asks for show which area is
// on screen. These routes therefore answer every request with the WHOLE file:
// the body is written by hand with `Content-Length` and `Accept-Ranges: none`,
// never through `res.sendFile` / `send` (which would honour a `Range` header).
// The request log never records a header, so no range reaches a log either
// (tested). The browser keeps each whole file for a year, so a person asks
// roughly 25 times on a cold page load and rarely after.

const router: IRouter = Router();

/** Test-only: the stub host the routes fetch from. Never set outside tests. */
let source: MapSource = {};
export function setMapSourceForTests(src: MapSource | undefined): void {
  if (process.env["NODE_ENV"] !== "test") throw new Error("setMapSourceForTests is for tests only");
  source = src ?? {};
}

const FOREVER = "private, max-age=31536000, immutable";

const notFound = (res: Response) => void res.status(404).json({ error: "Not found" });

/** setTeamHeaders (no-store) BEFORE the limiter, so a refusal or a 429 stays no-store. */
const door = [
  ...requireSeeing(),
  (_req: Request, res: Response, next: NextFunction) => {
    setTeamHeaders(res);
    next();
  },
  mapDataLimiter,
];

/** A positive whole number, nothing else ("0", "x", "-1", "1.5", "03" all refused). */
function readVersion(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,8}$/.test(raw)) return null;
  return Number(raw);
}

/** Only the current version and the one before it are served. */
const isServed = (version: number, current: number) => version <= current && version >= current - 1;

/** The whole body, never a range: Content-Length and Accept-Ranges: none, written by hand. */
function sendWhole(res: Response, type: string, body: Buffer): void {
  res.status(200);
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Length", String(body.length));
  res.setHeader("Accept-Ranges", "none");
  res.setHeader("Cache-Control", FOREVER);
  res.end(body);
}

async function serveFile(req: Request, res: Response, path: string | null, type: string): Promise<void> {
  const version = readVersion(req.params["version"]);
  if (version === null || path === null) return notFound(res);
  const body = await getMapFile(version, path, source);
  if (!body) {
    // A version above the current one is a 404; any other miss is the host or the store.
    if (!isServed(version, await currentMapVersion(source))) return notFound(res);
    req.log.warn({ version, path }, "map data unavailable");
    return void res.status(503).json({ error: "Map data unavailable" });
  }
  sendWhole(res, type, body);
}

/** GET /api/team/map-data/current: the version the map is on. */
router.get("/team/map-data/current", ...door, async (_req: Request, res: Response) => {
  res.json({ version: await currentMapVersion(source) });
});

/** GET /api/team/map-data/v:version/syros.pmtiles: the whole map file. */
router.get("/team/map-data/v:version/syros.pmtiles", ...door, (req: Request, res: Response) =>
  serveFile(req, res, mapFilePath("tiles"), "application/vnd.pmtiles"),
);

/** GET /api/team/map-data/v:version/fonts/:stack/:range.pbf: one range of glyphs. */
router.get("/team/map-data/v:version/fonts/:stack/:range.pbf", ...door, (req: Request, res: Response) =>
  serveFile(req, res, mapFilePath("font", String(req.params["stack"]), String(req.params["range"])), "application/x-protobuf"),
);

/** GET /api/team/map-data/v:version/sprites/:file: the map's symbols. */
router.get("/team/map-data/v:version/sprites/:file", ...door, (req: Request, res: Response) => {
  const file = String(req.params["file"]);
  const path = mapFilePath("sprite", file);
  return serveFile(req, res, path, file.endsWith(".png") ? "image/png" : "application/json");
});

/**
 * GET /api/team/map-data/v:version/style-:lang.json: the map's style, built
 * here, for a version we would serve. The paths in it are relative (the
 * browser's map code makes them absolute) and name this same version.
 */
router.get("/team/map-data/v:version/style-:lang.json", ...door, async (req: Request, res: Response) => {
  const version = readVersion(req.params["version"]);
  const lang = req.params["lang"];
  if (version === null || (lang !== "en" && lang !== "el")) return notFound(res);
  if (!isServed(version, await currentMapVersion(source))) return notFound(res);
  const style = buildStyle({
    lang: lang as MapLang,
    pmtilesUrl: `pmtiles://syros-v${version}.pmtiles`,
    glyphsUrl: `/api/team/map-data/v${version}/fonts/{fontstack}/{range}.pbf`,
    spriteUrl: `/api/team/map-data/v${version}/sprites/light`,
  });
  sendWhole(res, "application/json; charset=utf-8", Buffer.from(JSON.stringify(style)));
});

export default router;
