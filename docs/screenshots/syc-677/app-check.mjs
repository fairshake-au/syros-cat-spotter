// SYC-677 D: 390px screenshots of the naming screens against a local scratch DB.
// Usage: node app-check.mjs  (web on :8099, api on :8098; nothing leaves localhost)
import { chromium } from '/Users/samuelporter/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = 'http://localhost:8099';
const CAT_ID = process.env.CAT_ID ?? '1';
const exe = process.env.CHROMIUM ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const blocked = [];
await ctx.route('**/*', (route) => {
  const u = new URL(route.request().url());
  if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
  blocked.push(u.hostname);
  return route.abort();
});
await ctx.addInitScript(() => {
  try { localStorage.setItem('cat-spotter/username', 'PreviewSpotter'); } catch {}
});
const page = await ctx.newPage();
const results = {};

async function skipKeepSafe() {
  const skip = page.getByRole('button', { name: 'Skip', exact: true });
  if (await skip.isVisible().catch(() => false)) { await skip.click(); await page.waitForTimeout(500); }
}

async function check(name) {
  await page.screenshot({ path: path.join(here, `app-390-${name}.png`) });
  results[name] = await page.evaluate(() => {
    const de = document.documentElement;
    const widest = Math.max(de.scrollWidth, document.body.scrollWidth);
    const small = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.textContent.trim();
      if (!t) continue;
      const el = n.parentElement;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0 || r.height === 0) continue;
      const px = parseFloat(cs.fontSize);
      if (px < 12) small.push({ text: t.slice(0, 40), px });
    }
    return { innerWidth: window.innerWidth, scrollWidth: widest, horizontalScroll: widest > window.innerWidth + 1, textUnder12px: small };
  });
}

await page.goto(`${WEB}/cat/${CAT_ID}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await skipKeepSafe();
await page.getByText('Name this cat').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(800);
await check('pending-cat');

await page.goto(`${WEB}/cats`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await check('catalogue');

await page.goto(`${WEB}/cat/${CAT_ID}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await skipKeepSafe();
await page.getByText('Name this cat').first().waitFor({ timeout: 30000 });
await page.getByRole('button', { name: 'Name this cat' }).first().click();
const input = page.getByPlaceholder(/name/i).last();
await input.waitFor();
await input.fill('Ginger');
await page.waitForTimeout(400);
await check('name-sheet');

await input.fill('SYR 12');
await page.getByRole('button', { name: /^(Save|Give|Name)/i }).last().click().catch(() => {});
await page.waitForTimeout(1500);
await check('name-refused');

await input.fill('Marmalade');
await page.getByRole('button', { name: /^(Save|Give|Name)/i }).last().click().catch(() => {});
await page.waitForTimeout(2000);
await check('named');


results.blockedNonLocalhostHosts = [...new Set(blocked)];
fs.writeFileSync(path.join(here, 'app-check-result.json'), JSON.stringify(results, null, 2));
await browser.close();
console.log(JSON.stringify(results, null, 2));
