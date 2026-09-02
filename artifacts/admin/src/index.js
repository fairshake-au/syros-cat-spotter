/**
 * admin.catspotters.com — the shared Syros Cats / Fair Shake workspace.
 *
 * Signing in is by invitation only: an address has to be in the `admins`
 * table before either route will work. Two ways in:
 *   - a one-time link emailed to that address, valid 15 minutes, single use;
 *   - Google, once GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are set. The
 *     button is shown as unavailable until they are, rather than failing
 *     silently when somebody presses it.
 *
 * Signed in, you never meet the document password: links out of here carry a
 * short-lived signed token that the public site swaps for the usual cookie.
 */

import { WORKSPACE_PAGE, SIGNIN_PAGE } from './pages.js';

const SITE = 'https://catspotters.com';
const SESSION = 'cs_admin';
const SESSION_DAYS = 30;
const LINK_TTL = 15 * 60; // seconds
const HOP_TTL = 300; // the signed hop from here to a document

const DOCS = [
  {
    slug: 'forpurpose',
    title: 'For the purpose sector',
    blurb:
      'For other cat charities and funders. Covers the whole app, plus the working side only Syros Cats sees: roles, confidence levels, trapping rounds, colonies, reporting and export.',
  },
  {
    slug: 'boundless',
    title: 'For Boundless Life',
    blurb:
      'The invitation to collaborate: what a cohort would do, what children learn, and what each side provides and gains. Send this one to their education team.',
  },
  {
    slug: 'media',
    title: 'For media',
    blurb:
      'The backgrounder for journalists, built around the October launch. Some figures, names and quotes are still marked for you to confirm.',
  },
];

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

const html = (body, status = 200, headers = {}) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---- signing (same scheme and key as the public site) ---------------------

const enc = new TextEncoder();

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(secret, payload) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return `${payload}.${b64url(mac)}`;
}

async function verify(secret, token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const payload = token.slice(0, token.lastIndexOf('.'));
  const expected = await sign(secret, payload);
  if (expected.length !== token.length) return null;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  if (diff !== 0) return null;
  const parts = payload.split(':');
  if (Number(parts[1]) * 1000 < Date.now()) return null;
  return parts;
}

function cookies(request) {
  const raw = request.headers.get('cookie') || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

async function session(request, env) {
  const parts = await verify(env.SIGNING_KEY, cookies(request)[SESSION]);
  if (!parts || parts[0] !== 'admin') return null;
  const email = parts.slice(2).join(':');
  // Removing somebody from the table ends their session at the next request,
  // rather than whenever their cookie happens to expire.
  const row = await env.DB.prepare('SELECT email FROM admins WHERE email = ?').bind(email).first();
  return row ? email : null;
}

async function grant(env, email) {
  const seconds = SESSION_DAYS * 24 * 60 * 60;
  const token = await sign(env.SIGNING_KEY, `admin:${Math.floor(Date.now() / 1000) + seconds}:${email}`);
  return `${SESSION}=${token}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`;
}

// ---- email ---------------------------------------------------------------

/** Returns true if the link was actually delivered. */
async function sendLink(env, email, link) {
  if (!env.RESEND_API_KEY) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM || 'Cat Spotters <hello@catspotters.com>',
      to: [email],
      subject: 'Your Cat Spotters workspace link',
      text: `Open the workspace: ${link}\n\nThe link works once and expires in 15 minutes.\nIf you did not ask for it, ignore this message.`,
    }),
  });
  if (!res.ok) console.error('resend failed', res.status, await res.text());
  return res.ok;
}

// ---- rendering -----------------------------------------------------------

async function workspace(request, env, email) {
  const rows = await env.DB.prepare('SELECT slug, locked FROM doc_state').all();
  const locked = new Map((rows.results || []).map((r) => [r.slug, r.locked === 1]));
  const pw = await env.DB.prepare("SELECT value FROM settings WHERE key = 'gate_password'").first();

  const cards = DOCS.map((d) => {
    const isLocked = locked.get(d.slug) !== false;
    return `
      <article class="doc">
        <div class="doc-top">
          <div>
            <h3>${escape(d.title)}</h3>
            <span class="url">catspotters.com/${d.slug}</span>
          </div>
          <span class="state state--${isLocked ? 'locked' : 'open'}">${isLocked ? 'Password on' : 'Public'}</span>
        </div>
        <p>${escape(d.blurb)}</p>
        <div class="actions">
          <a class="btn btn--primary" href="/open/${d.slug}">Open</a>
          <button class="btn btn--ghost" type="button" data-link="${SITE}/${d.slug}">Copy link</button>
          <button class="btn btn--ghost" type="button" data-lock="${d.slug}" data-state="${isLocked ? 'locked' : 'open'}">${
            isLocked ? 'Remove password' : 'Put the password back'
          }</button>
        </div>
      </article>`;
  }).join('\n');

  return html(
    WORKSPACE_PAGE.replace('{{DOCS}}', cards)
      .replace('{{EMAIL}}', escape(email))
      .replace('{{PASSWORD}}', escape(pw?.value ?? 'not set'))
      .replace('{{PROPOSAL}}', 'https://proposals.fairshake.au/catspotters'),
  );
}

