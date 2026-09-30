/**
 * SYC-133: a loading screen written into the website's HTML.
 *
 * The web export's index.html is an empty <div id="root"> plus one large
 * script. On a weak connection that is a blank white page for a minute or
 * more, which looks broken. serve-web.js passes each app page through
 * injectLoadingScreen(), which adds (inline, so nothing else to download):
 *
 * - the app's name and "Loading…" in the visitor's saved language
 *   (English, Greek or French; the same localStorage key the app uses),
 * - after a few seconds, a note that a weak connection can take a while,
 * - if the app's script fails to download, a message and a "Try again" button.
 *
 * It sits outside #root, so React taking over the root can't remove it early.
 * The app removes it (lib/webLoadingScreen.ts) once its fonts are ready and it
 * can draw, the same moment the native splash screen hides.
 *
 * The words are copied from lib/i18n.ts (keys webLoading, webLoadingSlow,
 * webLoadingFailed, tryAgain, welcomeTitle); loading-screen.test.ts fails if
 * they drift. Greek and French need native review (SYC-4).
 *
 * Zero dependencies, Node.js built-ins only.
 */

const { escapeHtml } = require('./prelaunch-page');

const LOADING_SCREEN_ID = 'cs-loading';
const LANGUAGE_STORAGE_KEY = 'cat-spotter/language';
const DEFAULT_SLOW_AFTER_MS = 8000;

const LOADING_TEXT = {
  en: {
    title: 'Syros Cat Spotters',
    loading: 'Loading…',
    slow: 'Still loading. On a weak connection this can take a minute or two. Please keep this page open.',
    failed: 'The app didn’t finish downloading. Check your connection and try again.',
    retry: 'Try again',
  },
  el: {
    title: 'Syros Cat Spotters',
    loading: 'Φόρτωση…',
    slow: 'Φορτώνει ακόμα. Με αδύναμη σύνδεση μπορεί να πάρει ένα με δύο λεπτά. Κράτα αυτή τη σελίδα ανοιχτή.',
    failed: 'Η εφαρμογή δεν κατέβηκε ολόκληρη. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.',
    retry: 'Δοκιμάστε ξανά',
  },
  fr: {
    title: 'Syros Cat Spotters',
    loading: 'Chargement…',
    slow: 'Chargement en cours. Avec une connexion faible, cela peut prendre une minute ou deux. Garde cette page ouverte.',
    failed: 'L’application n’a pas fini de se télécharger. Vérifie ta connexion et réessaie.',
    retry: 'Réessayer',
  },
};

// Colours from constants/colors.ts (Purropolis): stone100 page, stone900 ink,
// aegean600 primary; dark mode aegean950 page, stone200 ink, aegean300 title.
const STYLE = `<style id="cs-loading-style">
#${LOADING_SCREEN_ID} {
  position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center;
  padding: 24px 16px; background: #f4f2ec; color: #1b2a38; text-align: center;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
#${LOADING_SCREEN_ID} .cs-card { max-width: 340px; }
#${LOADING_SCREEN_ID} svg { width: 64px; height: 64px; color: #1c77c3; }
#${LOADING_SCREEN_ID} h1 { margin: 12px 0 0; font-size: 24px; font-weight: 700; color: #0f4a72; }
#${LOADING_SCREEN_ID} p { margin: 12px 0 0; font-size: 16px; line-height: 1.45; }
#${LOADING_SCREEN_ID} .cs-row { display: flex; align-items: center; justify-content: center; gap: 10px; }
#${LOADING_SCREEN_ID} .cs-spin {
  width: 18px; height: 18px; border-radius: 50%; border: 3px solid #cfe7f9; border-top-color: #1c77c3;
  animation: cs-spin 0.9s linear infinite; flex: none;
}
#${LOADING_SCREEN_ID} .cs-note { color: #47596a; font-size: 15px; }
#${LOADING_SCREEN_ID} button {
  margin-top: 16px; font: inherit; font-size: 17px; font-weight: 600; padding: 12px 20px;
  border: 0; border-radius: 10px; background: #1c77c3; color: #fff; cursor: pointer;
}
#${LOADING_SCREEN_ID} [hidden] { display: none; }
@keyframes cs-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { #${LOADING_SCREEN_ID} .cs-spin { animation-duration: 3s; } }
@media (prefers-color-scheme: dark) {
  #${LOADING_SCREEN_ID} { background: #071e30; color: #e9edf0; }
  #${LOADING_SCREEN_ID} h1 { color: #a3d1f2; }
  #${LOADING_SCREEN_ID} svg { color: #66b2e8; }
  #${LOADING_SCREEN_ID} .cs-spin { border-color: #0f4a72; border-top-color: #66b2e8; }
  #${LOADING_SCREEN_ID} .cs-note { color: #b6c2cc; }
}
</style><noscript><style>#${LOADING_SCREEN_ID} { display: none; }</style></noscript>`;
// ^ With JavaScript off the app can never load, so hide the loading screen
//   and let Expo's "You need to enable JavaScript" note show instead.

