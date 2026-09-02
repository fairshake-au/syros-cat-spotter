/**
 * catspotters.com — coming-soon page.
 * Static assets are served by the assets binding; this worker only handles
 * the sign-up POST. Addresses go straight to D1 and nowhere else.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LANGS = new Set(['en', 'el', 'fr']);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== '/api/subscribe') return env.ASSETS.fetch(request);
    if (request.method !== 'POST') return json({ ok: false }, 405);

    // Rejects a browser posting from another site. It is not a real gate — a
    // script can simply omit the header — so the Turnstile token below is what
    // actually protects this endpoint. `Origin: null` is a legitimate value
    // (sandboxed iframes, file://) and must not crash the parse.
    const origin = request.headers.get('origin');
    if (origin) {
      let host = null;
      try {
        host = new URL(origin).host;
      } catch {
        return json({ ok: false }, 403);
      }
      if (host !== url.host) return json({ ok: false }, 403);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'bad_request' }, 400);
    }
    // JSON.parse('null') and JSON.parse('"x"') both succeed; neither has fields.
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return json({ ok: false, error: 'bad_request' }, 400);
    }

    // Honeypot: a field the real form leaves empty and scripted bots fill in.
    // Answer 200 so the bot has nothing to learn from the response.
    if (typeof body.hp_check === 'string' && body.hp_check !== '') return json({ ok: true });

    // Turnstile: the token is single-use and verified server-side. A page that
    // cannot reach challenges.cloudflare.com never gets a token, so a missing
    // one is a rejection, not a reason to let the request through.
    // An unset secret would make siteverify fail for every visitor; fail loudly
    // in the log rather than silently turning sign-ups off.
    if (!env.TURNSTILE_SECRET) {
      console.error('TURNSTILE_SECRET is not set — rejecting every sign-up');
      return json({ ok: false, error: 'server' }, 500);
    }

    const token = String(body.token ?? '');
    if (!token) return json({ ok: false, error: 'verify' }, 400);

    const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: token,
        remoteip: request.headers.get('cf-connecting-ip') ?? '',
      }),
    });
    const outcome = await verify.json().catch(() => ({ success: false }));
    if (!outcome.success) {
      console.warn('turnstile rejected', outcome['error-codes']);
      return json({ ok: false, error: 'verify' }, 403);
    }

    const email = String(body.email ?? '').trim().toLowerCase();
    if (email.length > 254 || !EMAIL.test(email)) return json({ ok: false, error: 'invalid_email' }, 400);

    const lang = LANGS.has(body.lang) ? body.lang : 'en';

    try {
      await env.DB.prepare(
        'INSERT INTO signups (email, lang) VALUES (?, ?) ON CONFLICT (email) DO NOTHING',
      )
        .bind(email, lang)
        .run();
    } catch (err) {
      console.error('signup insert failed', err);
      return json({ ok: false, error: 'server' }, 500);
    }

    return json({ ok: true });
  },
};
