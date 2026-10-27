import { Router, type IRouter, type Request, type Response } from "express";
import { assetFile } from "../lib/teamAssets";
import { setTeamHeaders } from "../lib/teamAuth/refuse";

// GET /api/team/assets/:file: the dashboard's own scripts (SYC-396 plan
// Decision 4; Task 1.3.4). Public bytes, the same for everyone, so no
// session is asked for and none is read: no cookie is set, and the answer
// is the same with or without one (team.walk.test.ts, PUBLIC_BYTES).
//
// Only a hashed name from the manifest is served (lib/teamAssets.ts looks
// it up in a Map; nothing here touches the disk). Anything else, a plain
// name, a traversal or a NUL included, is a plain 404. Each name is fixed
// to its bytes, so a browser may keep it for a year. GET only (Express also
// answers HEAD with the same headers and no body).

const router: IRouter = Router();

/**
 * The one asset that carries the wider security header (SYC-705 Task 2b.4).
 * A worker's own policy comes from its own response, so MapLibre's worker
 * needs 'self' for connect-src to fetch map data. Only this name, 200 only.
 */
const WORKER_ASSET = /^maplibre-gl-worker\.[0-9a-f]{12}\.mjs$/;

export const ASSET_CACHE = "public, max-age=31536000, immutable";

router.get("/team/assets/:file", (req: Request, res: Response) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  const name = req.params["file"];
  const file = typeof name === "string" ? assetFile(name) : undefined;
  if (!file) {
    res.setHeader("Cache-Control", "no-store");
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  if (typeof name === "string" && WORKER_ASSET.test(name)) {
    setTeamHeaders(res, { scripts: true }); // sets no-store; the next line replaces it
  }
  res.setHeader("Cache-Control", ASSET_CACHE);
  res.setHeader("Content-Type", file.type);
  // Our files are fetched by our own pages only (same origin).
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.status(200).send(file.bytes);
});

export default router;
