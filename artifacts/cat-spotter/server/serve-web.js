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
 * SYC-113 pre-launch gate (docs/superpowers/plans/syc-113-pre-launch-gates.md,
 * item 1): until launch, everything except /status, /robots.txt and /_gate/*
 * needs the password cookie. The gate is on unless PRELAUNCH_GATE is exactly
 * "off"; with it off the handler behaves exactly as it did before the gate.
 *
 * SYC-133 (weak connections): text files (the bundle, CSS, fonts, HTML) are
 * sent brotli- or gzip-compressed when the browser accepts it, using the
 * .br/.gz files scripts/precompress-web.js writes at build time, or
 * compressing on the fly (once, then kept in memory) if they are missing.
 * App pages carry an inline loading screen (./loading-screen.js) so visitors
 * see the app's name and "Loading…" at once instead of a blank page.
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
const zlib = require('zlib');
const prelaunch = require('./prelaunch');
const { passwordPage, unavailablePage } = require('./prelaunch-page');
const { injectLoadingScreen } = require('./loading-screen');

const DIST_ROOT = path.resolve(__dirname, '..', 'dist');

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

// Wrong website passwords: 10 per address per 15 minutes, then 429.
const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
// The login form carries a password and a path; 4 KB is plenty.
const LOGIN_MAX_BODY_BYTES = 4096;

// SYC-133: file types worth compressing. Images and woff/woff2 fonts are
// already compressed; tiny files aren't worth the header.
const COMPRESSIBLE_EXTENSIONS = new Set([
  '.html', '.js', '.mjs', '.json', '.css', '.svg', '.ico', '.ttf', '.otf', '.map', '.txt',
]);
const MIN_COMPRESS_BYTES = 1024;

/**
 * Which compression to use for this request: 'br', 'gzip' or null. Brotli is
 * preferred (smaller). An encoding counts only if listed (or covered by "*")
 * with q above 0.
 */
function chooseEncoding(acceptEncoding) {
  if (typeof acceptEncoding !== 'string' || !acceptEncoding) return null;
  const q = new Map();
  for (const part of acceptEncoding.split(',')) {
    const [rawName, ...params] = part.trim().split(';');
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    let weight = 1;
    for (const param of params) {
      const match = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(param);
      if (match) weight = Number(match[1]);
    }
    q.set(name, Number.isFinite(weight) ? weight : 0);
  }
  const accepts = (name) => (q.has(name) ? q.get(name) > 0 : (q.get('*') ?? 0) > 0);
  if (accepts('br')) return 'br';
  if (accepts('gzip')) return 'gzip';
  return null;
}

/** On-the-fly compression (build-time .br files use the slower, smaller setting). */
function compressBuffer(buffer, encoding) {
  if (encoding === 'br') {
    return zlib.brotliCompressSync(buffer, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.length,
      },
    });
  }
  return zlib.gzipSync(buffer, { level: 6 });
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

/**
 * Where to send someone after they log in. Only a local path is followed:
 * it must start with a single "/" (not "//" or "/\", which browsers treat as
 * another site) and contain only printable ASCII with no backslash (browsers
 * drop tabs and newlines from URLs, so "/\t/evil.example" would become
 * "//evil.example"). Anything else goes to the home page.
 */
function safeNext(next, fallback) {
  if (typeof next !== 'string') return fallback;
  if (!/^\/[\x21-\x7e]*$/.test(next)) return fallback;
  if (next.startsWith('//') || next.includes('\\')) return fallback;
  return next;
}

/** The right-most X-Forwarded-For entry (one proxy, Replit's), else the socket. */
function clientAddress(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const parts = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/** In-memory wrong-password counter, per handler (so per instance). */
function createLoginLimiter(nowMs) {
  const failures = new Map();
  function current(address) {
    const entry = failures.get(address);
    if (entry && entry.resetAt <= nowMs()) {
      failures.delete(address);
      return null;
    }
    return entry || null;
  }
  return {
    blocked(address) {
      const entry = current(address);
      return Boolean(entry && entry.count >= LOGIN_MAX_FAILURES);
    },
    recordFailure(address) {
      if (failures.size > 10000) {
        for (const [key, entry] of failures) {
          if (entry.resetAt <= nowMs()) failures.delete(key);
        }
      }
      const entry = current(address);
      if (entry) entry.count += 1;
      else failures.set(address, { count: 1, resetAt: nowMs() + LOGIN_WINDOW_MS });
    },
  };
}

/** Read a small request body; calls back with (tooLarge, text). */
function readSmallBody(req, limit, callback) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    callback(true, '');
    return;
  }
  const chunks = [];
  let size = 0;
  let finished = false;
  req.on('data', (chunk) => {
    if (finished) return;
    size += chunk.length;
    if (size > limit) {
      finished = true;
      req.pause();
      callback(true, '');
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (finished) return;
    finished = true;
    callback(false, Buffer.concat(chunks).toString('utf8'));
  });
  req.on('error', () => {
    if (finished) return;
    finished = true;
    callback(true, '');
  });
}

