// Screenshots for SYC-396 PR 1.3: the Cats grid at 390px and 1280px.
// The pages are the real renderCatGridPage output with fixture cats (stand-in
// pictures, since the photo route needs a database), saved as HTML first.
// Env: HTML_DIR (folder of grid.html, filtered.html, empty.html), OUT,
// CHROMIUM_PATH, PLAYWRIGHT_CORE (path to playwright-core's index.mjs).
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href);
const { HTML_DIR, OUT } = process.env;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const report = [];
for (const width of [390, 1280]) {
  const phone = width < 600;
  const ctx = await b.newContext({ viewport: { width, height: phone ? 844 : 900 }, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone });
  const p = await ctx.newPage();
  for (const page of ["grid", "filtered", "empty"]) {
    await p.goto(`file://${HTML_DIR}/${page}.html`);
    await p.waitForLoadState("load");
    await p.screenshot({ path: `${OUT}/${width}-${page}.png`, fullPage: true });
    if (phone && page === "grid") {
      await p.click("details.filters > summary");
      await p.screenshot({ path: `${OUT}/${width}-grid-filters-open.png`, fullPage: true });
      await p.goto(`file://${HTML_DIR}/${page}.html`);
    }
    // Nothing may scroll sideways, no text may be under 12px, and links/buttons should be 44px tall.
    const check = await p.evaluate(() => {
      const root = document.documentElement;
      const small = [];
      const tiny = [];
      for (const el of document.querySelectorAll("main *, nav *")) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!el.checkVisibility()) continue;
        if (own && parseFloat(getComputedStyle(el).fontSize) < 12) tiny.push(el.className || el.tagName);
        if (el.matches("a.catcardlink, a.fchip, .choicechip, summary, button, .searchrow input")) {
          const r = el.getBoundingClientRect();
          if (r.height < 43.5) small.push(`${el.className || el.tagName}:${Math.round(r.height)}`);
        }
      }
      return { scrollW: root.scrollWidth, clientW: root.clientWidth, tinyText: tiny, shortTargets: small };
    });
    report.push({ width, page, ...check, sideways: check.scrollW > check.clientW });
  }
  await ctx.close();
}
await b.close();
console.log(JSON.stringify(report, null, 1));
