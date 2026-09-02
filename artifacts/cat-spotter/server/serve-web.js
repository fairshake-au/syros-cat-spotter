/**
 * Production server for the Expo WEB export (`expo export --platform web`).
 *
 * Serves ./dist/ as a normal website:
 * - static files served with correct MIME types
 * - hashed bundle assets under /_expo/ get immutable cache headers
 * - any GET without a file extension falls back to the exported HTML so
 *   expo-router's client-side routes (e.g. /cat/12) load on hard refresh
 * - /status returns 200 for reachability checks
 *
 * This replaces server/serve.js in production. That server has a different
 * job: it serves the Expo GO bundles built by scripts/build.js, which open
 * the app inside Expo Go on a phone. This one serves the app to browsers.
 *
 * Zero external dependencies, Node.js built-ins only.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST_ROOT = path.resolve(__dirname, '..', 'dist');
const basePath = (process.env.BASE_PATH || '/').replace(/\/+$/, '');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

if (!fs.existsSync(path.join(DIST_ROOT, 'index.html'))) {
  console.error(
    `No web export found at ${DIST_ROOT}. Run \`pnpm --filter @workspace/cat-spotter run build:web\` first.`,
  );
  process.exit(1);
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function resolveFile(pathname) {
  const safePath = path
    .normalize(pathname)
    .replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(DIST_ROOT, safePath);
  if (!filePath.startsWith(DIST_ROOT)) return null;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return filePath;
  }
  return null;
}

/**
 * expo-router's static export writes one HTML file per route (e.g.
 * cat/[id].html) plus index.html. Serve the closest match so hard refreshes
 * and shared links land on the right route, falling back to index.html.
 */
function resolveHtmlFor(pathname) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const candidates =
    clean === '/'
      ? ['index.html']
      : [
          `${clean}.html`,
          path.join(clean, 'index.html'),
          // dynamic routes export as bracket files, e.g. /cat/[id].html
          `${path.dirname(clean)}/[id].html`,
          'index.html',
        ];
  for (const candidate of candidates) {
    const file = resolveFile('/' + candidate.replace(/^\/+/, ''));
    if (file) return file;
  }
  return null;
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    // Malformed percent-encoding (e.g. a request for "/%") makes
    // decodeURIComponent throw; uncaught, that would kill the process on a
    // single bad request.
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, { 'content-type': 'text/plain' }, 'Bad Request');
  }

  // Strip the base path only on a segment boundary, so BASE_PATH=/app
  // matches /app and /app/x but never /appliance.
  if (basePath) {
    if (pathname === basePath) pathname = '/';
    else if (pathname.startsWith(basePath + '/')) {
      pathname = pathname.slice(basePath.length);
    }
  }

  if (pathname === '/status') {
    return send(res, 200, { 'content-type': 'text/plain' }, 'ok');
  }

  // In production the platform routes /api to the API service before this
  // server ever sees it. If a request does arrive here (local testing, or a
  // routing mistake), answer with JSON 404 rather than falling back to the
  // app's HTML, which clients would try to parse as data.
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return send(
      res,
      404,
      { 'content-type': 'application/json' },
      JSON.stringify({ error: 'API is not served by the web static server' }),
    );
  }

  const ext = path.extname(pathname).toLowerCase();

  if (ext) {
    const file = resolveFile(pathname);
    if (!file) return send(res, 404, { 'content-type': 'text/plain' }, 'Not Found');
    const headers = { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' };
    // Expo's exported bundles are content-hashed, so they can be cached hard.
    if (pathname.startsWith('/_expo/') || pathname.startsWith('/assets/')) {
      headers['cache-control'] = 'public, max-age=31536000, immutable';
    }
    return send(res, 200, headers, fs.readFileSync(file));
  }

  const html = resolveHtmlFor(pathname);
  if (!html) return send(res, 404, { 'content-type': 'text/plain' }, 'Not Found');
  return send(
    res,
    200,
    { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
    fs.readFileSync(html),
  );
});

const port = parseInt(process.env.PORT || '3000', 10);
server.listen(port, '0.0.0.0', () => {
  console.log(`Serving Expo web export from ${DIST_ROOT} on port ${port}`);
});
