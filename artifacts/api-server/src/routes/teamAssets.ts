import { Router, type IRouter, type Request, type Response } from "express";
import { assetFile } from "../lib/teamAssets";

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
  res.setHeader("Cache-Control", ASSET_CACHE);
  res.setHeader("Content-Type", file.type);
  // Our files are fetched by our own pages only (same origin).
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.status(200).send(file.bytes);
});

export default router;