function signinPage(env, message = '') {
  let page = SIGNIN_PAGE;
  if (!env.GOOGLE_CLIENT_ID) {
    page = page.replace(
      '<a class="btn btn--google" id="google" href="/auth/google">',
      '<a class="btn btn--google" id="google" aria-disabled="true" title="Google sign-in is not switched on yet" href="#">',
    );
  }
  if (message) page = page.replace('<p class="err" id="err" hidden></p>', `<p class="err" id="err">${escape(message)}</p>`);
  return html(page);
}

// ---- routes --------------------------------------------------------------

async function requestLink(request, env, url) {
  if (request.method !== 'POST') return json({ ok: false }, 405);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== url.host) return json({ ok: false }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: 'Something went wrong reading that.' }, 400);
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  const row = await env.DB.prepare('SELECT email FROM admins WHERE email = ?').bind(email).first();

  // Do not reveal who is on the list: an address that is not on it gets the
  // same answer as one that is, and simply never receives anything.
  if (!row) return json({ ok: true });

  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare('INSERT INTO signin_tokens (token, email, expires_at) VALUES (?, ?, ?)')
    .bind(token, email, Math.floor(Date.now() / 1000) + LINK_TTL)
    .run();

  const link = `${url.origin}/auth?t=${token}`;
  const sent = await sendLink(env, email, link);
  if (!sent) {
    console.error('no mail transport configured; link not delivered for', email);
    return json({ ok: false, message: 'Email sending is not switched on yet. Ask Fair Shake to let you in.' }, 503);
  }
  return json({ ok: true });
}

async function consumeLink(request, env, url) {
  const token = url.searchParams.get('t') || '';
  const row = await env.DB.prepare(
    'SELECT email, expires_at, used_at FROM signin_tokens WHERE token = ?',
  ).bind(token).first();

  if (!row || row.used_at || row.expires_at < Math.floor(Date.now() / 1000)) {
    return signinPage(env, 'That link has been used already, or it has expired. Here is a fresh one.');
  }

  await env.DB.prepare("UPDATE signin_tokens SET used_at = datetime('now') WHERE token = ?").bind(token).run();
  return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': await grant(env, row.email) } });
}

async function openDoc(env, slug) {
  const token = await sign(env.SIGNING_KEY, `team:${Math.floor(Date.now() / 1000) + HOP_TTL}`);
  return Response.redirect(`${SITE}/enter?doc=${encodeURIComponent(slug)}&t=${encodeURIComponent(token)}`, 302);
}

async function setLock(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false }, 400);
  }
  const slug = String(body.slug ?? '');
  if (!DOCS.some((d) => d.slug === slug)) return json({ ok: false }, 400);
  await env.DB.prepare(
    "INSERT INTO doc_state (slug, locked, updated_at) VALUES (?, ?, datetime('now')) " +
      "ON CONFLICT(slug) DO UPDATE SET locked = excluded.locked, updated_at = datetime('now')",
  )
    .bind(slug, body.locked ? 1 : 0)
    .run();
  return json({ ok: true });
}

async function setPassword(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false }, 400);
  }
  const value = String(body.value ?? '').trim();
  if (value.length < 8 || value.length > 100) {
    return json({ ok: false, message: 'Use at least eight characters.' }, 400);
  }
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('gate_password', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
    .bind(value)
    .run();
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/api/signin') return requestLink(request, env, url);
    if (path === '/auth') return consumeLink(request, env, url);
    if (path === '/auth/google') return signinPage(env, 'Google sign-in is not switched on yet. Use the email link.');

    const email = await session(request, env);
    if (!email) {
      // An unauthenticated API call gets a refusal, not a page: returning the
      // sign-in HTML with a 200 reads as success to anything but a browser.
      if (path.startsWith('/api/')) return json({ ok: false, error: 'signed_out' }, 401);
      if (path === '/signout') return Response.redirect(url.origin, 302);
      return signinPage(env);
    }

    if (path === '/signout') {
      return new Response(null, {
        status: 302,
        headers: { location: url.origin, 'set-cookie': `${SESSION}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` },
      });
    }
    if (path === '/') return workspace(request, env, email);
    if (path.startsWith('/open/')) return openDoc(env, path.slice('/open/'.length));
    if (path === '/api/lock' && request.method === 'POST') return setLock(request, env);
    if (path === '/api/password' && request.method === 'POST') return setPassword(request, env);

    return new Response('Not found', { status: 404 });
  },
};
