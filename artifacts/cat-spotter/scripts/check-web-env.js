#!/usr/bin/env node
/**
 * SYC-113 item 6: the tester key can't leak into the public website.
 * Plan: docs/superpowers/plans/syc-113-pre-launch-gates.md, item 6.
 *
 * EXPO_PUBLIC_* values are written into the JavaScript at build time. If
 * EXPO_PUBLIC_PRELAUNCH_KEY reached a web build, the website would publish
 * the tester key inside its own code. `build:web` runs this twice:
 *
 *   node scripts/check-web-env.js before   (before `expo export`)
 *     Fails if EXPO_PUBLIC_PRELAUNCH_KEY is set in the environment OR in any
 *     .env* file here (Expo reads those itself).
 *
 *   node scripts/check-web-env.js after    (after `expo export`)
 *     Searches every file in dist/ for each value in PRELAUNCH_TESTER_KEYS
 *     (a Replit deployment secret) and fails if any is found, catching the
 *     key arriving by a route nobody thought of.
 *
 * Either way the build (and so the publish) fails loudly instead of leaking.
 * An optional second argument overrides the app folder (used by tests).
 * The key's value is never printed.
 */

const fs = require('fs');
const path = require('path');

const KEY_NAME = 'EXPO_PUBLIC_PRELAUNCH_KEY';
const MESSAGE =
  'The tester key must only be set in EAS store builds, never for the website.';

/** The value assigned to EXPO_PUBLIC_PRELAUNCH_KEY in a .env file's text, or ''. */
function valueInEnvFile(text) {
  let found = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?EXPO_PUBLIC_PRELAUNCH_KEY\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[1].trim();
    // Strip an inline comment on an unquoted value, then surrounding quotes.
    if (!/^['"]/.test(value)) value = value.replace(/\s+#.*$/, '');
    value = value.replace(/^(['"])(.*)\1$/, '$2').trim();
    if (value) found = value;
  }
  return found;
}

/** Problems found before the export (empty when clean). */
function checkBefore({ env, appDir }) {
  const problems = [];
  if ((env[KEY_NAME] || '').trim()) {
    problems.push(`${KEY_NAME} is set in the environment. ${MESSAGE}`);
  }
  for (const entry of fs.readdirSync(appDir)) {
    if (!entry.startsWith('.env')) continue;
    const file = path.join(appDir, entry);
    if (!fs.statSync(file).isFile()) continue;
    if (valueInEnvFile(fs.readFileSync(file, 'utf8'))) {
      problems.push(`${KEY_NAME} is set in ${entry}. ${MESSAGE}`);
    }
  }
  return problems;
}

function filesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...filesUnder(full));
    else if (stat.isFile()) out.push(full);
  }
  return out;
}

/** Problems found after the export (empty when clean). */
function checkAfter({ env, appDir }) {
  const problems = [];
  const keys = (env.PRELAUNCH_TESTER_KEYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const distDir = path.join(appDir, 'dist');
  if (!keys.length || !fs.existsSync(distDir)) return problems;
  const needles = keys.map((k) => Buffer.from(k, 'utf8'));
  for (const file of filesUnder(distDir)) {
    const bytes = fs.readFileSync(file);
    needles.forEach((needle, i) => {
      if (bytes.includes(needle)) {
        problems.push(
          `Tester key #${i + 1} from PRELAUNCH_TESTER_KEYS was found in ${path.relative(appDir, file)}. ${MESSAGE}`,
        );
      }
    });
  }
  return problems;
}

module.exports = { checkBefore, checkAfter, valueInEnvFile };

if (require.main === module) {
  const mode = process.argv[2];
  const appDir = path.resolve(process.argv[3] || path.join(__dirname, '..'));
  if (mode !== 'before' && mode !== 'after') {
    console.error('Usage: node scripts/check-web-env.js before|after [appDir]');
    process.exit(2);
  }
  const problems =
    mode === 'before'
      ? checkBefore({ env: process.env, appDir })
      : checkAfter({ env: process.env, appDir });
  if (problems.length) {
    for (const p of problems) console.error(`check-web-env (${mode}): ${p}`);
    process.exit(1);
  }
  console.log(`check-web-env (${mode}): ok`);
}
