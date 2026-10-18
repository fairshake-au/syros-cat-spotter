// Screenshots and layout checks for SYC-396 PR 2.1 (Home), from pages drawn
// with hand-built figures (render-home.scratch.ts, not committed). Pictures
// are a grey stand-in; nothing leaves the machine.
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href);
const { HTML_DIR, OUT } = process.env;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const report = [];
for (const width of [390, 1280]) {
  const phone = width < 600;
  const ctx = await b.newContext({ viewport: { width, height: phone ? 844 : 900 }, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone });
  await ctx.route("**/*", (r) => (r.request().url().startsWith("file://") || r.request().url().startsWith("data:") ? r.continue() : r.abort()));
  const p = await ctx.newPage();
  for (const page of ["home", "home-empty", "home-failed"]) {
    await p.goto(`file://${HTML_DIR}/${page}.html`);
    await p.waitForLoadState("load");
    await p.screenshot({ path: `${OUT}/${width}-${page}.png`, fullPage: true });
    const check = await p.evaluate(() => {
      const root = document.documentElement;
      const tiny = [], short = [];
      for (const el of document.querySelectorAll("body *")) {
        if (!el.checkVisibility()) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (own && parseFloat(getComputedStyle(el).fontSize) < 12) tiny.push(el.className || el.tagName);
        if (el.matches("a.hlink, a.hrow, a.catcardlink, .bar a, .bar button")) {
          const r = el.getBoundingClientRect();
          if (r.height < 43.5) short.push(`${el.className || el.tagName}:${el.textContent.trim().slice(0, 30)}:${Math.round(r.height)}`);
        }
      }
      return { scrollW: root.scrollWidth, clientW: root.clientWidth, tinyText: [...new Set(tiny)], shortTargets: short };
    });
    report.push({ width, page, ...check, sideways: check.scrollW > check.clientW });
  }
  await ctx.close();
}
await b.close();
import { writeFileSync } from "node:fs";
writeFileSync(`${OUT}/layout-check-result.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.map((r) => ({ w: r.width, page: r.page, sideways: r.sideways, tiny: r.tinyText, short: r.shortTargets })), null, 1));
