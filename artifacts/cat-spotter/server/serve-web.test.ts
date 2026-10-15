/**
 * SYC-113 item 1: the website's pre-launch gate.
 * Plan: docs/superpowers/plans/syc-113-pre-launch-gates.md, "Tests" 1–8 and 23,
 * plus the shared cookie vectors.
 *
 * Drives createHandler() through a real http server on a random port, with a
 * throwaway dist folder. Test secrets are generated here; none is real.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_SITEKEY, TEST_SITEKEY_PASSES } from '../lib/turnstileConfig';

const here = path.dirname(fileURLToPath(import.meta.url));

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createHandler, describeGate } = require('./serve-web.js') as {
  createHandler: (
    env: Record<string, string | undefined>,
    options?: { distRoot?: string; nowMs?: () => number },
  ) => http.RequestListener;
  describeGate: (env: Record<string, string | undefined>) => string[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const challenge = require('./challenge-page.js') as { PRODUCTION_SITEKEY: string; TEST_SITEKEY: string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const prelaunch = require('./prelaunch.js') as {
  sessionKeys: (env: Record<string, string | undefined>) => Buffer[];
  signSession: (keys: Buffer[], nowSeconds: number) => string;
  verifySession: (keys: Buffer[], cookie: string | undefined, nowSeconds: number) => boolean;
};
const vectors = JSON.parse(
  fs.readFileSync(path.join(here, '..', 'lib', '__fixtures__', 'prelaunch-cookie-vectors.json'), 'utf8'),
) as {
  cookieName: string;
  sessionSeconds: number;
  vectors: { key: string; nowSeconds: number; expectedValue: string }[];
};

const DAY = 24 * 60 * 60;
const SESSION = 28 * DAY;
const COOKIE = '__Host-cs_prelaunch';

function newKey(): string {
  return crypto.randomBytes(32).toString('base64url');
}

const KEY_A = newKey();
const KEY_B = newKey();
const PASSWORD = crypto.randomBytes(18).toString('base64url');

let dist: string;
beforeAll(() => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'syc113-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<html>home</html>');
  fs.mkdirSync(path.join(dist, 'cat'));
  fs.writeFileSync(path.join(dist, 'cat', '[id].html'), '<html>cat page</html>');
  fs.mkdirSync(path.join(dist, '_expo', 'static', 'js', 'web'), { recursive: true });
  fs.writeFileSync(path.join(dist, '_expo', 'static', 'js', 'web', 'x.js'), 'console.log(1)');
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'assets', 'cat.png'), 'png-bytes');
  fs.writeFileSync(path.join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n');
});
afterAll(() => {
  fs.rmSync(dist, { recursive: true, force: true });
});

type Res = { status: number; headers: http.IncomingHttpHeaders; body: string; raw: Buffer };

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function start(
  env: Record<string, string | undefined>,
  clock?: { now: number },
  root?: string,
): Promise<(method: string, url: string, opts?: { headers?: Record<string, string>; body?: string }) => Promise<Res>> {
  const handler = createHandler(env, {
    distRoot: root ?? dist,
    nowMs: clock ? () => clock.now * 1000 : undefined,
  });
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  return (method, url, opts = {}) =>
    new Promise<Res>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, method, path: url, headers: opts.headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode!,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
              raw: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on('error', reject);
      if (opts.body !== undefined) req.write(opts.body);
      req.end();
    });
}

function gatedEnv(extra: Record<string, string | undefined> = {}) {
  return {
    PRELAUNCH_WEB_PASSWORD: PASSWORD,
    PRELAUNCH_SESSION_KEYS: KEY_A,
    ...extra,
  };
}

function form(fields: Record<string, string>) {
  const body = new URLSearchParams(fields).toString();
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(Buffer.byteLength(body)) },
    body,
  };
}

function cookieFrom(res: Res): string | undefined {
  const set = res.headers['set-cookie'];
  const first = Array.isArray(set) ? set[0] : set;
  if (!first) return undefined;
  return first.split(';')[0];
}

function signedWith(key: string, nowSeconds: number): string {
  return prelaunch.signSession(prelaunch.sessionKeys({ PRELAUNCH_SESSION_KEYS: key }), nowSeconds);
}

describe('1. gate off: behaves exactly as before the gate', () => {
  it('serves pages, routes, bundles and /status as today', async () => {
    const get = await start({ PRELAUNCH_GATE: 'off' });

    const home = await get('GET', '/');
    expect(home.status).toBe(200);
    expect(home.body).toBe('<html>home</html>');
    expect(home.headers['cache-control']).toBe('no-cache');
    expect(home.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(home.headers['x-robots-tag']).toBeUndefined();

    const cat = await get('GET', '/cat/12');
    expect(cat.status).toBe(200);
    expect(cat.body).toBe('<html>cat page</html>');

    const bundle = await get('GET', '/_expo/static/js/web/x.js');
    expect(bundle.status).toBe(200);
    expect(bundle.body).toBe('console.log(1)');
    expect(bundle.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(bundle.headers['content-type']).toBe('application/javascript; charset=utf-8');

    const status = await get('GET', '/status');
    expect(status.status).toBe(200);
    expect(status.body).toBe('ok');

    const robots = await get('GET', '/robots.txt');
    expect(robots.body).toBe('User-agent: *\nAllow: /\n');

    expect((await get('GET', '/missing.js')).status).toBe(404);
    expect((await get('GET', '/%')).status).toBe(400);
    const api = await get('GET', '/api/cats');
    expect(api.status).toBe(404);
    expect(JSON.parse(api.body)).toEqual({ error: 'API is not served by the web static server' });
    expect((await get('GET', '/_gate/login')).status).toBe(404);
    expect(describeGate({ PRELAUNCH_GATE: 'off' })).toEqual(['prelaunch gate: off']);
  });
});

describe('2. gate on, no cookie', () => {
  it('pages get the password page (200, no-store); files get 401; /status and robots stay open', async () => {
    const get = await start(gatedEnv());

    for (const url of ['/', '/cat/12']) {
      const res = await get('GET', url);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toContain('Cat Spotters is being tested before launch');
      expect(res.body).toContain('name="password"');
      expect(res.body).not.toContain('home');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    }

    for (const url of ['/_expo/static/js/web/x.js', '/assets/cat.png']) {
      const res = await get('GET', url);
      expect(res.status).toBe(401);
      expect(res.body).not.toContain('console.log');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    }

    const status = await get('GET', '/status');
    expect(status.status).toBe(200);
    expect(status.headers['x-robots-tag']).toBe('noindex, nofollow');

    const robots = await get('GET', '/robots.txt');
    expect(robots.status).toBe(200);
    expect(robots.body).toBe('User-agent: *\nDisallow: /\n');
    expect(robots.headers['x-robots-tag']).toBe('noindex, nofollow');

    const bad = await get('GET', '/%');
    expect(bad.status).toBe(400);
    expect(bad.headers['x-robots-tag']).toBe('noindex, nofollow');
  });
});

describe('3. right password', () => {
  it('303s to next with a 28-day __Host- cookie that then opens the site', async () => {
    const clock = { now: 1_800_000_000 };
    const req = await start(gatedEnv(), clock);

    const login = await req('POST', '/_gate/login', form({ password: PASSWORD, next: '/cat/12?x=1' }));
    expect(login.status).toBe(303);
    expect(login.headers.location).toBe('/cat/12?x=1');
    const setCookie = String(login.headers['set-cookie']);
    const attrs = setCookie.split(';').map((s) => s.trim());
    expect(attrs[0].startsWith(`${COOKIE}=v1.`)).toBe(true);
    expect(attrs).toContain('HttpOnly');
    expect(attrs).toContain('Secure');
    expect(attrs).toContain('SameSite=Lax');
    expect(attrs).toContain('Path=/');
    expect(attrs).toContain('Max-Age=2419200');
    expect(setCookie.toLowerCase()).not.toContain('domain');

    const cookie = cookieFrom(login)!;
    const signedExpiry = Number(cookie.split('=')[1].split('.')[1]);
    expect(signedExpiry).toBe(clock.now + SESSION);

    const page = await req('GET', '/cat/12', { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(page.body).toBe('<html>cat page</html>');
    const bundle = await req('GET', '/_expo/static/js/web/x.js', { headers: { cookie } });
    expect(bundle.status).toBe(200);

    // Still good one second before expiry, refused one second after.
    clock.now += SESSION - 1;
    expect((await req('GET', '/cat/12', { headers: { cookie } })).body).toBe('<html>cat page</html>');
    clock.now += 2;
    const expired = await req('GET', '/cat/12', { headers: { cookie } });
    expect(expired.body).toContain('name="password"');
  });

  it('logout clears the cookie and goes home', async () => {
    const req = await start(gatedEnv());
    const res = await req('POST', '/_gate/logout');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/');
    expect(String(res.headers['set-cookie'])).toContain(`${COOKIE}=;`);
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');
  });
});

describe('4. wrong password and the rate limit', () => {
  it('wrong password → 401 page, no cookie; the 11th wrong try from one address → 429', async () => {
    const req = await start(gatedEnv());
    const from = (ip: string, password: string) =>
      req('POST', '/_gate/login', {
        ...form({ password, next: '/' }),
        headers: { ...form({ password, next: '/' }).headers, 'x-forwarded-for': `203.0.113.9, ${ip}` },
      });

    for (let i = 1; i <= 10; i++) {
      const res = await from('198.51.100.1', 'not-it');
      expect(res.status).toBe(401);
      expect(res.body).toContain('That password isn&#39;t right');
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    const eleventh = await from('198.51.100.1', 'not-it');
    expect(eleventh.status).toBe(429);
    expect(eleventh.body).toContain('Too many tries. Please wait 15 minutes.');
    // Even the right password is refused while blocked.
    const right = await from('198.51.100.1', PASSWORD);
    expect(right.status).toBe(429);
    expect(right.headers['set-cookie']).toBeUndefined();
    // Another address (right-most X-Forwarded-For entry) is unaffected.
    expect((await from('198.51.100.2', PASSWORD)).status).toBe(303);
  });

  it('the limit resets after 15 minutes', async () => {
    const clock = { now: 1_800_000_000 };
    const req = await start(gatedEnv(), clock);
    for (let i = 0; i < 11; i++) await req('POST', '/_gate/login', form({ password: 'nope' }));
    expect((await req('POST', '/_gate/login', form({ password: PASSWORD }))).status).toBe(429);
    clock.now += 15 * 60 + 1;
    expect((await req('POST', '/_gate/login', form({ password: PASSWORD }))).status).toBe(303);
  });
});

describe('5. next is checked', () => {
  it.each([
    '//evil.example',
    '/\\evil.example',
    'https://evil.example',
    'javascript:x',
    '/\t/evil.example',
    '',
  ])('next=%j redirects to /', async (next) => {
    const req = await start(gatedEnv());
    const res = await req('POST', '/_gate/login', form({ password: PASSWORD, next }));
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/');
  });

  it('the password page carries the requested path as next', async () => {
    const req = await start(gatedEnv());
    const res = await req('GET', '/cat/12?from=share');
    expect(res.body).toContain('value="/cat/12?from=share"');
  });
});

describe('6. cookies that are refused', () => {
  const now = 1_800_000_000;
  const good = () => `${COOKIE}=${signedWith(KEY_A, now)}`;

  async function opens(cookie: string, env = gatedEnv()) {
    const req = await start(env, { now });
    const res = await req('GET', '/cat/12', { headers: { cookie } });
    return res.body === '<html>cat page</html>';
  }

  it('a correctly signed cookie opens the site (control)', async () => {
    expect(await opens(good())).toBe(true);
  });

  it('tampered expiry', async () => {
    const [, exp, sig] = signedWith(KEY_A, now).split('.');
    expect(await opens(`${COOKIE}=v1.${Number(exp) - 1}.${sig}`)).toBe(false);
  });

  it('tampered signature', async () => {
    const value = signedWith(KEY_A, now);
    const flipped = value.slice(0, -1) + (value.endsWith('A') ? 'B' : 'A');
    expect(await opens(`${COOKIE}=${flipped}`)).toBe(false);
  });

  it('signed with an unknown key', async () => {
    expect(await opens(`${COOKIE}=${signedWith(newKey(), now)}`)).toBe(false);
  });

  it('expired', async () => {
    expect(await opens(`${COOKIE}=${signedWith(KEY_A, now - SESSION - 1)}`)).toBe(false);
  });

  it('no expiry', async () => {
    const sig = signedWith(KEY_A, now).split('.')[2];
    expect(await opens(`${COOKIE}=v1..${sig}`)).toBe(false);
    expect(await opens(`${COOKIE}=v1.${sig}`)).toBe(false);
  });

  it('wrong version prefix', async () => {
    const [, exp, sig] = signedWith(KEY_A, now).split('.');
    expect(await opens(`${COOKIE}=v2.${exp}.${sig}`)).toBe(false);
  });

  it('an arbitrary value', async () => {
    expect(await opens(`${COOKIE}=1`)).toBe(false);
    expect(await opens(`${COOKIE}=`)).toBe(false);
  });

  it('with two keys, a cookie signed by the second is accepted', async () => {
    const env = gatedEnv({ PRELAUNCH_SESSION_KEYS: `${KEY_A},${KEY_B}` });
    expect(await opens(`${COOKIE}=${signedWith(KEY_B, now)}`, env)).toBe(true);
  });

  it('new cookies are signed with the first key', async () => {
    const req = await start(gatedEnv({ PRELAUNCH_SESSION_KEYS: `${KEY_B},${KEY_A}` }), { now });
    const login = await req('POST', '/_gate/login', form({ password: PASSWORD }));
    expect(cookieFrom(login)).toBe(`${COOKIE}=${signedWith(KEY_B, now)}`);
  });

  it('two cookies with the name, bad one first: the good one wins', async () => {
    expect(await opens(`${COOKIE}=v1.1.bad; other=1; ${good()}`)).toBe(true);
  });
});

describe('7. gate on but a setting is missing: fails closed', () => {
  it.each([
    ['no password', { PRELAUNCH_WEB_PASSWORD: undefined }],
    ['no session keys', { PRELAUNCH_SESSION_KEYS: undefined }],
    ['a session key too short to be real', { PRELAUNCH_SESSION_KEYS: 'c2hvcnQ' }],
  ])('%s → 503 for pages and files, and a right-looking password gets no cookie', async (_label, extra) => {
    const now = 1_800_000_000;
    const req = await start(gatedEnv(extra), { now });
    const page = await req('GET', '/');
    expect(page.status).toBe(503);
    expect(page.body).toContain("Cat Spotters isn't available right now");
    expect(page.body).not.toContain('home');
    expect((await req('GET', '/_expo/static/js/web/x.js')).status).toBe(503);
    expect((await req('GET', '/_gate/login')).status).toBe(503);
    const login = await req('POST', '/_gate/login', form({ password: PASSWORD }));
    expect(login.status).toBe(503);
    expect(login.headers['set-cookie']).toBeUndefined();
    // Even a cookie that would be valid under KEY_A doesn't open the site.
    const withCookie = await req('GET', '/', { headers: { cookie: `${COOKIE}=${signedWith(KEY_A, now)}` } });
    expect(withCookie.status).toBe(503);
    expect((await req('GET', '/status')).status).toBe(200);
  });
});

describe('8. when the gate is on', () => {
  it.each([
    ['PRELAUNCH_GATE unset, NODE_ENV unset', {}],
    ['PRELAUNCH_GATE unset, NODE_ENV=development', { NODE_ENV: 'development' }],
    ['PRELAUNCH_GATE unset, NODE_ENV=test', { NODE_ENV: 'test' }],
    ['PRELAUNCH_GATE unset, NODE_ENV=production', { NODE_ENV: 'production' }],
    ['PRELAUNCH_GATE=banana', { PRELAUNCH_GATE: 'banana' }],
    ['PRELAUNCH_GATE=OFF (not exactly "off")', { PRELAUNCH_GATE: 'OFF' }],
    ['PRELAUNCH_GATE=on', { PRELAUNCH_GATE: 'on' }],
  ])('%s → on', async (_label, extra) => {
    const req = await start(gatedEnv(extra));
    const res = await req('GET', '/');
    expect(res.body).toContain('name="password"');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('logs a loud line for an unrecognised value, and never logs a secret', () => {
    const lines = describeGate(gatedEnv({ PRELAUNCH_GATE: 'banana' }));
    expect(lines[0]).toMatch(/WARNING/);
    expect(lines[1]).toBe('prelaunch gate: on (session keys: 1, password: yes)');
    expect(lines.join('\n')).not.toContain(PASSWORD);
    expect(lines.join('\n')).not.toContain(KEY_A);
  });
});

describe('clickjacking: nothing gated can be framed', () => {
  it('password page, gated asset, /_gate/* and the logged-in site all carry both headers', async () => {
    const now = 1_800_000_000;
    const req = await start(gatedEnv(), { now });
    const cookie = `${COOKIE}=${signedWith(KEY_A, now)}`;
    const responses = [
      await req('GET', '/'),
      await req('GET', '/_expo/static/js/web/x.js'),
      await req('GET', '/_gate/login'),
      await req('POST', '/_gate/login', form({ password: 'wrong' })),
      await req('POST', '/_gate/logout'),
      await req('GET', '/cat/12', { headers: { cookie } }),
    ];
    for (const res of responses) {
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    }
  });

  it('gate off: unchanged (no new headers)', async () => {
    const req = await start({ PRELAUNCH_GATE: 'off' });
    const res = await req('GET', '/');
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});

describe('23. login body size', () => {
  it('a login body over 4 KB → 413', async () => {
    const req = await start(gatedEnv());
    const res = await req('POST', '/_gate/login', form({ password: PASSWORD, next: '/' + 'a'.repeat(5000) }));
    expect(res.status).toBe(413);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('a chunked body over 4 KB (no content-length) → 413', async () => {
    const req = await start(gatedEnv());
    const res = await req('POST', '/_gate/login', {
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'transfer-encoding': 'chunked' },
      body: `password=${encodeURIComponent(PASSWORD)}&next=/${'a'.repeat(5000)}`,
    });
    expect(res.status).toBe(413);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('shared cookie vectors (the API checks the same file)', () => {
  it.each(vectors.vectors)('key $key signs to the expected value and verifies', (v) => {
    expect(vectors.cookieName).toBe(COOKIE);
    expect(vectors.sessionSeconds).toBe(SESSION);
    const keys = prelaunch.sessionKeys({ PRELAUNCH_SESSION_KEYS: v.key });
    expect(prelaunch.signSession(keys, v.nowSeconds)).toBe(v.expectedValue);
    expect(prelaunch.verifySession(keys, `${COOKIE}=${v.expectedValue}`, v.nowSeconds)).toBe(true);
  });
});

describe('SYC-133: files are sent compressed', () => {
  const BIG_JS = 'console.log("a cat on the harbour wall");\n'.repeat(400);
  let root: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'syc133-dist-'));
    fs.writeFileSync(
      path.join(root, 'index.html'),
      '<!DOCTYPE html><html><head><title>x</title></head><body><div id="root"></div>' +
        '<script src="/_expo/static/js/web/big.js" defer></script></body></html>',
    );
    const js = path.join(root, '_expo', 'static', 'js', 'web');
    fs.mkdirSync(js, { recursive: true });
    fs.writeFileSync(path.join(js, 'big.js'), BIG_JS);
    fs.writeFileSync(path.join(js, 'small.js'), 'x()');
    // A build-time precompressed pair: the .br holds different text so the
    // test can tell it was the file served.
    fs.writeFileSync(path.join(js, 'pre.js'), BIG_JS);
    fs.writeFileSync(path.join(js, 'pre.js.br'), zlib.brotliCompressSync(Buffer.from('from the .br file')));
    fs.writeFileSync(path.join(js, 'pre.js.gz'), zlib.gzipSync(Buffer.from('from the .gz file')));
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'assets', 'cat.png'), Buffer.alloc(4000, 7));
    fs.writeFileSync(path.join(root, 'assets', 'Inter.ttf'), Buffer.alloc(4000, 3));
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const off = { PRELAUNCH_GATE: 'off' };

  it('brotli when the browser accepts it, with Vary and the long cache kept', async () => {
    const get = await start(off, undefined, root);
    const res = await get('GET', '/_expo/static/js/web/big.js', {
      headers: { 'accept-encoding': 'gzip, deflate, br' },
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.headers['vary']).toBe('Accept-Encoding');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['content-type']).toBe('application/javascript; charset=utf-8');
    expect(Number(res.headers['content-length'])).toBe(res.raw.length);
    expect(res.raw.length).toBeLessThan(BIG_JS.length / 10);
    expect(zlib.brotliDecompressSync(res.raw).toString('utf8')).toBe(BIG_JS);
  });

  it('gzip when brotli is not accepted (or refused with q=0)', async () => {
    const get = await start(off, undefined, root);
    for (const accept of ['gzip', 'br;q=0, gzip', 'GZIP;q=0.5']) {
      const res = await get('GET', '/_expo/static/js/web/big.js', { headers: { 'accept-encoding': accept } });
      expect(res.headers['content-encoding']).toBe('gzip');
      expect(zlib.gunzipSync(res.raw).toString('utf8')).toBe(BIG_JS);
    }
  });

  it('uncompressed when nothing is accepted', async () => {
    const get = await start(off, undefined, root);
    for (const accept of [undefined, 'identity', 'br;q=0, gzip;q=0']) {
      const res = await get('GET', '/_expo/static/js/web/big.js', {
        headers: accept ? { 'accept-encoding': accept } : {},
      });
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(res.body).toBe(BIG_JS);
    }
  });

  it('uses the build’s precompressed .br / .gz files when present', async () => {
    const get = await start(off, undefined, root);
    const br = await get('GET', '/_expo/static/js/web/pre.js', { headers: { 'accept-encoding': 'br, gzip' } });
    expect(br.headers['content-encoding']).toBe('br');
    expect(zlib.brotliDecompressSync(br.raw).toString('utf8')).toBe('from the .br file');
    const gz = await get('GET', '/_expo/static/js/web/pre.js', { headers: { 'accept-encoding': 'gzip' } });
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(zlib.gunzipSync(gz.raw).toString('utf8')).toBe('from the .gz file');
  });

  it('fonts are compressed; images and tiny files are not', async () => {
    const get = await start(off, undefined, root);
    const headers = { 'accept-encoding': 'br, gzip' };
    const font = await get('GET', '/assets/Inter.ttf', { headers });
    expect(font.headers['content-encoding']).toBe('br');
    const png = await get('GET', '/assets/cat.png', { headers });
    expect(png.headers['content-encoding']).toBeUndefined();
    expect(png.raw.length).toBe(4000);
    const small = await get('GET', '/_expo/static/js/web/small.js', { headers });
    expect(small.headers['content-encoding']).toBeUndefined();
    expect(small.body).toBe('x()');
  });

  it('the app page carries the loading screen, compressed, and still no-cache', async () => {
    const get = await start(off, undefined, root);
    const res = await get('GET', '/cat/12', { headers: { 'accept-encoding': 'gzip' } });
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['cache-control']).toBe('no-cache');
    const html = zlib.gunzipSync(res.raw).toString('utf8');
    expect(html).toContain('id="cs-loading"');
    expect(html).toContain('Loading…');
    expect(html).toContain('<div id="root"></div>');
  });

  it('gated: the password page and 401s are unchanged; a logged-in visitor gets compressed files', async () => {
    const get = await start(gatedEnv(), undefined, root);
    const locked = await get('GET', '/_expo/static/js/web/big.js', { headers: { 'accept-encoding': 'br' } });
    expect(locked.status).toBe(401);
    expect(locked.headers['content-encoding']).toBeUndefined();
    const cookie = `${COOKIE}=${signedWith(KEY_A, Math.floor(Date.now() / 1000))}`;
    const open = await get('GET', '/_expo/static/js/web/big.js', {
      headers: { 'accept-encoding': 'br', cookie },
    });
    expect(open.status).toBe(200);
    expect(open.headers['content-encoding']).toBe('br');
    expect(zlib.brotliDecompressSync(open.raw).toString('utf8')).toBe(BIG_JS);
  });
});

describe('SYC-3: the restore link (/restore?t=…)', () => {
  const TOKEN = 'QmV5LXJlc3RvcmUtdG9rZW4tcGluLTAxMjM0NTY3ODlhYmM';

  it('serving it writes nothing to the logs, so the token never reaches them (Slice 0.3)', async () => {
    const lines: unknown[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => {
      const original = console[m];
      console[m] = (...args: unknown[]) => void lines.push(args);
      return () => (console[m] = original);
    });
    try {
      for (const env of [{}, gatedEnv()]) {
        const req = await start(env);
        await req('GET', `/restore?t=${TOKEN}`);
      }
    } finally {
      spies.forEach((restore) => restore());
    }
    expect(JSON.stringify(lines)).not.toContain(TOKEN);
  });

  it('the page is sent with Referrer-Policy: no-referrer; other pages are not', async () => {
    const req = await start({ PRELAUNCH_GATE: 'off' });
    const page = await req('GET', `/restore?t=${TOKEN}`);
    expect(page.status).toBe(200);
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    expect((await req('GET', '/')).headers['referrer-policy']).toBeUndefined();
  });

  it('the password page keeps t, and logging in returns the tester to the link intact (test 15)', async () => {
    const req = await start(gatedEnv());
    const page = await req('GET', `/restore?t=${TOKEN}`);
    expect(page.body).toContain(`value="/restore?t=${TOKEN}"`);
    const res = await req('POST', '/_gate/login', form({ password: PASSWORD, next: `/restore?t=${TOKEN}` }));
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/restore?t=${TOKEN}`);
  });
});

describe('SYC-3 Decision 12: a restore link carries its token in the fragment', () => {
  it('the password page keeps a #t= token in sessionStorage for the app, never in the form or the request (test 15′)', async () => {
    const req = await start(gatedEnv());
    // A browser never sends the fragment, so the request is just /restore.
    const page = await req('GET', '/restore');
    expect(page.status).toBe(200);
    // The script saves the token from location.hash and clears it from the address bar…
    expect(page.body).toContain("sessionStorage.setItem('cat-spotter/restore-token',h.slice(3))");
    expect(page.body).toContain('history.replaceState(null,"",location.pathname+location.search)');
    // …only on /restore, and only for a well-formed token.
    expect(page.body).toContain('/\\/restore\\/?$/.test(location.pathname)');
    expect(page.body).toContain('/^#t=[A-Za-z0-9_-]{43}$/.test(h)');
    // The form's `next` is the plain path: nothing about the token goes to the server.
    expect(page.body).toContain('value="/restore"');
    const res = await req('POST', '/_gate/login', form({ password: PASSWORD, next: '/restore' }));
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/restore');
  });
});

describe('SYC-170: /_challenge (Turnstile page)', () => {
  const OK = '/_challenge?action=welfare_report&cdata=r-test123';
  // The test sitekey is served only when NODE_ENV says development or test.
  const DEV = { NODE_ENV: 'development' };

  it('is served with the gate off', async () => {
    const req = await start({ PRELAUNCH_GATE: 'off', NODE_ENV: 'development' });
    const res = await req('GET', OK);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('challenges.cloudflare.com/turnstile/v0/api.js');
    expect(res.body).toContain('"welfare_report"');
    expect(res.body).toContain('"r-test123"');
    expect(res.body).toContain('before-interactive-callback');
    expect(res.body).toContain('1x00000000000000000000AA'); // dev fallback
  });

  it('is served with the gate on and no cookie, and nothing may frame it, gate on or off', async () => {
    for (const env of [gatedEnv(DEV), { PRELAUNCH_GATE: 'off', NODE_ENV: 'development' }]) {
      const req = await start(env);
      const res = await req('GET', OK);
      expect(res.status).toBe(200);
      expect(res.body).toContain('turnstile.render');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(res.headers['content-security-policy']).not.toContain("frame-ancestors 'self'");
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('hands the token only to the phone WebView, never to a parent page', async () => {
    const req = await start(gatedEnv(DEV));
    const res = await req('GET', OK);
    expect(res.body).toContain('ReactNativeWebView.postMessage');
    expect(res.body).not.toContain('window.parent');
  });

  it('uses TURNSTILE_SITEKEY when set; production without one falls back to the built-in production key', async () => {
    const req = await start({ PRELAUNCH_GATE: 'off', TURNSTILE_SITEKEY: '0xPRODKEY' });
    expect((await req('GET', OK)).body).toContain('"0xPRODKEY"');
    const prod = await start({ PRELAUNCH_GATE: 'off', NODE_ENV: 'production' });
    const res = await prod('GET', OK);
    expect(res.status).toBe(200);
    expect(res.body).toContain('"0x4AAAAAAFXDA4oOu3qZurFj"');
  });

  it('SYC-170 PR 1.2: with no NODE_ENV at all (how production runs) and no setting, the production key is used, never the test key', async () => {
    for (const env of [{ PRELAUNCH_GATE: 'off' }, gatedEnv(), { PRELAUNCH_GATE: 'off', NODE_ENV: 'staging' }]) {
      const req = await start(env);
      const res = await req('GET', OK);
      expect(res.status).toBe(200);
      expect(res.body).toContain('"0x4AAAAAAFXDA4oOu3qZurFj"');
      expect(res.body).not.toContain('1x00000000000000000000AA');
    }
    const test = await start({ PRELAUNCH_GATE: 'off', NODE_ENV: 'test' });
    expect((await test('GET', OK)).body).toContain('1x00000000000000000000AA');
  });

  it('the server and the app hold the same production sitekey', () => {
    expect(challenge.PRODUCTION_SITEKEY).toBe(PRODUCTION_SITEKEY);
    expect(challenge.TEST_SITEKEY).toBe(TEST_SITEKEY_PASSES);
  });

  it.each([
    '/_challenge',
    '/_challenge?action=nope&cdata=x',
    '/_challenge?action=welfare_report&cdata=has%20space',
    '/_challenge?action=welfare_report&cdata=' + 'a'.repeat(101),
    '/_challenge?action=welfare_report&cdata=%3Cscript%3E',
  ])('rejects a bad query: %s', async (url) => {
    for (const env of [{ PRELAUNCH_GATE: 'off', NODE_ENV: 'development' }, gatedEnv(DEV)]) {
      const req = await start(env);
      expect((await req('GET', url)).status).toBe(400);
    }
  });

  it('accepts each allowed action and a 100-character cdata', async () => {
    const req = await start(gatedEnv(DEV));
    for (const action of ['welfare_report', 'welfare_draft', 'report_issue']) {
      expect((await req('GET', `/_challenge?action=${action}&cdata=${'a'.repeat(100)}`)).status).toBe(200);
    }
    expect((await req('GET', '/_challenge?action=report_issue')).status).toBe(200);
  });

  it('does not accept POST', async () => {
    const req = await start(gatedEnv(DEV));
    expect((await req('POST', OK)).status).toBe(405);
  });

  it('exempts nothing else from the gate', async () => {
    const req = await start(gatedEnv(DEV));
    for (const p of [
      '/_challenge/',
      '/_challenge/x',
      '/_challenge.html',
      '/_challenges',
      '/x/_challenge',
      '/_Challenge',
      '/cat/1',
      '/',
    ]) {
      const res = await req('GET', `${p}?action=welfare_report`);
      expect(res.body, p).not.toContain('turnstile.render');
      expect(res.body, p).not.toContain('<html>home');
    }
    expect((await req('GET', '/_expo/static/js/web/x.js')).status).toBe(401);
  });
});

describe('SYC-189: team.catspotters.com goes to the dashboard, never the tester app', () => {
  const TEAM = { host: 'team.catspotters.com' };

  for (const [label, env] of [
    ['gate on', gatedEnv()],
    ['gate off', { PRELAUNCH_GATE: 'off' }],
  ] as const) {
    it(`${label}: every page and file on the team address redirects to /api/team/`, async () => {
      const req = await start(env);
      for (const p of ['/', '/cat/12', '/restore?t=abc', '/_expo/static/js/web/x.js', '/robots.txt', '/_gate/login']) {
        const res = await req('GET', p, { headers: TEAM });
        expect(res.status, p).toBe(302);
        expect(res.headers.location, p).toBe('/api/team/');
        expect(res.headers['cache-control'], p).toBe('no-store');
        expect(res.body, p).not.toContain('<html>home');
      }
      expect((await req('POST', '/_gate/login', { headers: TEAM })).status).toBe(302);
    });
  }

  it('matches the address however it is written, or when the proxy passes it on', async () => {
    const req = await start(gatedEnv());
    for (const headers of [
      { host: 'TEAM.CatSpotters.com' },
      { host: 'team.catspotters.com:443' },
      { host: 'team.catspotters.com.' },
      { host: 'internal:8080', 'x-forwarded-host': 'team.catspotters.com' },
      { host: 'internal:8080', 'x-forwarded-host': 'team.catspotters.com, proxy.internal' },
    ]) {
      const res = await req('GET', '/', { headers });
      expect(res.status, JSON.stringify(headers)).toBe(302);
      expect(res.headers.location).toBe('/api/team/');
    }
  });

  it('/status still answers ok on the team address (health checks)', async () => {
    const req = await start(gatedEnv());
    const res = await req('GET', '/status', { headers: TEAM });
    expect(res.status).toBe(200);
    expect(res.body).toBe('ok');
  });

  it('other addresses are unchanged: the tester app and its password page', async () => {
    const req = await start(gatedEnv());
    for (const host of ['catspotters.com', 'www.catspotters.com', 'admin.catspotters.com', 'team.catspotters.com.evil.com', 'evilteam.catspotters.com']) {
      const res = await req('GET', '/', { headers: { host } });
      expect(res.status, host).toBe(200);
      expect(res.body, host).toContain('<form');
    }
    const open = await start({ PRELAUNCH_GATE: 'off' });
    expect((await open('GET', '/', { headers: { host: 'catspotters.com' } })).body).toBe('<html>home</html>');
  });
});
