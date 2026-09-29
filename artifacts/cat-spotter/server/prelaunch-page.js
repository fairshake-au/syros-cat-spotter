/**
 * SYC-113: the pre-launch password page, as one self-contained HTML string.
 * Inline CSS only: no scripts, no external files (the site's own files are
 * not served to people without the password). English and Greek.
 */

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MESSAGES = {
  wrong: {
    en: "That password isn't right.",
    el: 'Ο κωδικός δεν είναι σωστός.',
  },
  tooMany: {
    en: 'Too many tries. Please wait 15 minutes.',
    el: 'Πάρα πολλές προσπάθειες. Περίμενε 15 λεπτά.',
  },
};

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px 16px; background: #f4f2ec; color: #1b2a38;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  main {
    width: 100%; max-width: 420px; background: #fefcf7; border-radius: 16px;
    padding: 32px 24px; box-shadow: 0 4px 24px rgba(10, 51, 80, 0.12);
  }
  h1 { margin: 0 0 4px; font-size: 26px; color: #0f4a72; }
  .el { color: #47596a; }
  p { margin: 12px 0 0; line-height: 1.45; font-size: 16px; }
  p.el { margin-top: 4px; font-size: 15px; }
  form { margin-top: 24px; }
  label { display: block; font-weight: 600; margin-bottom: 8px; }
  input[type=password] {
    width: 100%; font-size: 17px; padding: 12px 14px; border-radius: 10px;
    border: 1px solid #b6c2cc; background: #fff; color: #1b2a38;
  }
  input[type=password]:focus { outline: 3px solid #a3d1f2; border-color: #1c77c3; }
  button {
    margin-top: 16px; width: 100%; font-size: 17px; font-weight: 600; padding: 12px 14px;
    border: 0; border-radius: 10px; background: #1c77c3; color: #fff; cursor: pointer;
  }
  button:hover { background: #135f92; }
  .error {
    margin-top: 20px; padding: 12px 14px; border-radius: 10px;
    background: #fce4ee; color: #b02f66; font-weight: 600;
  }
  .error span { display: block; font-weight: 500; }
  @media (prefers-color-scheme: dark) {
    body { background: #071e30; color: #e9edf0; }
    main { background: #0a3350; box-shadow: none; }
    h1 { color: #a3d1f2; }
    .el { color: #b6c2cc; }
    input[type=password] { background: #071e30; color: #e9edf0; border-color: #47596a; }
  }
`;

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

/**
 * The password page.
 * @param {{ action: string, next: string, error?: 'wrong' | 'tooMany' }} opts
 */
function passwordPage({ action, next, error }) {
  const message = error ? MESSAGES[error] : null;
  const errorHtml = message
    ? `<div class="error" role="alert">${escapeHtml(message.en)}<span lang="el">${escapeHtml(message.el)}</span></div>`
    : '';
  return page(
    'Cat Spotters',
    `<h1>Cat Spotters</h1>
<p>Cat Spotters is being tested before launch. If you're a tester, the password is in your invite.</p>
<p class="el" lang="el">Το Cat Spotters δοκιμάζεται πριν από την κυκλοφορία του. Αν είσαι δοκιμαστής, ο κωδικός είναι στην πρόσκλησή σου.</p>
${errorHtml}
<form method="post" action="${escapeHtml(action)}">
<input type="hidden" name="next" value="${escapeHtml(next)}">
<label for="password">Password <span class="el" lang="el">· Κωδικός</span></label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Continue <span lang="el">· Συνέχεια</span></button>
</form>`,
  );
}

/** Shown when the gate is on but a setting it needs is missing (fail closed). */
function unavailablePage() {
  return page(
    'Cat Spotters',
    `<h1>Cat Spotters</h1>
<p>Cat Spotters isn't available right now.</p>
<p class="el" lang="el">Το Cat Spotters δεν είναι διαθέσιμο αυτή τη στιγμή.</p>`,
  );
}

module.exports = { passwordPage, unavailablePage, escapeHtml };