/**
 * Build the request handler.
 * @param {NodeJS.ProcessEnv} env settings, read on every request
 * @param {{ distRoot?: string, nowMs?: () => number }} [options] for tests
 */
function createHandler(env = process.env, options = {}) {
  const distRoot = options.distRoot || DIST_ROOT;
  const nowMs = options.nowMs || (() => Date.now());
  const basePath = (env.BASE_PATH || '/').replace(/\/+$/, '');
  const limiter = createLoginLimiter(nowMs);
  // On-the-fly compressed files, keyed by encoding, path, mtime and size.
  // Bounded by the size of dist/ (hashed files, one build per process).
  const compressedCache = new Map();

  function resolveFile(pathname) {
    const safePath = path
      .normalize(pathname)
      .replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = path.join(distRoot, safePath);
    if (!filePath.startsWith(distRoot)) return null;
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

  /**
   * SYC-133: the compressed body for a file on disk, or null to send it as
   * is. Prefers the build's precompressed sibling (file.br / file.gz); falls
   * back to compressing once and keeping the result in memory.
   */
  function compressedFile(file, encoding) {
    const sibling = `${file}.${encoding === 'br' ? 'br' : 'gz'}`;
    if (fs.existsSync(sibling) && fs.statSync(sibling).isFile()) return fs.readFileSync(sibling);
    const stat = fs.statSync(file);
    if (stat.size < MIN_COMPRESS_BYTES) return null;
    const key = `${encoding}\0${file}\0${stat.mtimeMs}\0${stat.size}`;
    let body = compressedCache.get(key);
    if (!body) {
      body = compressBuffer(fs.readFileSync(file), encoding);
      compressedCache.set(key, body);
    }
    return body;
  }

  /** Sends a body, compressed when the type allows and the browser accepts it. */
  function sendMaybeCompressed(req, res, headers, ext, readBody, compressFile) {
    if (!COMPRESSIBLE_EXTENSIONS.has(ext)) return send(res, 200, headers, readBody());
    const out = { ...headers, vary: 'Accept-Encoding' };
    const encoding = chooseEncoding(req.headers['accept-encoding']);
    const compressed = encoding ? compressFile(encoding) : null;
    if (compressed) {
      out['content-encoding'] = encoding;
      out['content-length'] = compressed.length;
      return send(res, 200, out, compressed);
    }
    const body = readBody();
    out['content-length'] = body.length;
    return send(res, 200, out, body);
  }

  function serveSite(req, res, pathname) {
    const ext = path.extname(pathname).toLowerCase();

    if (ext) {
      const file = resolveFile(pathname);
      if (!file) return send(res, 404, { 'content-type': 'text/plain' }, 'Not Found');
      const headers = { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' };
      // Expo's exported bundles are content-hashed, so they can be cached hard.
      if (pathname.startsWith('/_expo/') || pathname.startsWith('/assets/')) {
        headers['cache-control'] = 'public, max-age=31536000, immutable';
      }
      return sendMaybeCompressed(
        req,
        res,
        headers,
        ext,
        () => fs.readFileSync(file),
        (encoding) => compressedFile(file, encoding),
      );
    }

    const html = resolveHtmlFor(pathname);
    if (!html) return send(res, 404, { 'content-type': 'text/plain' }, 'Not Found');
    // SYC-133: the page carries its own loading screen. Small, so it is
    // compressed per request rather than cached.
    const page = Buffer.from(injectLoadingScreen(fs.readFileSync(html, 'utf8')), 'utf8');
    return sendMaybeCompressed(
      req,
      res,
      { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
      '.html',
      () => page,
      (encoding) => (page.length < MIN_COMPRESS_BYTES ? null : compressBuffer(page, encoding)),
    );
  }

  function sendPasswordPage(res, status, next, error, extraHeaders) {
    return send(
      res,
      status,
      {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        ...extraHeaders,
      },
      passwordPage({ action: `${basePath}/_gate/login`, next, error }),
    );
  }

  function sendUnavailable(res, isPage) {
    if (isPage) {
      return send(
        res,
        503,
        { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        unavailablePage(),
      );
    }
    return send(
      res,
      503,
      { 'content-type': 'text/plain', 'cache-control': 'no-store' },
      'Service Unavailable',
    );
  }

  // No CSRF token on /_gate/login or /_gate/logout, on purpose. There is one
  // shared password, so a forged login can only log a visitor into the same
  // tester view everyone with the password sees, and a forged logout only
  // shows them the password page again. Neither gains an attacker anything,
  // and SameSite=Lax already keeps the cookie off cross-site POSTs.
  function handleLogin(req, res, keys, configured) {
    const home = `${basePath}/`;
    const address = clientAddress(req);
    readSmallBody(req, LOGIN_MAX_BODY_BYTES, (tooLarge, text) => {
      if (tooLarge) {
        return send(
          res,
          413,
          { 'content-type': 'text/plain', connection: 'close' },
          'Payload Too Large',
        );
      }
      const form = new URLSearchParams(text);
      const next = safeNext(form.get('next'), home);
      if (!configured) return sendUnavailable(res, true);
      if (limiter.blocked(address)) {
        return sendPasswordPage(res, 429, next, 'tooMany');
      }
      if (!prelaunch.checkPassword(env, form.get('password') ?? '')) {
        limiter.recordFailure(address);
        return sendPasswordPage(res, 401, next, 'wrong');
      }
      const value = prelaunch.signSession(keys, Math.floor(nowMs() / 1000));
      return send(
        res,
        303,
        {
          location: next,
          'set-cookie': prelaunch.sessionCookie(value),
          'cache-control': 'no-store',
          'content-type': 'text/plain',
        },
        'See Other',
      );
    });
  }

  return function handler(req, res) {
    const gateOn = prelaunch.gateEnabled(env);
    if (gateOn) {
      res.setHeader('x-robots-tag', 'noindex, nofollow');
      // No other site may frame the password page or the gated site
      // (clickjacking). Both headers, for old and new browsers.
      res.setHeader('x-frame-options', 'DENY');
      res.setHeader('content-security-policy', "frame-ancestors 'none'");
    }

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

    if (!gateOn) {
      // The plan: with the gate off, /_gate/* is 404 (not the app's HTML).
      if (pathname === '/_gate' || pathname.startsWith('/_gate/')) {
        return send(res, 404, { 'content-type': 'text/plain' }, 'Not Found');
      }
      return serveSite(req, res, pathname);
    }

    // ---- The pre-launch gate is on from here. ----

    if (pathname === '/robots.txt') {
      return send(
        res,
        200,
        { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        'User-agent: *\nDisallow: /\n',
      );
    }

    const keys = prelaunch.sessionKeys(env);
    const configured = Boolean(env.PRELAUNCH_WEB_PASSWORD) && keys.length > 0;
    const home = `${basePath}/`;

    if (pathname === '/_gate/login') {
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (!configured) return sendUnavailable(res, true);
        const query = new URL(req.url || '/', 'http://x').searchParams;
        return sendPasswordPage(res, 200, safeNext(query.get('next'), home));
      }
      if (req.method === 'POST') return handleLogin(req, res, keys, configured);
      return send(res, 405, { 'content-type': 'text/plain', allow: 'GET, HEAD, POST' }, 'Method Not Allowed');
    }
    if (pathname === '/_gate/logout') {
      if (req.method !== 'POST') {
        return send(res, 405, { 'content-type': 'text/plain', allow: 'POST' }, 'Method Not Allowed');
      }
      return send(
        res,
        303,
        {
          location: home,
          'set-cookie': prelaunch.clearedCookie(),
          'cache-control': 'no-store',
          'content-type': 'text/plain',
        },
        'See Other',
      );
    }
    if (pathname.startsWith('/_gate/')) {
      return send(res, 404, { 'content-type': 'text/plain' }, 'Not Found');
    }

    const isPage = !path.extname(pathname);
    if (!configured) return sendUnavailable(res, isPage);

    if (prelaunch.verifySession(keys, req.headers.cookie, Math.floor(nowMs() / 1000))) {
      return serveSite(req, res, pathname);
    }

    if (!isPage) {
      return send(
        res,
        401,
        { 'content-type': 'text/plain', 'cache-control': 'no-store' },
        'Unauthorized',
      );
    }
    // Status 200, never a redirect or a 401: if Replit's platform probes "/"
    // on this service, it must see a healthy answer.
    return sendPasswordPage(res, 200, safeNext(req.url, home));
  };
}

/** One start-up line saying whether the gate is on and what's configured (never values). */
function describeGate(env) {
  const raw = env.PRELAUNCH_GATE;
  const lines = [];
  if (raw !== undefined && raw !== 'on' && raw !== 'off') {
    lines.push(
      `WARNING: PRELAUNCH_GATE is set to an unrecognised value; treating it as "on". Use exactly "on" or "off".`,
    );
  }
  if (!prelaunch.gateEnabled(env)) {
    lines.push('prelaunch gate: off');
  } else {
    lines.push(
      `prelaunch gate: on (session keys: ${prelaunch.sessionKeys(env).length}, password: ${env.PRELAUNCH_WEB_PASSWORD ? 'yes' : 'no'})`,
    );
  }
  return lines;
}

module.exports = {
  createHandler,
  describeGate,
  safeNext,
  chooseEncoding,
  COMPRESSIBLE_EXTENSIONS,
  MIN_COMPRESS_BYTES,
};

if (require.main === module) {
  if (!fs.existsSync(path.join(DIST_ROOT, 'index.html'))) {
    console.error(
      `No web export found at ${DIST_ROOT}. Run \`pnpm --filter @workspace/cat-spotter run build:web\` first.`,
    );
    process.exit(1);
  }
  for (const line of describeGate(process.env)) console.log(line);
  const server = http.createServer(createHandler(process.env));
  const port = parseInt(process.env.PORT || '3000', 10);
  server.listen(port, '0.0.0.0', () => {
    console.log(`Serving Expo web export from ${DIST_ROOT} on port ${port}`);
  });
}
