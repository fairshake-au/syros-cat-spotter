// Local-only stand-in for the browser behaviour SYC-330 will fix: forwards to
// the API server and gives dashboard POSTs the dashboard's own Origin, so the
// map's taps can be checked. Never used against a real deployment.
import http from "node:http";
http.createServer((req, res) => {
  const headers = { ...req.headers };
  if (req.method === "POST") headers.origin = "https://team.catspotters.com";
  const up = http.request({ host: "localhost", port: 8131, path: req.url, method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  req.pipe(up);
}).listen(8132);
