/**
 * SYC-170: the /_challenge page. A one-screen static page that runs
 * Cloudflare Turnstile (managed mode) and hands the token back to the phone
 * app's WebView (ReactNativeWebView.postMessage), which loads it top-level.
 * Nothing frames it: the website loads Cloudflare's script directly (PR
 * 1.2), so the page keeps X-Frame-Options: DENY and frame-ancestors 'none'
 * like every other page (plan PR 1.1).
 *
 * Messages posted (JSON strings):
 *   {type:'token', token}  the challenge passed
 *   {type:'interactive'}   Cloudflare wants a tap, so show the sheet
 *   {type:'error', code}   error | expired | timeout | unsupported | render
 *
 * Zero dependencies. Holds no data and sets no cookies.
 */
const crypto = require('crypto');

const ACTIONS = new Set(['welfare_report', 'welfare_draft', 'report_issue']);
const CDATA_PATTERN = /^[A-Za-z0-9_-]{0,100}$/;
// Cloudflare's published always-passes test key. Development only.
const TEST_SITEKEY = '1x00000000000000000000AA';

/** Returns {action, cdata} or null if the query is not acceptable. */
function parseChallengeQuery(searchParams) {
  const action = searchParams.get('action');
  const cdata = searchParams.get('cdata') ?? '';
  if (!action || !ACTIONS.has(action)) return null;
  if (!CDATA_PATTERN.test(cdata)) return null;
  return { action, cdata };
}

/** The sitekey to use, or null if production has none configured. */
// The test key only when NODE_ENV is exactly "development" or "test". The
// website's production run sets no NODE_ENV at all, so anything else counts
// as production, the same rule as the API's gateEnabled() (lib/prelaunch.ts;
// review of #151, finding 4): there, no TURNSTILE_SITEKEY means 503.
function sitekeyFor(env) {
  if (env.TURNSTILE_SITEKEY) return env.TURNSTILE_SITEKEY;
  return env.NODE_ENV === 'development' || env.NODE_ENV === 'test' ? TEST_SITEKEY : null;
}

function jsString(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function challengePage({ sitekey, action, cdata, nonce }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Safety check</title>
<style nonce="${nonce}">
  html,body{margin:0;height:100%;background:#fff;font-family:system-ui,sans-serif}
  body{display:flex;align-items:center;justify-content:center;flex-direction:column}
  #w{min-height:65px}
  p{color:#444;font-size:15px;margin:12px 16px;text-align:center}
</style>
</head>
<body>
<div id="w"></div>
<p id="msg">Running a quick safety check&hellip;</p>
<script nonce="${nonce}">
(function () {
  window.__turnstilePosts = [];
  function post(payload) {
    window.__turnstilePosts.push(payload);
    try {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    } catch (e) {}
  }
  var msg = document.getElementById('msg');
  window.onTurnstileLoad = function () {
    try {
      window.turnstile.render('#w', {
        sitekey: ${jsString(sitekey)},
        action: ${jsString(action)},
        cData: ${jsString(cdata)},
        callback: function (token) { msg.textContent = 'Done.'; post({ type: 'token', token: token }); },
        'error-callback': function (code) { msg.textContent = 'The safety check could not finish.'; post({ type: 'error', code: String(code || 'error') }); return true; },
        'expired-callback': function () { post({ type: 'error', code: 'expired' }); },
        'timeout-callback': function () { post({ type: 'error', code: 'timeout' }); },
        'unsupported-callback': function () { post({ type: 'error', code: 'unsupported' }); },
        'before-interactive-callback': function () { msg.textContent = 'Please tick the box.'; post({ type: 'interactive' }); },
        'after-interactive-callback': function () { msg.textContent = 'Running a quick safety check\\u2026'; }
      });
    } catch (e) { post({ type: 'error', code: 'render' }); }
  };
})();
</script>
<script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad" async defer></script>
</body>
</html>
`;
}

/** Response headers for the page. Own CSP; nothing may frame it. */
function challengeHeaders(nonce) {
  return {
    'content-type': 'text/html; charset=utf-8',
    'x-frame-options': 'DENY',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
    'referrer-policy': 'no-referrer',
    'content-security-policy': [
      "default-src 'none'",
      `script-src 'nonce-${nonce}' https://challenges.cloudflare.com`,
      `style-src 'nonce-${nonce}'`,
      'frame-src https://challenges.cloudflare.com',
      'connect-src https://challenges.cloudflare.com',
      "frame-ancestors 'none'",
    ].join('; '),
  };
}

function newNonce() {
  return crypto.randomBytes(16).toString('base64');
}

module.exports = {
  parseChallengeQuery,
  sitekeyFor,
  challengePage,
  challengeHeaders,
  newNonce,
  ACTIONS,
  TEST_SITEKEY,
};
