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

    // Same-origin only: this endpoint exists for the page's own form.
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== url.host) return json({ ok: false }, 403);

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