// A simple paw print.
const PAW = `<svg viewBox="0 0 64 64" aria-hidden="true" fill="currentColor"><ellipse cx="32" cy="42" rx="13" ry="11"/><ellipse cx="14" cy="28" rx="6" ry="7.5"/><ellipse cx="25" cy="17" rx="6" ry="8"/><ellipse cx="39" cy="17" rx="6" ry="8"/><ellipse cx="50" cy="28" rx="6" ry="7.5"/></svg>`;

/** JSON that is safe inside an inline <script>. */
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function markup(slowAfterMs) {
  const en = LOADING_TEXT.en;
  const id = LOADING_SCREEN_ID;
  // English is in the HTML itself so it shows even before the script runs;
  // the script swaps in the saved language straight away.
  return `<div id="${id}" role="status" aria-live="polite"><div class="cs-card">${PAW}
<h1 id="${id}-title">${escapeHtml(en.title)}</h1>
<p class="cs-row" id="${id}-row"><span class="cs-spin" aria-hidden="true"></span><span id="${id}-text">${escapeHtml(en.loading)}</span></p>
<p class="cs-note" id="${id}-slow" hidden>${escapeHtml(en.slow)}</p>
<button type="button" id="${id}-retry" hidden>${escapeHtml(en.retry)}</button>
</div></div>
<script>(function () {
  var T = ${scriptJson(LOADING_TEXT)};
  var lang = 'en';
  try {
    var saved = window.localStorage.getItem(${scriptJson(LANGUAGE_STORAGE_KEY)});
    if (saved && Object.prototype.hasOwnProperty.call(T, saved)) lang = saved;
  } catch (e) {}
  var t = T[lang];
  function el(suffix) { return document.getElementById(${scriptJson(id)} + suffix); }
  if (!el('')) return;
  document.documentElement.lang = lang;
  el('-title').textContent = t.title;
  el('-text').textContent = t.loading;
  el('-slow').textContent = t.slow;
  el('-retry').textContent = t.retry;
  el('-retry').onclick = function () { window.location.reload(); };
  var failed = false;
  setTimeout(function () {
    if (el('') && !failed) el('-slow').hidden = false;
  }, ${Number(slowAfterMs)});
  window.addEventListener('error', function (event) {
    var target = event && event.target;
    if (!target || target.tagName !== 'SCRIPT' || !/\\/_expo\\//.test(target.src || '')) return;
    if (!el('')) return;
    failed = true;
    el('-row').hidden = true;
    el('-slow').textContent = t.failed;
    el('-slow').hidden = false;
    el('-retry').hidden = false;
  }, true);
})();</script>
`;
}

const ROOT_PATTERN = /<div id="root">\s*<\/div>/;

/**
 * Adds the loading screen to an app page. HTML without an empty
 * <div id="root"> and a </head> is returned unchanged.
 * @param {string} html
 * @param {{ slowAfterMs?: number }} [options]
 */
function injectLoadingScreen(html, options = {}) {
  const slowAfterMs = options.slowAfterMs ?? DEFAULT_SLOW_AFTER_MS;
  const rootMatch = ROOT_PATTERN.exec(html);
  const headEnd = html.indexOf('</head>');
  if (!rootMatch || headEnd === -1 || headEnd > rootMatch.index) return html;
  return (
    html.slice(0, headEnd) +
    STYLE +
    html.slice(headEnd, rootMatch.index) +
    markup(slowAfterMs) +
    html.slice(rootMatch.index)
  );
}

module.exports = { injectLoadingScreen, LOADING_TEXT, LOADING_SCREEN_ID };
