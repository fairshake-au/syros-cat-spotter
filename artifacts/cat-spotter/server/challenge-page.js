/**
 * SYC-170 spike: the /_challenge page. A one-screen static page that runs
 * Cloudflare Turnstile (managed mode) and hands the token back to whoever
 * embeds it: the phone app's WebView (ReactNativeWebView.postMessage) or a
 * parent web page (window.parent.postMessage).
 *
 * Messages posted (JSON strings for the WebView, objects for the parent):
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
function sitekeyFor(env) {
  if (env.TURNSTILE_SITEKEY) return env.TURNSTILE_SITEKEY;
  return env.NODE_ENV === 'production' ? null : TEST_SITEKEY;
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
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage(payload, window.location.origin);
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

/** Response headers for the page. Own CSP; only the same origin may frame it. */
function challengeHeaders(nonce) {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
    'referrer-policy': 'no-referrer',
    'content-security-policy': [
      "default-src 'none'",
      `script-src 'nonce-${nonce}' https://challenges.cloudflare.com`,
      `style-src 'nonce-${nonce}'`,
      'frame-src https://challenges.cloudflare.com',
      'connect-src https://challenges.cloudflare.com',
      "frame-ancestors 'self'",
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
