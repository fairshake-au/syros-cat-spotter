// Browser check for SYC-396 PR 1.5, local only: the dashboard is served from
// team.catspotters.com, so its own fetch POSTs carry that Origin and pass
// requireOrigin. Served from localhost they'd carry http://localhost:<port>
// and be refused, so this forwards to the local server (UPSTREAM port) and
// gives POSTs the dashboard's Origin. Never used against a real deployment.
//   UPSTREAM=8155 PORT=8156 node origin-proxy.mjs
import http from "node:http";

const UPSTREAM = Number(process.env.UPSTREAM ?? 8155);
const PORT = Number(process.env.PORT ?? 8156);
http
  .createServer((req, res) => {
    const headers = { ...req.headers, host: `localhost:${UPSTREAM}` };
    if (req.method === "POST") headers.origin = "https://team.catspotters.com";
    const up = http.request({ host: "localhost", port: UPSTREAM, path: req.url, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  })
  .listen(PORT, "localhost");
