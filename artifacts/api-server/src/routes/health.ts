import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { runProxyProbe } from "../lib/proxyProbe";

const router: IRouter = Router();

router.get("/healthz", (req, res) => {
  // SYC-100: inert unless PROXY_PROBE_TOKEN is set AND the request carries
  // a matching X-Proxy-Probe header — see src/lib/proxyProbe.ts. This never
  // changes the response; it only emits one structured log line, with no
  // raw IP in it, used to confirm Replit's proxy hop count.
  runProxyProbe(req, req.log ?? logger);
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
