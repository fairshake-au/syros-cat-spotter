import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

// SYC-200: build.mjs replaces these with the commit and build time, so a
// check after a publish can see which code is actually live. Outside a
// production build (development, tests) they don't exist and both read
// "unknown".
declare const __BUILD_COMMIT__: string | undefined;
declare const __BUILD_TIME__: string | undefined;

export function buildInfo(
  commit: string | undefined = typeof __BUILD_COMMIT__ === "undefined" ? undefined : __BUILD_COMMIT__,
  builtAt: string | undefined = typeof __BUILD_TIME__ === "undefined" ? undefined : __BUILD_TIME__,
): { commit: string; builtAt: string } {
  return { commit: commit || "unknown", builtAt: builtAt || "unknown" };
}

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok", ...buildInfo() });
  res.json(data);
});

export default router;
