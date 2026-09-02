/**
 * catspotters.com — the public site.
 *
 * Serves the coming-soon page from static assets, handles the sign-up POST,
 * and serves the three shareable documents at /media, /forpurpose and
 * /boundless behind a shared password.
 *
 * The documents are compiled into the worker (src/documents.js) rather than
 * placed in public/: assets are served before the worker runs, so a document
 * sitting there would be readable at its asset path with no gate at all.
 *
 * Two ways past the gate:
 *   - the password, which Syros Cats hands out and which sets a 30-day cookie;
 *   - a signed one-shot link from admin.catspotters.com, so anybody who
 *     clicks through from the workspace is never asked for it.
 */

import { DOCUMENTS, GATE_PAGE } from './documents.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LANGS = new Set(['en', 'el', 'fr']);

const SLUGS = new Set(Object.keys(DOCUMENTS));
const COOKIE = '__Host-cs_pass';
const COOKIE_DAYS = 30;
const TEAM_LINK_TTL = 300; // seconds; the hop from the workspace to the document

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

const html = (body, status = 200, headers = {}) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });

// ---- signing -------------------------------------------------------------

const enc = new TextEncoder();

async function key(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
}

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(secret, payload) {
  const mac = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(payload));
  return `${payload}.${b64url(mac)}`;
}

/** Constant-time-ish verify: re-sign and compare the whole token. */
async function verify(secret, token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const payload = token.slice(0, token.lastIndexOf('.'));
  const expected = await sign(secret, payload);
  if (expected.length !== token.length) return null;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  if (diff !== 0) return null;
  const [kind, expires] = payload.split(':');
  if (!expires || Number(expires) * 1000 < Date.now()) return null;
  return kind;
}

/**
 * Every value sent under a name, not just the last one. A browser will happily
 * send two cookies of the same name — one host-only, one set with Domain= from
 * a subdomain — and taking only the last lets a subdomain shadow the real one.
 */
function cookieValues(request, name) {
  const raw = request.headers.get('cookie') || '';
  const out = [];
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      out.push(part.slice(i + 1).trim().replace(/^"|"$/g, ''));
    }
  }
  return out;
}

/** True if any cookie sent under `name` is a valid token of `kind`. */
async function hasToken(request, env, name, kind) {
  for (const value of cookieValues(request, name)) {
    if ((await verify(env.SIGNING_KEY, value)) === kind) return true;
  }
  return false;
}

/** Reject a cross-site POST outright; a missing Origin is not a free pass. */
function sameOrigin(request, url) {
  const origin = request.headers.get('origin');
  return origin !== null && origin === url.origin;
}

/** Cheap per-IP throttle. Fails open only if the binding is missing. */
async function throttled(request, env, limiter) {
  if (!limiter) return false;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const { success } = await limiter.limit({ key: ip });
  return !success;
}

// Host-only and __Host- prefixed, so no subdomain can set or shadow it. The
// "www" case is handled by redirecting to the apex instead of by widening the
// cookie, which would have sent the unlock token to every subdomain.
const setCookie = (value, seconds) =>
  `${COOKIE}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`;

// ---- settings ------------------------------------------------------------

async function setting(env, name, fallback = null) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(name).first();
  return row?.value ?? fallback;
}

/** Locked unless the row says otherwise, so a missing row fails closed. */
async function isLocked(env, slug) {
  const row = await env.DB.prepare('SELECT locked FROM doc_state WHERE slug = ?').bind(slug).first();
  return row ? row.locked === 1 : true;
}

// ---- handlers ------------------------------------------------------------

async function subscribe(request, env, url) {
  if (request.method !== 'POST') return json({ ok: false }, 405);

  // Same-origin only: this endpoint exists for the page's own form.
  if (!sameOrigin(request, url)) return json({ ok: false }, 403);
  if (await throttled(request, env, env.SUBSCRIBE_RL)) {
    return json({ ok: false, error: 'slow_down' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  // Honeypot: a field the real form leaves empty and scripted bots fill in.
  // Answer 200 so the bot has nothing to learn from the response.
  if (typeof body.website === 'string' && body.website !== '') return json({ ok: true });

  const email = String(body.email ?? '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return json({ ok: false, error: 'invalid_email' }, 400);

  const lang = LANGS.has(body.lang) ? body.lang : 'en';

  try {
    await env.DB.prepare('INSERT INTO signups (email, lang) VALUES (?, ?) ON CONFLICT (email) DO NOTHING')
      .bind(email, lang)
      .run();
  } catch (err) {
    console.error('signup insert failed', err);
    return json({ ok: false, error: 'server' }, 500);
  }

  return json({ ok: true });
}

async function unlock(request, env, url) {
  if (request.method !== 'POST') return json({ ok: false }, 405);
  if (!sameOrigin(request, url)) return json({ ok: false }, 403);
  if (await throttled(request, env, env.UNLOCK_RL)) {
    return json({ ok: false, error: 'slow_down' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  const given = String(body.password ?? '').trim();
  const actual = await setting(env, 'gate_password');
  // Compared as MACs so the check is constant-time, and case-sensitively:
  // folding case threw away roughly a bit per letter of a phrase somebody chose.
  const ok =
    actual && (await sign(env.SIGNING_KEY, `pw:${given}`)) === (await sign(env.SIGNING_KEY, `pw:${actual}`));
  if (!ok) return json({ ok: false, error: 'wrong' }, 401);

  const seconds = COOKIE_DAYS * 24 * 60 * 60;
  const token = await sign(env.SIGNING_KEY, `pass:${Math.floor(Date.now() / 1000) + seconds}`);
  return json({ ok: true }, 200, { 'set-cookie': setCookie(token, seconds) });
}

/** Arrival from the workspace: swap the short-lived team token for the cookie. */
async function enter(request, env, url) {
  const slug = url.searchParams.get('doc');
  const kind = await verify(env.SIGNING_KEY, url.searchParams.get('t'));
  const target = SLUGS.has(slug) ? `/${slug}` : '/';
  if (kind !== 'team') return Response.redirect(new URL(target, url), 302);

  const seconds = COOKIE_DAYS * 24 * 60 * 60;
  const token = await sign(env.SIGNING_KEY, `pass:${Math.floor(Date.now() / 1000) + seconds}`);
  return new Response(null, {
    status: 302,
    headers: { location: new URL(target, url).toString(), 'set-cookie': setCookie(token, seconds) },
  });
}

const PRIVATE = {
  'cache-control': 'private, no-store, max-age=0',
  vary: 'Cookie',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

async function document(request, env, slug) {
  if (!(await isLocked(env, slug))) return html(DOCUMENTS[slug]);
  if (await hasToken(request, env, COOKIE, 'pass')) return html(DOCUMENTS[slug], 200, PRIVATE);
  return html(GATE_PAGE, 401, PRIVATE);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/api/subscribe') return subscribe(request, env, url);
    if (path === '/api/unlock') return unlock(request, env, url);
    if (path === '/enter') return enter(request, env, url);

    const slug = path.slice(1);
    if (SLUGS.has(slug)) return document(request, env, slug);

    return env.ASSETS.fetch(request);
  },
};

// Exported for the admin worker's link builder and for tests.
export { sign, verify, TEAM_LINK_TTL };
